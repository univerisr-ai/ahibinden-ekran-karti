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
let telegramTargetModeLogged = false;

function uniqueNonEmpty(values) {
  return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)));
}

function normalizeTelegramChatId(value) {
  // Secret'ta Unicode eksi veya gorunmez karakterler olabiliyor; normalize et.
  return String(value || '')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, '-')
    .replace(/^['"`]+/, '')
    .replace(/['"`]+$/, '')
    .replace(/^chat_id\s*[:=]\s*/i, '')
    .trim();
}

function expandTelegramChatIds(values) {
  const expanded = [];
  for (const value of values) {
    const cleaned = normalizeTelegramChatId(value);
    if (!cleaned) continue;

    for (const part of cleaned.split(/[\n,;\s]+/)) {
      const normalized = normalizeTelegramChatId(part);
      if (normalized) expanded.push(normalized);
    }
  }
  return uniqueNonEmpty(expanded);
}

function maskChatId(chatId) {
  const s = String(chatId || '').trim();
  if (!s) return 'n/a';
  if (s.length <= 4) return '***';
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}

function isGroupChatId(chatId) {
  return /^-\d+$/.test(normalizeTelegramChatId(chatId));
}

function getTelegramTargets() {
  const tokens = uniqueNonEmpty([
    TELEGRAM_TOKEN,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_BOT_TOKEN_1,
    process.env.TELEGRAM_BOT_TOKEN_2,
  ]);

  const rawChatIds = expandTelegramChatIds([
    process.env.TELEGRAM_CHAT_ID,
    TELEGRAM_CHAT_ID,
    process.env.TELEGRAM_CHAT_ID_1,
    process.env.TELEGRAM_CHAT_ID_2,
  ]);

  const chatIds = rawChatIds.filter((x) => isGroupChatId(x));
  const skippedNonGroupIds = rawChatIds.filter((x) => !isGroupChatId(x));

  if (!telegramTargetModeLogged) {
    if (chatIds.length > 0) {
      console.log(`  ℹ️ Telegram hedef modu: group-only (${chatIds.length} chat).`);
      if (skippedNonGroupIds.length > 0) {
        const sample = skippedNonGroupIds.slice(0, 2).map(maskChatId).join(', ');
        console.log(
          `  ⚠️ ${skippedNonGroupIds.length} adet grup-disindaki chat id yoksayildi (DM engeli). Ornek: ${sample}`,
        );
      }
    } else {
      if (rawChatIds.length > 0) {
        console.log('  ⚠️ TELEGRAM_CHAT_ID tanimli ama grup formatina uymuyor. Ornek format: -1001234567890 (tirnak/@ kullanmayin).');
      } else {
        console.log('  ⚠️ Gecerli grup TELEGRAM_CHAT_ID bulunamadi. Bot ozele yazmayacak.');
      }
    }
    telegramTargetModeLogged = true;
  }

  return { tokens, chatIds };
}

function isCantInitiateConversation(status, errText = '') {
  return status === 403 && /can't initiate conversation with a user/i.test(String(errText));
}

async function sendTelegramChunk(chunk, useMarkdown = true) {
  const { tokens, chatIds } = getTelegramTargets();
  if (tokens.length === 0 || chatIds.length === 0) {
    throw new Error('Telegram token/gecerli grup chat ID bulunamadi.');
  }

  const errors = [];

  for (const token of tokens) {
    for (const chatId of chatIds) {
      const payload = {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      };

      if (useMarkdown) {
        payload.parse_mode = 'Markdown';
      }

      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return;
      }

      const errText = await response.text();

      // Markdown parse hatalarında aynı hedefe düz metin fallback ile tekrar dene.
      if (useMarkdown && response.status === 400 && /can't parse entities/i.test(errText)) {
        const plainResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
            disable_web_page_preview: true,
          }),
        });

        if (plainResponse.ok) {
          console.log('  ℹ️ Telegram Markdown parse hatasi: düz metin fallback kullanildi.');
          return;
        }

        const plainErrText = await plainResponse.text();
        errors.push({ status: plainResponse.status, errText: plainErrText, chatId });
        continue;
      }

      if (isCantInitiateConversation(response.status, errText)) {
        console.log(`  ⚠️ Telegram hedefi reddetti (${maskChatId(chatId)}), alternatif hedef deneniyor.`);
      }

      errors.push({ status: response.status, errText, chatId });
    }
  }

  const allCantInitiate =
    errors.length > 0 && errors.every((e) => isCantInitiateConversation(e.status, e.errText));
  if (allCantInitiate) {
    throw new Error(
      'Telegram 403: Bot hedef kullanıcıyla konuşma başlatamıyor. Bota /start gönderin veya geçerli TELEGRAM_CHAT_ID kullanın.',
    );
  }

  const lastErr = errors[errors.length - 1];
  throw new Error(`Telegram API Error: ${lastErr?.status || 'unknown'} - ${lastErr?.errText || 'unknown error'}`);
}

// ─── Telegram ────────────────────────────────────────────────
async function sendTelegram(text) {
  const { tokens, chatIds } = getTelegramTargets();
  if (tokens.length === 0 || chatIds.length === 0) {
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
      await sendTelegramChunk(chunk, true);
      await sleep(500);
    }
    console.log('  ✅ Telegram raporu gönderildi!');
  } catch (err) {
    console.log(`  ❌ Telegram hata: ${err.message}`);
  }
}

async function sendTelegramPhoto(photoPath, caption = "Ekran Görüntüsü / Screenshot") {
  const { tokens, chatIds } = getTelegramTargets();
  if (tokens.length === 0 || chatIds.length === 0) {
    console.log('  ⚠️ Telegram token/chat ID tanımlı değil, fotoğraf gönderilmiyor.');
    return;
  }
  try {
    const fs = await import('fs');
    if (!fs.existsSync(photoPath)) {
      console.log(`  ❌ Fotoğraf bulunamadı: ${photoPath}`);
      return;
    }
    
    const buffer = fs.readFileSync(photoPath);
    const errors = [];

    for (const token of tokens) {
      for (const chatId of chatIds) {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('caption', caption);

        const blob = new Blob([buffer], { type: 'image/png' });
        formData.append('photo', blob, 'cf_proof.png');

        console.log(`  📸 Telegram'a fotoğraf gönderiliyor: ${photoPath} -> ${maskChatId(chatId)}`);
        const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          console.log('  ✅ Telegram resimli rapor gönderildi!');
          return;
        }

        const errText = await response.text();
        if (isCantInitiateConversation(response.status, errText)) {
          console.log(`  ⚠️ Telegram hedefi reddetti (${maskChatId(chatId)}), alternatif hedef deneniyor.`);
        }
        errors.push({ status: response.status, errText, chatId });
      }
    }

    const allCantInitiate =
      errors.length > 0 && errors.every((e) => isCantInitiateConversation(e.status, e.errText));
    if (allCantInitiate) {
      throw new Error('Telegram 403: Bot hedef kullanıcıyla konuşma başlatamıyor. Bota /start gönderin veya geçerli TELEGRAM_CHAT_ID kullanın.');
    }

    const lastErr = errors[errors.length - 1];
    throw new Error(`Telegram API Error: ${lastErr?.status || 'unknown'} - ${lastErr?.errText || 'unknown error'}`);
  } catch (err) {
    console.log(`  ❌ Telegram fotoğraf gönderme hatası: ${err.message}`);
  }
}

async function sendTelegramDocument(filePath, caption = 'Detayli tarama dosyasi') {
  const { tokens, chatIds } = getTelegramTargets();
  if (tokens.length === 0 || chatIds.length === 0) {
    console.log('  ⚠️ Telegram token/chat ID tanımlı değil, dosya gönderilmiyor.');
    return;
  }

  try {
    const fs = await import('fs');
    const path = await import('path');

    if (!fs.existsSync(filePath)) {
      console.log(`  ❌ Gönderilecek dosya bulunamadı: ${filePath}`);
      return;
    }

    const stat = fs.statSync(filePath);
    const telegramLimitBytes = 49 * 1024 * 1024;
    if (stat.size > telegramLimitBytes) {
      console.log(`  ⚠️ Dosya çok büyük (${Math.round(stat.size / 1024 / 1024)} MB), Telegram'a yüklenemedi.`);
      await sendTelegram(`⚠️ output.json dosyasi cok buyuk oldugu icin Telegram'a yuklenemedi (${Math.round(stat.size / 1024 / 1024)} MB).`);
      return;
    }

    const fileName = path.basename(filePath);
    const buffer = fs.readFileSync(filePath);
    const errors = [];

    for (const token of tokens) {
      for (const chatId of chatIds) {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('caption', String(caption).slice(0, 1024));

        const blob = new Blob([buffer], { type: 'application/json' });
        formData.append('document', blob, fileName);

        console.log(`  📎 Telegram'a dosya gönderiliyor: ${fileName} -> ${maskChatId(chatId)}`);
        const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          console.log('  ✅ Telegram dosya gönderimi başarılı!');
          return;
        }

        const errText = await response.text();
        if (isCantInitiateConversation(response.status, errText)) {
          console.log(`  ⚠️ Telegram hedefi reddetti (${maskChatId(chatId)}), alternatif hedef deneniyor.`);
        }
        errors.push({ status: response.status, errText, chatId });
      }
    }

    const allCantInitiate =
      errors.length > 0 && errors.every((e) => isCantInitiateConversation(e.status, e.errText));
    if (allCantInitiate) {
      throw new Error('Telegram 403: Bot hedef kullanıcıyla konuşma başlatamıyor. Bota /start gönderin veya geçerli TELEGRAM_CHAT_ID kullanın.');
    }

    const lastErr = errors[errors.length - 1];
    throw new Error(`Telegram API Error: ${lastErr?.status || 'unknown'} - ${lastErr?.errText || 'unknown error'}`);
  } catch (err) {
    console.log(`  ❌ Telegram dosya gönderme hatası: ${err.message}`);
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
  if (!session || !session.ok) {
    await saveChallengeProofScreenshot('init-session-failed');
    const initCode = session?.code || 'UNKNOWN_INIT_ERROR';

    let msg = '❌ Cloudflare gecilemedi! Challenge tamamlanmadi veya erisim engellendi.';
    if (initCode === 'COOKIE_REQUIRED_MISSING') {
      msg = '❌ SAHIBINDEN_COOKIES zorunlu ama bulunamadi.';
    } else if (initCode === 'COOKIE_PARSE_INVALID') {
      msg = '❌ SAHIBINDEN_COOKIES/cookies.json JSON formati gecersiz.';
    } else if (initCode === 'COOKIE_SCHEMA_INVALID') {
      msg = '❌ Cookie payload semasi gecersiz (name/value/domain-url).';
    } else if (initCode === 'COOKIE_EMPTY_AFTER_FILTER') {
      msg = '❌ Kullanilabilir cookie kalmadi (expires gecmis olabilir).';
    } else if (initCode === 'COOKIE_ADD_FAILED') {
      msg = '❌ Cookie tarayiciya eklenemedi.';
    } else if (initCode === 'AUTH_REQUIRED') {
      msg = '❌ Login gerekli sayfaya dusuldu. Cookie gecersiz veya eksik olabilir.';
    } else if (initCode === 'CHALLENGE_TIMEOUT') {
      msg = '❌ Challenge zaman asimina ugradi. Otomatik dogrulama tamamlanmadi (cf_proof.png artifactini kontrol edin).';
    } else if (initCode === 'PROXY_INIT_FAILED') {
      msg = '❌ Baslangic asamasinda proxy/hedef erisim hatasi alindi.';
    } else if (initCode === 'FINGERPRINT_POLICY_FAILED') {
      msg = '❌ Runtime profil policy kontrolu strict modda basarisiz oldu.';
    }

    const safeCode = String(initCode).replace(/_/g, '-');
    console.error(`  ${msg} [${initCode}]`);
    await sendTelegram(`${msg}\nKod: ${safeCode}`);
    await closeBrowser();
    process.exit(1);
  }

  if (session.cookieSource && session.cookieSource !== 'none') {
    console.log(`  🍪 Session cookie source: ${session.cookieSource} (${session.cookieCount})`);
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
    sessionNumber: SESSION_NUMBER,
    stats: st,
    totalRaw,
    totalClean,
    segmentBreakdown: segmentResults.map(({ priceMin, priceMax, result }) => ({
      priceMin,
      priceMax,
      status: result?.status || 'UNKNOWN',
      pages: result?.pages || 0,
      totalFound: result?.totalFound || 0,
    })),
    topDeals,
    allListings,
    elapsedSeconds: elapsedSec,
  };
  const outputPath = fileURLToPath(new URL('../output.json', import.meta.url));
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(`\n  💾 Sonuçlar: output.json`);

  await sendTelegramDocument(
    outputPath,
    `📎 Detayli tarama dosyasi\nSession: #${SESSION_NUMBER}\nToplam: ${totalClean.toLocaleString('tr')} ilan`,
  );

  if (totalClean === 0) {
    await saveChallengeProofScreenshot('zero-listings');
    await sendTelegramPhoto('cf_proof.png', '⚠️ HİÇ İLAN ÇEKİLEMEDİ! - Cloudflare engelini kontrol edin.');
    await sendTelegram('⚠️ *HİÇ İLAN ÇEKİLEMEDİ!*\n\nErişim engeli/Cloudflare olabilir. Lütfen kontrol edin.');
    console.log('\n  ⚠️ Hiç ilan yok — erişim kontrolü gerekebilir.');
    await closeBrowser();
    process.exit(1);
  }

  await closeBrowser();

  console.log('\n  🎉 Tamamlandı!');
}

main().catch(async err => {
  console.error(`\n  💀 KRİTİK: ${err.message}`);
  console.error(err.stack);

  await saveChallengeProofScreenshot('fatal-main-catch');
  
  if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      const errorMsg = `💀 *Sistem Çöktü!*\n\n*Hata:* \`${err.message}\`\n\n_Detaylı loglar için GitHub Actions'ı kontrol edin._`;
      await sendTelegram(errorMsg);
      await sendTelegramPhoto('cf_proof.png', `💀 Sistem Çöktü: ${err.message.substring(0, 100)}`);
    } catch(e) {
      console.error(`  ❌ Fatal catch içinde Telegram hata: ${e.message}`);
    }
  }

  await closeBrowser();
  process.exit(1);
});
