/**
 * ═══════════════════════════════════════════════════════════════
 *  MAIN.MJS — Ana Orkestratör
 *  Tüm modülleri sırayla çağırır, zamanı ölçer, Telegram raporu atar
 * ═══════════════════════════════════════════════════════════════
 */
import pLimit from 'p-limit';
import {
  SESSION_NUMBER,
  TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID,
  CONCURRENCY_LIMIT,
  BYPASS_AI,
  AI_PROVIDER,
  GEMINI_API_KEY,
  OPENROUTER_API_KEY,
  getActiveSegments,
} from './config.mjs';
import { initSession, scrapeSegment, getStats } from './scrapeops.mjs';
import { parseAllPages, deduplicateListings, filterInvalidListings } from './parser.mjs';
import { evaluateAllListings, selectTopOpportunities, fallbackSelection } from './ai_evaluator.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Telegram Mesaj Gönderici ────────────────────────────────
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
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: chunk,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });
      await sleep(500);
    }

    console.log('  ✅ Telegram raporu gönderildi!');
  } catch (err) {
    console.log(`  ❌ Telegram hata: ${err.message}`);
  }
}

// ─── Rapor Formatı Oluştur ──────────────────────────────────
function buildReport(stats, totalRaw, totalClean, topDeals, elapsedSec) {
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = Math.floor(elapsedSec % 60);
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

  let report = `📊 *EKRAN KARTI FIRSAT RAPORU*\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  report += `📈 *Genel İstatistikler*\n`;
  report += `• Taranan Segment   : ${getActiveSegments().length}\n`;
  report += `• Bulunan Toplam    : ${totalRaw.toLocaleString('tr')} ilan\n`;
  report += `• Tekrarsız İlan    : ${totalClean.toLocaleString('tr')} ilan\n`;
  report += `• Geçen Süre        : ${minutes} dk ${seconds} sn\n`;
  report += `• HTTP İstekleri     : ${stats.totalRequests} (✅${stats.successfulRequests} ❌${stats.failedRequests})\n`;
  report += `• Proxy Maliyeti    : ~${stats.estimatedCredits.toLocaleString('tr')} kredi\n`;
  report += `• AI Analizi        : ${BYPASS_AI ? '⏭️ Atlandı' : '✅ Tamamlandı'}\n`;
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
  console.log(`\n  📋 ${segments.length} segment paralel çekilecek (concurrency: ${CONCURRENCY_LIMIT})`);

  const limit = pLimit(CONCURRENCY_LIMIT);
  const segmentResults = await Promise.allSettled(
    segments.map(([priceMin, priceMax]) =>
      limit(() => scrapeSegment(priceMin, priceMax, true))
    )
  );

  // ── ADIM 3: HTML sayfalarını parse et ─────────────────────
  console.log('\n  ════════════════════════════════════════════');
  console.log('  📄 HTML PARSE EDİLİYOR');
  console.log('  ════════════════════════════════════════════');

  let allListings = [];
  let totalPages = 0;

  for (let i = 0; i < segmentResults.length; i++) {
    const result = segmentResults[i];
    const [priceMin, priceMax] = segments[i];
    const segLabel = `${priceMin.toLocaleString('tr')}-${priceMax.toLocaleString('tr')} TL`;

    if (result.status === 'fulfilled' && result.value) {
      const { htmlPages = [], totalFound = 0 } = result.value;
      totalPages += htmlPages.length;

      if (htmlPages.length > 0) {
        const { listings } = parseAllPages(htmlPages, segLabel);
        allListings.push(...listings);
        console.log(`  ✅ ${segLabel}: ${listings.length} ilan parse edildi`);
      }
    } else {
      console.log(`  ❌ ${segLabel}: Segment başarısız — ${result.reason?.message || 'Bilinmeyen hata'}`);
    }
  }

  // ── ADIM 4: Temizlik + Deduplikasyon ──────────────────────
  const totalRaw = allListings.length;
  console.log(`\n  📊 Ham ilan sayısı: ${totalRaw.toLocaleString('tr')}`);

  allListings = filterInvalidListings(allListings);
  console.log(`  🧹 Geçerli ilan sayısı: ${allListings.length.toLocaleString('tr')}`);

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

  console.log('');
  console.log('  ═══════════════════════════════════════════════════════');
  console.log('  📊 SONUÇ ÖZETİ');
  console.log('  ═══════════════════════════════════════════════════════');
  console.log(`  Ham ilan        : ${totalRaw.toLocaleString('tr')}`);
  console.log(`  Tekrarsız ilan  : ${totalClean.toLocaleString('tr')}`);
  console.log(`  HTTP istekleri   : ${stats.totalRequests} (✅${stats.successfulRequests} ❌${stats.failedRequests})`);
  console.log(`  Proxy kredisi    : ~${stats.estimatedCredits.toLocaleString('tr')}`);
  console.log(`  Toplam süre      : ${Math.floor(elapsedSec / 60)} dk ${Math.floor(elapsedSec % 60)} sn`);
  console.log(`  En iyi fırsatlar : ${topDeals.length} ilan`);
  console.log('  ═══════════════════════════════════════════════════════');

  // Telegram raporu gönder
  const report = buildReport(stats, totalRaw, totalClean, topDeals, elapsedSec);
  await sendTelegram(report);

  // JSON çıktısı — GitHub Actions artifact olarak kaydedilebilir
  const outputData = {
    timestamp: new Date().toISOString(),
    stats,
    totalRaw,
    totalClean,
    topDeals,
    allListings: allListings.slice(0, 500), // İlk 500'ü kaydet (artifact boyut limiti)
    elapsedSeconds: elapsedSec,
  };

  // stdout'a JSON yaz (Actions artifact veya debug için)
  const fs = await import('fs');
  const outputPath = new URL('../output.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
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
