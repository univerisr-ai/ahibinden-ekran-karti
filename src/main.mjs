/**
 * MAIN.MJS — Ana Orkestratör
 * Playwright tabanlı. ScrapeOps bağımlılığı yok.
 */
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
import { initSession, scrapeSegment, getStats, saveChallengeProofScreenshot, closeBrowser } from './scrapeops.mjs';
import { parseAllPages, deduplicateListings, filterInvalidListings } from './parser.mjs';
import { evaluateAllListings, selectTopOpportunities, fallbackSelection } from './ai_evaluator.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Telegram ────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('  ⚠️ Telegram token/chat ID tanımlı değil.');
    return;
  }
  try {
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

// ─── Rapor ───────────────────────────────────────────────────
function buildReport(stats, totalRaw, totalClean, topDeals, elapsedSec) {
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = Math.floor(elapsedSec % 60);
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

  let report = `📊 *EKRAN KARTI FIRSAT RAPORU*\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  report += `📈 *İstatistikler*\n`;
  report += `• Taranan Segment   : ${getActiveSegments().length}\n`;
  report += `• Bulunan Toplam    : ${totalRaw.toLocaleString('tr')} ilan\n`;
  report += `• Tekrarsız İlan    : ${totalClean.toLocaleString('tr')} ilan\n`;
  report += `• Süre              : ${minutes} dk ${seconds} sn\n`;
  report += `• Sayfa             : ${stats.pagesLoaded}\n`;
  report += `• Maliyet           : ÜCRETSİZ (Playwright)\n`;
  report += `• Session           : #${SESSION_NUMBER}\n\n`;

  if (topDeals.length > 0) {
    report += `🏆 *EN İYİ ${topDeals.length} FIRSAT*\n\n`;
    topDeals.forEach((deal, i) => {
      const medal = medals[i] || `${i + 1}.`;
      report += `${medal} *${deal.baslik || 'İsimsiz'}*\n`;
      report += `   💰 ${deal.fiyat_str || `${deal.fiyat?.toLocaleString('tr')} TL`}\n`;
      if (deal.konum) report += `   📍 ${deal.konum}\n`;
      if (deal.puan) report += `   🤖 AI: ${deal.puan}/100\n`;
      report += `   🔗 [İlana Git](${deal.url})\n\n`;
    });
  } else {
    report += `\n⚠️ Bu taramada fırsat bulunamadı.\n`;
  }

  report += `🤖 _Otomatik rapor — ${new Date().toISOString()}_`;
  return report;
}

// ─── ANA ─────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();

  console.log('');
  console.log('  ═══════════════════════════════════════════════════════');
  console.log('  🎮  SAHİBİNDEN GPU FIRSAT AVCISI v4.0');
  console.log('  🌐  ScrapeOps Otomatik Kademe Motoru');
  console.log('  ═══════════════════════════════════════════════════════');
  console.log(`  🔐 Session: #${SESSION_NUMBER}`);
  console.log(`  🤖 AI: ${BYPASS_AI ? 'DEVRE DIŞI' : AI_PROVIDER.toUpperCase()}`);
  console.log('');

  // ADIM 1: Cloudflare bypass
  const session = await initSession();
  if (!session) {
    await saveChallengeProofScreenshot('init-session-failed');
    const msg = '❌ Cloudflare geçilemedi! Challenge tamamlanmadı veya erişim engellendi.';
    console.error(`  ${msg}`);
    await sendTelegram(msg);
    await closeBrowser();
    process.exit(1);
  }

  // ADIM 2: Segmentleri çek
  const segments = getActiveSegments();
  console.log(`\n  📋 ${segments.length} segment çekilecek`);

  const segmentResults = [];
  for (const [priceMin, priceMax] of segments) {
    const result = await scrapeSegment(priceMin, priceMax);
    segmentResults.push({ priceMin, priceMax, result });

    if (result.status === 'ACTION_REQUIRED') {
      console.log('\n  🛑 Scrape.do hesap/domain kısıtı algılandı. Taramayı erken durduruyorum.');
      await sendTelegram('🛑 Scrape.do bu domain için ACTION REQUIRED döndü. support@scrape.do üzerinden whitelist talep etmeniz gerekiyor.');
      break;
    }
  }

  // ADIM 3: Parse
  console.log('\n  ════════════════════════════════════════════');
  console.log('  📄 PARSE');
  console.log('  ════════════════════════════════════════════');

  let allListings = [];
  for (const { priceMin, priceMax, result } of segmentResults) {
    const label = `${priceMin.toLocaleString('tr')}-${priceMax.toLocaleString('tr')} TL`;
    const { htmlPages = [] } = result;
    if (htmlPages.length > 0) {
      const { listings } = parseAllPages(htmlPages, label);
      allListings.push(...listings);
      console.log(`  ✅ ${label}: ${listings.length} ilan`);
    }
  }

  // ADIM 4: Temizlik
  const totalRaw = allListings.length;
  console.log(`\n  📊 Ham: ${totalRaw.toLocaleString('tr')}`);

  allListings = filterInvalidListings(allListings);
  console.log(`  🧹 Geçerli: ${allListings.length.toLocaleString('tr')}`);

  allListings = deduplicateListings(allListings);
  const totalClean = allListings.length;
  console.log(`  🔄 Tekrarsız: ${totalClean.toLocaleString('tr')}`);

  // ADIM 5: AI
  let topDeals = [];
  if (allListings.length === 0) {
    console.log('\n  ⚠️ Hiç ilan çekilemedi.');
    await sendTelegram('⚠️ Hiç ilan çekilemedi. Tarama tamamlandı ancak sonuç bulunamadı.');
  } else if (BYPASS_AI) {
    console.log('\n  ⏭️ AI atlandı, en ucuzlar seçilecek.');
    topDeals = fallbackSelection(allListings);
  } else {
    const hasKey = (AI_PROVIDER === 'gemini' && GEMINI_API_KEY) ||
                   (AI_PROVIDER === 'openrouter' && OPENROUTER_API_KEY);
    if (hasKey) {
      try {
        const aiResults = await evaluateAllListings(allListings);
        topDeals = selectTopOpportunities(aiResults);
      } catch (err) {
        console.log(`  ❌ AI hatası: ${err.message}`);
        topDeals = fallbackSelection(allListings);
      }
    } else {
      topDeals = fallbackSelection(allListings);
    }
  }

  // ADIM 6: Rapor
  const elapsedSec = (Date.now() - startTime) / 1000;
  const st = getStats();

  console.log('');
  console.log('  ═══════════════════════════════════════════════════════');
  console.log('  📊 SONUÇ');
  console.log('  ═══════════════════════════════════════════════════════');
  console.log(`  Ham ilan        : ${totalRaw.toLocaleString('tr')}`);
  console.log(`  Tekrarsız       : ${totalClean.toLocaleString('tr')}`);
  console.log(`  Sayfalar        : ${st.pagesLoaded}`);
  console.log(`  Süre            : ${Math.floor(elapsedSec / 60)} dk ${Math.floor(elapsedSec % 60)} sn`);
  console.log(`  Fırsatlar       : ${topDeals.length}`);
  console.log(`  Maliyet         : ÜCRETSİZ`);
  console.log('  ═══════════════════════════════════════════════════════');

  const report = buildReport(st, totalRaw, totalClean, topDeals, elapsedSec);
  await sendTelegram(report);

  // JSON kaydet
  const fs = await import('fs');
  const { fileURLToPath } = await import('url');
  const outputData = {
    timestamp: new Date().toISOString(),
    stats: st,
    totalRaw,
    totalClean,
    topDeals,
    allListings: allListings.slice(0, 500),
    elapsedSeconds: elapsedSec,
  };
  const outputPath = fileURLToPath(new URL('../output.json', import.meta.url));
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(`\n  💾 Sonuçlar: output.json`);

  await closeBrowser();

  
    if (totalClean === 0) {
      await sendTelegram('⚠️ *HİÇ İLAN ÇEKİLEMEDİ!*\n\nErişim engeli/Cloudflare olabilir. Lütfen kontrol edin.');
      console.log('\n  ⚠️ Hiç ilan yok — erişim kontrolü gerekebilir.');
      process.exit(1);
    }


  console.log('\n  🎉 Tamamlandı!');
}

main().catch(async err => {
  console.error(`\n  💀 KRİTİK: ${err.message}`);
  console.error(err.stack);

  await saveChallengeProofScreenshot('fatal-main-catch');
  
  if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      const errorMsg = `💀 *Sistem Çöktü!*\n\n*Hata:* \`${err.message}\`\n\n_Detaylı loglar için GitHub Actions'ı kontrol edin._`;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: errorMsg,
          parse_mode: 'Markdown'
        }),
      });
    } catch(e) {}
  }

  await closeBrowser();
  process.exit(1);
});
