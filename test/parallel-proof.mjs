/**
 * PARALLEL PROOF OF CONCEPT — ANA PROJEYE DOKUNMADAN TEST
 *
 * Bu script:
 * 1. Mevcut cookie/storage state sistemini import edip test eder
 * 2. Playwright ile 1 context + 10 sayfa (sekme) açar
 * 3. 10 farklı Sahibinden URL'ini paralel çeker
 * 4. Session/Cookie paylaşımını doğrular
 * 5. Paralel vs sıralı süre karşılaştırması yapar
 *
 * HİÇBİR ANA DOSYA DEĞİŞMEZ.
 */

import { chromium } from 'playwright';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Mevcut proje modüllerini import et (ana projeye dokunmaz) ──
import { loadAllSahibindenCookies } from '../src/cookies.mjs';
import { loadSahibindenStorageState } from '../src/session_state.mjs';
import { ITEMS_PER_PAGE, BASE_URL } from '../src/config.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Sabitler ─────────────────────────────────────────────────
const PARALLEL_COUNT = 10;
const NAV_TIMEOUT = 60000;
const REPORT_PATH = resolve(process.cwd(), 'test', 'parallel-proof-report.json');
const SCREENSHOT_DIR = resolve(process.cwd(), 'test', 'screenshots');

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function buildSahibindenUrl(offset, priceMin = 0, priceMax = 50000) {
  const url = new URL(BASE_URL);
  url.searchParams.set('pagingOffset', String(offset));
  url.searchParams.set('pagingSize', String(ITEMS_PER_PAGE));
  url.searchParams.set('sorting', 'date_desc');
  url.searchParams.set('price_min', String(priceMin));
  url.searchParams.set('price_max', String(priceMax));
  return url.toString();
}

// ─── ADIM 1: Cookie Sistemini Test Et ─────────────────────────
function step1_cookieSystemTest() {
  console.log('');
  console.log('  ════════════════════════════════════════════');
  console.log('  ADIM 1: COOKIE SİSTEM TESTİ');
  console.log('  ════════════════════════════════════════════');

  const results = {};

  // 1a. Storage state test
  console.log('\n  [1a] Storage state yükleniyor...');
  const saved = loadSahibindenStorageState();
  results.storageState = {
    source: saved.source,
    cookieCount: saved.cookieCount,
    originCount: saved.originCount,
    droppedExpired: saved.droppedExpired,
    droppedUnrelated: saved.droppedUnrelated,
    hasState: !!saved.storageState,
  };
  console.log(`  Kaynak: ${saved.source}`);
  console.log(`  Cookie sayısı: ${saved.cookieCount}`);
  console.log(`  Süresi geçmiş: ${saved.droppedExpired}`);
  console.log(`  İlgisiz: ${saved.droppedUnrelated}`);

  if (saved.cookieCount > 0) {
    const now = Math.floor(Date.now() / 1000);
    const keyCookies = ['csid', 'cwt', 'st'];
    for (const c of saved.storageState.cookies) {
      if (keyCookies.includes(c.name) && c.expires) {
        const days = Math.round((c.expires - now) / 86400);
        console.log(`  Cookie ${c.name}: expires in ${days} gün (${new Date(c.expires * 1000).toISOString()})`);
      }
    }
  }

  // 1b. Ek cookie (env/dosya) test
  console.log('\n  [1b] Ek cookie yükleniyor (env/dosya)...');
  const extraCookies = loadAllSahibindenCookies();
  results.extraCookies = {
    count: extraCookies.length,
    names: extraCookies.map(c => c.name),
    sampleDomains: [...new Set(extraCookies.map(c => c.domain || '').filter(Boolean))],
  };
  console.log(`  Ek cookie sayısı: ${extraCookies.length}`);
  if (extraCookies.length > 0) {
    console.log(`  İsimler: ${extraCookies.map(c => c.name).join(', ')}`);
  }

  console.log('\n  ✅ Cookie sistemi testi tamam.');
  return results;
}

// ─── ADIM 2: Playwright Browser + 10 Sekme Aç ────────────────
async function step2_openBrowserWithPages() {
  console.log('');
  console.log('  ════════════════════════════════════════════');
  console.log('  ADIM 2: PLAYWRIGHT + 10 SEKMELİ CONTEXT');
  console.log('  ════════════════════════════════════════════');

  console.log('\n  Chromium başlatılıyor...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
  });

  console.log('  Context oluşturuluyor...');
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1366, height: 900 },
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  });

  // Kaydedilmiş cookie'leri yükle
  const saved = loadSahibindenStorageState();
  if (saved.storageState && saved.cookieCount > 0) {
    await context.addCookies(saved.storageState.cookies);
    console.log(`  ${saved.cookieCount} adet kayıtlı cookie yüklendi (kaynak: ${saved.source}).`);
  }

  const extraCookies = loadAllSahibindenCookies();
  if (extraCookies.length > 0) {
    await context.addCookies(extraCookies);
    console.log(`  ${extraCookies.length} adet ek cookie yüklendi (env/dosya).`);
  }

  // Cookie'leri context'ten oku
  const contextCookies = await context.cookies();
  console.log(`  Context'te toplam cookie: ${contextCookies.length}`);

  // 10 sayfa (sekme) oluştur
  console.log(`\n  ${PARALLEL_COUNT} adet sayfa (sekme) oluşturuluyor...`);
  const pages = [];
  for (let i = 0; i < PARALLEL_COUNT; i++) {
    const page = await context.newPage();
    pages.push(page);
  }
  console.log(`  ${pages.length} sekme oluşturuldu.`);

  const result = {
    contextCookies: contextCookies.length,
    cookieNames: contextCookies.map(c => c.name),
    cookieDomains: [...new Set(contextCookies.map(c => c.domain))],
    pageCount: pages.length,
  };

  return { browser, context, pages, info: result };
}

// ─── ADIM 3: 10 URL'ini Paralel Çek ──────────────────────────
async function step3_parallelFetch(pages) {
  console.log('');
  console.log('  ════════════════════════════════════════════');
  console.log('  ADIM 3: 10 SAYFA PARALEL ÇEKİM');
  console.log('  ════════════════════════════════════════════');

  // 10 farklı offset ile URL oluştur
  const urls = [];
  for (let i = 0; i < PARALLEL_COUNT; i++) {
    urls.push({
      index: i,
      offset: i * ITEMS_PER_PAGE,
      url: buildSahibindenUrl(i * ITEMS_PER_PAGE),
    });
  }

  console.log(`\n  ${urls.length} URL paralel çekiliyor...`);
  const startTime = Date.now();

  const pageResults = await Promise.allSettled(
    pages.map(async (page, idx) => {
      const { index, offset, url } = urls[idx];
      const label = `Sayfa ${index + 1} (offset=${offset})`;
      const pageStart = Date.now();

      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT,
        });

        await sleep(1000);

        const html = await page.content();
        const elapsed = Date.now() - pageStart;
        const status = response ? response.status() : 0;
        const pageTitle = await page.title().catch(() => '');
        const currentUrl = page.url();

        // Sayfadaki cookie'leri oku (context.cookies tümünü verir)
        const urlObj = new URL(currentUrl);
        const pageCookies = (await page.context().cookies())
          .filter(c => c.domain.includes('sahibinden') || c.domain.includes('shbdn'));

        console.log(`  [${label}] HTTP ${status} | ${elapsed}ms | ${Math.round(html.length / 1024)}KB | ${pageTitle.substring(0, 50)}`);

        return {
          index,
          offset,
          url: currentUrl,
          status,
          elapsed,
          sizeKB: Math.round(html.length / 1024),
          title: pageTitle,
          htmlPreview: html.substring(0, 200),
          cookieCount: pageCookies.length,
          cookieNames: pageCookies.map(c => c.name),
        };
      } catch (err) {
        const elapsed = Date.now() - pageStart;
        console.log(`  [${label}] HATA: ${err.message} (${elapsed}ms)`);
        return {
          index,
          offset,
          url,
          status: 0,
          elapsed,
          sizeKB: 0,
          error: err.message,
          title: '',
          htmlPreview: '',
          cookieCount: 0,
          cookieNames: [],
        };
      }
    })
  );

  const parallelTotalTime = Date.now() - startTime;

  const results = pageResults.map(r =>
    r.status === 'fulfilled' ? r.value : {
      index: -1,
      offset: 0,
      url: '',
      status: 0,
      elapsed: 0,
      sizeKB: 0,
      error: r.reason?.message || 'Promise rejected',
      title: '',
      htmlPreview: '',
      cookieCount: 0,
      cookieNames: [],
    }
  );

  // İstatistikler
  const successful = results.filter(r => r.status >= 200 && r.status < 400);
  const failed = results.filter(r => r.status === 0 || r.status >= 400);
  const avgTime = results.reduce((s, r) => s + r.elapsed, 0) / results.length;
  const totalSize = results.reduce((s, r) => s + r.sizeKB, 0);

  console.log(`\n  📊 Paralel Çekim İstatistikleri:`);
  console.log(`     Başarılı: ${successful.length}/${results.length}`);
  console.log(`     Başarısız: ${failed.length}/${results.length}`);
  console.log(`     Toplam süre: ${parallelTotalTime}ms`);
  console.log(`     Ortalama sayfa: ${Math.round(avgTime)}ms`);
  console.log(`     Toplam boyut: ${totalSize}KB`);

  return {
    parallelTotalTime,
    results,
    stats: {
      successful: successful.length,
      failed: failed.length,
      avgTime: Math.round(avgTime),
      totalSize,
    },
  };
}

// ─── ADIM 4: Session Paylaşımı Kontrolü ───────────────────────
async function step4_sessionCheck(pages) {
  console.log('');
  console.log('  ════════════════════════════════════════════');
  console.log('  ADIM 4: SESSION/COOKIE PAYLAŞIM KONTROLÜ');
  console.log('  ════════════════════════════════════════════');

  // Her sayfanın context'indeki cookie'leri karşılaştır
  // (Hepsi aynı context'i paylaştığı için aynı olmalı)
  const allCookies = [];
  for (let i = 0; i < pages.length; i++) {
    const cookies = await pages[i].context().cookies();
    allCookies.push(cookies.map(c => `${c.name}=${c.value.substring(0, 10)}...`).join('; '));
  }

  const uniqueSessions = new Set(allCookies);
  console.log(`  Farklı cookie seti sayısı: ${uniqueSessions.size} (beklenen: 1)`);

  if (uniqueSessions.size === 1) {
    console.log('  ✅ Tüm sayfalar AYNI session/cookie setini paylaşıyor!');
  } else {
    console.log('  ⚠️ UYARI: Sayfalar farklı cookie setlerine sahip!');
  }

  return {
    uniqueSessionCount: uniqueSessions.size,
    shared: uniqueSessions.size === 1,
    sampleCookieSet: allCookies[0] || 'empty',
  };
}

// ─── ADIM 5: Sıralı Çekim Karşılaştırması (opsiyonel, 3 sayfa) ─
async function step5_sequentialComparison() {
  console.log('');
  console.log('  ════════════════════════════════════════════');
  console.log('  ADIM 5: SIRALI ÇEKİM KARŞILAŞTIRMASI (3 sayfa)');
  console.log('  ════════════════════════════════════════════');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  });

  const saved = loadSahibindenStorageState();
  if (saved.storageState && saved.cookieCount > 0) {
    await context.addCookies(saved.storageState.cookies);
  }

  const page = await context.newPage();
  const sequentialTimes = [];
  const startTime = Date.now();

  for (let i = 0; i < 3; i++) {
    const url = buildSahibindenUrl(i * ITEMS_PER_PAGE);
    const pageStart = Date.now();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await sleep(1000);
    } catch (err) {
      console.log(`  Sıralı sayfa ${i + 1} hata: ${err.message}`);
    }
    sequentialTimes.push(Date.now() - pageStart);
    console.log(`  Sayfa ${i + 1}: ${sequentialTimes[i]}ms`);
  }

  const sequentialTotal = Date.now() - startTime;
  const sequentialAvg = sequentialTimes.reduce((s, t) => s + t, 0) / sequentialTimes.length;

  console.log(`\n  📊 Sıralı çekim (3 sayfa):`);
  console.log(`     Toplam: ${sequentialTotal}ms`);
  console.log(`     Ortalama: ${Math.round(sequentialAvg)}ms`);

  await page.close();
  await context.close();
  await browser.close();

  return {
    sequentialTotalTime: sequentialTotal,
    sequentialAvgTime: Math.round(sequentialAvg),
    sequentialTimes,
  };
}

// ─── ADIM 6: Cookie EXPIRY Raporu ─────────────────────────────
function step6_cookieExpiryReport() {
  console.log('');
  console.log('  ════════════════════════════════════════════');
  console.log('  ADIM 6: COOKIE EXPIRY DETAY RAPORU');
  console.log('  ════════════════════════════════════════════');

  const now = Math.floor(Date.now() / 1000);
  const saved = loadSahibindenStorageState();
  const cookies = saved.storageState?.cookies || [];

  const expiryInfo = cookies.map(c => {
    const daysToExpiry = c.expires ? Math.round((c.expires - now) / 86400) : null;
    const status = daysToExpiry === null ? 'bilinmiyor'
      : daysToExpiry <= 0 ? 'SÜRESİ DOLMUŞ'
      : daysToExpiry <= 7 ? '⚠️ 7 günden az'
      : daysToExpiry <= 30 ? '⚠️ 30 günden az'
      : '✅ sağlam';
    return { name: c.name, domain: c.domain, expiresInDays: daysToExpiry, status, httpOnly: c.httpOnly, secure: c.secure };
  });

  // Session cookie'leri filtrele
  const sessionCookies = expiryInfo.filter(c => ['csid', 'cwt', 'st', 'sid', 'session'].includes(c.name));
  const expired = expiryInfo.filter(c => c.expiresInDays !== null && c.expiresInDays <= 0);
  const healthy = expiryInfo.filter(c => c.expiresInDays !== null && c.expiresInDays > 30);

  console.log(`\n  Toplam cookie: ${expiryInfo.length}`);
  console.log(`  Session cookie: ${sessionCookies.length}`);
  console.log(`  Süresi dolmuş: ${expired.length}`);
  console.log(`  Sağlam (>30 gün): ${healthy.length}`);

  if (sessionCookies.length > 0) {
    console.log('\n  Session cookie detayı:');
    for (const c of sessionCookies) {
      console.log(`    ${c.name}: ${c.expiresInDays !== null ? `${c.expiresInDays} gün` : 'süresiz'} [${c.status}]`);
    }
  }

  // Uyarılar
  const warnings = [];
  if (expired.length > 0) warnings.push(`${expired.length} adet süresi dolmuş cookie var (silinecek).`);
  if (sessionCookies.some(c => c.expiresInDays !== null && c.expiresInDays <= 7)) {
    warnings.push('Session cookielerinden bazilari 7 gun icinde suresi doluyor.');
  }
  if (cookies.length === 0) warnings.push('Hiç cookie bulunamadı. SAHIBINDEN_COOKIES env veya auth.json gerekli.');

  return { cookieCount: expiryInfo.length, sessionCookies, expired, healthy, expiryInfo, warnings };
}

// ─── RAPOR YAZ ───────────────────────────────────────────────
function writeReport(report) {
  ensureDir('test');
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n  💾 Rapor kaydedildi: ${REPORT_PATH}`);
}

// ─── MAIN ─────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║   PARALLEL PAGE PROOF OF CONCEPT TEST           ║');
  console.log('  ║   🔒 Ana projeye DOKUNULMADI                   ║');
  console.log('  ╚══════════════════════════════════════════════════╝');

  const fullReport = {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    nodeVersion: process.version,
    parallelCount: PARALLEL_COUNT,
  };

  try {
    // ADIM 1: Cookie sistemi testi
    fullReport.cookieSystem = step1_cookieSystemTest();

    // ADIM 2: Browser + 10 sayfa
    const { browser, context, pages, info } = await step2_openBrowserWithPages();
    fullReport.browserInfo = info;

    // ADIM 3: 10 sayfa paralel çekim
    const parallelResult = await step3_parallelFetch(pages);
    fullReport.parallelFetch = parallelResult;

    // ADIM 4: Session paylaşımı
    fullReport.sessionCheck = await step4_sessionCheck(pages);

    // ADIM 6: Cookie expiry
    fullReport.cookieExpiry = step6_cookieExpiryReport();

    // Screenshot
    ensureDir(SCREENSHOT_DIR);
    for (let i = 0; i < Math.min(pages.length, 5); i++) {
      try {
        await pages[i].screenshot({ path: `${SCREENSHOT_DIR}/page-${i + 1}.png`, fullPage: false });
      } catch {}
    }
    console.log(`\n  📸 İlk 5 sayfanın ekran görüntüsü: ${SCREENSHOT_DIR}/`);

    // Temizlik
    for (const p of pages) await p.close().catch(() => {});
    await context.close();
    await browser.close();
    console.log('\n  🧹 Tarayıcı kapatıldı.');

    // ADIM 5: Sıralı karşılaştırma
    const seqResult = await step5_sequentialComparison();
    fullReport.sequentialComparison = seqResult;

    // ─── ÖZET ────────────────────────────────────────────
    const { parallelFetch, sequentialComparison, cookieSystem } = fullReport;
    console.log('');
    console.log('  ════════════════════════════════════════════');
    console.log('  📋 NİHAİ RAPOR');
    console.log('  ════════════════════════════════════════════');
    console.log(`  Cookie: ${cookieSystem.storageState.cookieCount} kayıtlı + ${cookieSystem.extraCookies.count} ek`);
    console.log(`  Browser sekmeleri: ${info.pageCount}`);
    console.log(`  Paralel başarı: ${parallelFetch.stats.successful}/${PARALLEL_COUNT}`);
    console.log(`  Paralel süre: ${parallelFetch.parallelTotalTime}ms (${(parallelFetch.parallelTotalTime / 1000).toFixed(1)}s)`);
    if (sequentialComparison) {
      console.log(`  Sıralı süre (3 sayfa): ${sequentialComparison.sequentialTotalTime}ms (${(sequentialComparison.sequentialTotalTime / 1000).toFixed(1)}s)`);
    }
    console.log(`  Session paylaşımı: ${fullReport.sessionCheck.shared ? '✅ EVET (tek oturum)' : '❌ HAYIR'}`);

    if (fullReport.cookieExpiry.warnings.length > 0) {
      console.log(`\n  ⚠️ Cookie Uyarıları:`);
      for (const w of fullReport.cookieExpiry.warnings) {
        console.log(`    • ${w}`);
      }
    }

    writeReport(fullReport);
    console.log('\n  ✅ TEST TAMAMLANDI!');
    process.exit(0);
  } catch (err) {
    console.error(`\n  ❌ KRİTİK HATA: ${err.message}`);
    console.error(err.stack);
    writeReport({ ...fullReport, error: err.message, stack: err.stack });
    process.exit(1);
  }
}

main();
