/**
 * ═══════════════════════════════════════════════════════════════
 *  MAIN.MJS — Ana Orkestratör
 *  Tüm modülleri sırayla çağırır, zamanı ölçer, Telegram raporu atar
 * ═══════════════════════════════════════════════════════════════
 */
import {
  SESSION_NUMBER,
  TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID,
  CONCURRENCY_LIMIT,
  TARGET_LISTINGS_PER_RUN,
  MAX_REQUESTS_PER_RUN,
  BYPASS_AI,
  AI_PROVIDER,
  GEMINI_API_KEY,
  OPENROUTER_API_KEY,
  getActiveSegments,
} from './config.mjs';
import { fileURLToPath } from 'node:url';
import { initSession, scrapeSegment, getStats, isRequestBudgetExhausted, isRunHalted } from './scrapeops.mjs';
import { parseAllPages, deduplicateListings, filterInvalidListings, getLastFilterStats } from './parser.mjs';
import { evaluateAllListings, selectTopOpportunities, fallbackSelection } from './ai_evaluator.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Telegram Mesaj Gönderici ────────────────────────────────
async function postTelegramChunk(chunk, parseMode = 'Markdown') {
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: chunk,
    disable_web_page_preview: true,
  };
  if (parseMode) {
    payload.parse_mode = parseMode;
  }

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok) {
    const description = body?.description || `${response.status} ${response.statusText}`.trim();
    return { ok: false, error: description };
  }

  return { ok: true };
}

async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('  ⚠️ Telegram token/chat ID tanımlı değil, mesaj gönderilemedi.');
    return;
  }

  try {
    // Telegram max 4096 karakter
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      chunks.push(remaining.substring(0, 4000));
      remaining = remaining.substring(4000);
    }

    for (const chunk of chunks) {
      let sendResult = await postTelegramChunk(chunk, 'Markdown');
      if (!sendResult.ok && /parse|markdown/i.test(sendResult.error || '')) {
        console.log('  ⚠️ Telegram Markdown parse hatası, düz metin fallback deneniyor.');
        sendResult = await postTelegramChunk(chunk, null);
      }

      if (!sendResult.ok) {
        throw new Error(sendResult.error || 'Telegram sendMessage başarısız');
      }

      await sleep(500);
    }

    console.log('  ✅ Telegram raporu gönderildi!');
  } catch (err) {
    console.log(`  ❌ Telegram hata: ${err.message}`);
  }
}

// ─── Rapor Formatı Oluştur ──────────────────────────────────
function buildReport(stats, totalRaw, totalClean, topDeals, elapsedSec, runMeta) {
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = Math.floor(elapsedSec % 60);
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

  const stopReason = runMeta.targetReached
    ? '🎯 hedef ilanda durduruldu'
    : runMeta.budgetStopped
      ? '⛔ istek bütçesinde durduruldu'
      : runMeta.hardStopped
        ? '⛔ tek deneme başarısız, koşu durduruldu'
      : runMeta.allKeysExhausted
        ? '💀 tüm keyler devre dışı'
        : '✅ normal tamamlandı';

  let report = `📊 *EKRAN KARTI FIRSAT RAPORU*\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  report += `📈 *Genel İstatistikler*\n`;
  report += `• Taranan Segment   : ${runMeta.scannedSegments}/${runMeta.totalSegments}\n`;
  report += `• Bulunan Toplam    : ${totalRaw.toLocaleString('tr')} ilan\n`;
  report += `• Tekrarsız İlan    : ${totalClean.toLocaleString('tr')} ilan\n`;
  report += `• Geçen Süre        : ${minutes} dk ${seconds} sn\n`;
  report += `• HTTP İstekleri     : ${stats.totalRequests} (✅${stats.successfulRequests} ❌${stats.failedRequests})\n`;
  report += `• İstek Limiti      : ${stats.totalRequests}/${MAX_REQUESTS_PER_RUN}\n`;
  report += `• Proxy Maliyeti    : ~${stats.estimatedCredits.toLocaleString('tr')} kredi\n`;
  report += `• AI Analizi        : ${BYPASS_AI ? '⏭️ Atlandı' : '✅ Tamamlandı'}\n`;
  report += `• Durum             : ${stopReason}\n`;
  report += `• Session           : #${SESSION_NUMBER}\n\n`;

  if (topDeals.length > 0) {
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🏆 *EN İYİ ${topDeals.length} FIRSAT İLANI*\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    topDeals.forEach((deal, i) => {
      const medal = medals[i] || `${i + 1}.`;
      report += `${medal} *${deal.baslik || 'İsimsiz'} *\n`;
      report += `   💰 Fiyat       : ${deal.fiyat_str || `${deal.fiyat?.toLocaleString('tr')} TL`}\n`;
      if (deal.gercek_deger_tahmini) {
        report += `   📊 Piyasa Değeri: ~${deal.gercek_deger_tahmini.toLocaleString('tr')} TL\n`;
      }
      if (deal.kar_marji_yuzde) {
        report += `   📈 Kâr Marjı   : %${deal.kar_marji_yuzde}\n`;
      }
      if (deal.konum) {
        report += `   📍 Konum       : ${deal.konum}\n`;
      }
      if (deal.puan) {
        report += `   🤖 AI Puanı    : ${deal.puan}/100\n`;
      }
      if (deal.aciklama) {
        report += `   💬 ${deal.aciklama}\n`;
      }
      report += `   🔗 [İlana Git](${deal.url})\n\n`;
    });
  } else {
    report += `\n⚠️ Bu taramada fırsat olarak değerlendirilen ilan bulunamadı.\n`;
  }

  report += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `🤖 _Rapor otomatik oluşturuldu_\n`;
  report += `🕐 _${new Date().toISOString()}_`;

  return report;
}

// ═══════════════════════════════════════════════════════════════
//  ANA ÇALIŞMA
// ═══════════════════════════════════════════════════════════════
async function main() {
  const startTime = Date.now();

  console.log('');
  console.log('  ═══════════════════════════════════════════════════════');
  console.log('  🎮  SAHİBİNDEN GPU FIRSAT AVCISI v3.0');
  console.log('  🏗️  Otonom AI Scraping Sistemi');
  console.log('  ═══════════════════════════════════════════════════════');
  console.log(`  🔐 Session: #${SESSION_NUMBER}`);
  console.log(`  🤖 AI: ${BYPASS_AI ? 'DEVRE DIŞI' : AI_PROVIDER.toUpperCase()}`);
  console.log('');

  // ── ADIM 1: Master Request — Cloudflare oturumu aç ────────
  const masterHtml = await initSession();
  if (!masterHtml) {
    const errMsg = '❌ *HATA:* Cloudflare oturumu açılamadı! ScrapeOps key veya servis kontrol edin.';
    console.error(errMsg);
    await sendTelegram(errMsg);
    process.exit(1);
  }

  // ── ADIM 2: Fiyat segmentlerine göre paralel çekim ────────
  const segments = getActiveSegments();
  console.log(`\n  📋 ${segments.length} segment taranacak (concurrency: ${CONCURRENCY_LIMIT}, request cap: ${MAX_REQUESTS_PER_RUN})`);

  // ── ADIM 3: Segmentleri çek + parse et (erken durdurma destekli) ──
  console.log('\n  ════════════════════════════════════════════');
  console.log('  📄 HTML ÇEKİM + PARSE');
  console.log('  ════════════════════════════════════════════');

  let allListings = [];
  let totalPages = 0;
  let scannedSegments = 0;
  let targetReached = false;

  const segmentDetails = [];

  for (const [priceMin, priceMax] of segments) {
    if (isRequestBudgetExhausted() || isRunHalted()) {
      break;
    }

    const segLabel = `${priceMin.toLocaleString('tr')}-${priceMax.toLocaleString('tr')} TL`;
    const segmentResult = await scrapeSegment(priceMin, priceMax, true);
    scannedSegments += 1;

    const htmlPages = segmentResult?.htmlPages || [];
    const totalFound = segmentResult?.totalFound || 0;

    totalPages += htmlPages.length;

    let parsedCount = 0;
    if (htmlPages.length > 0) {
      const { listings } = parseAllPages(htmlPages, segLabel);
      parsedCount = listings.length;
      allListings.push(...listings);
      console.log(`  ✅ ${segLabel}: ${parsedCount} ilan parse edildi`);
    } else {
      console.log(`  ⚠️ ${segLabel}: HTML alınamadı veya boş döndü`);
    }

    segmentDetails.push({
      segment: segLabel,
      totalFound,
      pages: htmlPages.length,
      parsed: parsedCount,
    });

    if (allListings.length >= TARGET_LISTINGS_PER_RUN) {
      targetReached = true;
      console.log(`  🎯 Hedefe ulaşıldı: ${allListings.length.toLocaleString('tr')} ham ilan (hedef: ${TARGET_LISTINGS_PER_RUN.toLocaleString('tr')})`);
      break;
    }
  }

  const skippedSegments = Math.max(0, segments.length - scannedSegments);

  // ── ADIM 4: Temizlik + Deduplikasyon ──────────────────────
  const totalRaw = allListings.length;
  console.log(`\n  📊 Ham ilan sayısı: ${totalRaw.toLocaleString('tr')}`);

  allListings = filterInvalidListings(allListings);
  console.log(`  🧹 Geçerli ilan sayısı: ${allListings.length.toLocaleString('tr')}`);

  const filterStats = getLastFilterStats();
  console.log(
    `  🔎 Filtre redleri : ID=${filterStats.missingId} Fiyat=${filterStats.invalidPrice} Başlık=${filterStats.missingTitle}`
  );

  allListings = deduplicateListings(allListings);
  const totalClean = allListings.length;
  console.log(`  🔄 Tekrarsız ilan sayısı: ${totalClean.toLocaleString('tr')}`);

  // ── ADIM 5: AI Analizi ────────────────────────────────────
  let topDeals = [];

  if (allListings.length === 0) {
    console.log('\n  ⚠️ Hiç ilan çekilemedi — AI analizi atlanıyor.');
  } else if (BYPASS_AI) {
    console.log('\n  ⏭️ BYPASS_AI aktif — AI analizi atlanıyor, en ucuz ilanlar seçilecek.');
    topDeals = fallbackSelection(allListings);
  } else {
    // AI key var mı kontrol et
    const hasAIKey = (AI_PROVIDER === 'gemini' && GEMINI_API_KEY) ||
                     (AI_PROVIDER === 'openrouter' && OPENROUTER_API_KEY);

    if (hasAIKey) {
      try {
        const aiResults = await evaluateAllListings(allListings);
        topDeals = selectTopOpportunities(aiResults);
      } catch (err) {
        console.log(`  ❌ AI analizi başarısız: ${err.message}`);
        topDeals = fallbackSelection(allListings);
      }
    } else {
      console.log(`  ⚠️ ${AI_PROVIDER.toUpperCase()} API key tanımlı değil — fallback devrede.`);
      topDeals = fallbackSelection(allListings);
    }
  }

  // ── ADIM 6: Rapor ─────────────────────────────────────────
  const elapsedSec = (Date.now() - startTime) / 1000;
  const stats = getStats();
  const runMeta = {
    scannedSegments,
    totalSegments: segments.length,
    skippedSegments,
    targetReached,
    budgetStopped: !!stats.budgetStopped,
    hardStopped: !!stats.runHalted,
    haltReason: stats.haltReason || '',
    allKeysExhausted: !!stats.allKeysExhausted,
    targetListings: TARGET_LISTINGS_PER_RUN,
  };

  console.log('');
  console.log('  ═══════════════════════════════════════════════════════');
  console.log('  📊 SONUÇ ÖZETİ');
  console.log('  ═══════════════════════════════════════════════════════');
  console.log(`  Taranan segment  : ${runMeta.scannedSegments}/${runMeta.totalSegments} (atlanan: ${runMeta.skippedSegments})`);
  console.log(`  Ham ilan        : ${totalRaw.toLocaleString('tr')}`);
  console.log(`  Tekrarsız ilan  : ${totalClean.toLocaleString('tr')}`);
  console.log(`  HTTP istekleri   : ${stats.totalRequests} (✅${stats.successfulRequests} ❌${stats.failedRequests})`);
  console.log(`  İstek limiti     : ${stats.totalRequests}/${MAX_REQUESTS_PER_RUN}`);
  console.log(`  Proxy kredisi    : ~${stats.estimatedCredits.toLocaleString('tr')}`);
  console.log(`  Toplam süre      : ${Math.floor(elapsedSec / 60)} dk ${Math.floor(elapsedSec % 60)} sn`);
  console.log(`  En iyi fırsatlar : ${topDeals.length} ilan`);
  if (runMeta.targetReached) {
    console.log('  Durum            : 🎯 hedef ilan sayısında kontrollü durdu');
  } else if (runMeta.budgetStopped) {
    console.log('  Durum            : ⛔ request bütçesinde kontrollü durdu');
  } else if (runMeta.hardStopped) {
    console.log(`  Durum            : ⛔ tek deneme başarısız (${runMeta.haltReason || 'neden bilinmiyor'})`);
  } else if (runMeta.allKeysExhausted) {
    console.log('  Durum            : 💀 key havuzu devre dışı kaldı');
  }
  console.log('  ═══════════════════════════════════════════════════════');

  // Telegram raporu gönder
  const report = buildReport(stats, totalRaw, totalClean, topDeals, elapsedSec, runMeta);
  await sendTelegram(report);

  // JSON çıktısı — GitHub Actions artifact olarak kaydedilebilir
  const outputData = {
    timestamp: new Date().toISOString(),
    stats,
    runMeta,
    totalRaw,
    totalClean,
    topDeals,
    segmentDetails,
    totalPages,
    allListings: allListings.slice(0, 500), // İlk 500'ü kaydet (artifact boyut limiti)
    elapsedSeconds: elapsedSec,
  };

  // stdout'a JSON yaz (Actions artifact veya debug için)
  const fs = await import('fs');
  const outputPath = fileURLToPath(new URL('../output.json', import.meta.url));
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(`\n  💾 Sonuçlar kaydedildi: output.json`);

  if (totalClean === 0) {
    console.log('\n  ⚠️ Hiç ilan çekilemedi — ScrapeOps key veya Sahibinden erişimi kontrol edin.');
    process.exit(1);
  }

  console.log('\n  🎉 İşlem başarıyla tamamlandı!');
}

// ── Çalıştır ─────────────────────────────────────────────────
main().catch(err => {
  console.error(`\n  💀 KRİTİK HATA: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
