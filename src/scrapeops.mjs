import {
  MAX_CREDITS_PER_RUN,
  MAX_RETRIES,
  REQUEST_DELAY_MS,
  ITEMS_PER_PAGE,
  BASE_URL,
  MAX_PAGES_PER_SEGMENT,
  WARMUP_PRICE_MAX,
  PARALLEL_PAGES,
} from './config.mjs';
import { chromium, firefox } from 'playwright';
import {
  extractTotalCountFromHtml,
  hasLikelyListingSignals,
} from './parser.mjs';
import { loadSahibindenStorageState } from './session_state.mjs';
import { loadAllSahibindenCookies } from './cookies.mjs';
import { loadMouseRecording, replayMouseRecording } from './mouse_recorder.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAV_TIMEOUT = 45000;

let browser = null;
let context = null;
let page = null;
let pages = [];
let nextPageIndex = 0;

function acquirePage() {
  if (pages.length === 0) return page;
  const p = pages[nextPageIndex % pages.length];
  nextPageIndex++;
  return p;
}

let stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  pagesLoaded: 0,
  creditsUsed: 0,
};

export function getStats() { return { ...stats }; }

const CAMOUFOX_BIN = String(process.env.CAMOUFOX_BIN || '').trim();

async function ensureBrowser() {
  if (browser && context && pages.length > 0) return true;
  try {
    if (CAMOUFOX_BIN) {
      console.log('  Camoufox binary baslatiliyor...');
      const launchArgs = [];
      const proxyUrl = process.env.CAMOUFOX_PROXY || process.env.ALL_PROXY || '';
      if (proxyUrl) launchArgs.push('--proxy-server', proxyUrl);
      browser = await firefox.launch({
        executablePath: CAMOUFOX_BIN,
        headless: true,
        args: launchArgs,
      });
    } else {
      console.log('  Chromium baslatiliyor...');
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars'],
      });
    }
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1366, height: 900 },
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
    });
    page = await context.newPage();
    pages = [page];
    console.log('  Tarayici hazir (1 sayfa).');
    return true;
  } catch (err) {
    console.log(`  Tarayici baslatilamadi: ${err.message}`);
    return false;
  }
}

export async function initSession() {
  const ok = await ensureBrowser();
  if (!ok) return { ok: false, code: 'BROWSER_INIT_FAILED' };

  console.log('  Ana sayfaya gidiliyor...');
  try {
    await page.goto('https://www.sahibinden.com/', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  } catch (err) {
    console.log(`  Ana sayfa acilamadi: ${err.message}`);
    return { ok: false, code: 'CF_BLOCKED' };
  }
  await sleep(2000);

  let url = page.url();
  let html = await page.content().catch(() => '');

  // Cloudflare engeli varsa dur
  if (html.includes('turnstile') || html.includes('cf-challenge') || html.includes('challenge-platform')) {
    console.log('  Cloudflare engeli! Gecilemedi.');
    return { ok: false, code: 'CF_BLOCKED' };
  }

  // Login sayfasi → cookie yukle
  if (url.includes('giris') || html.toLowerCase().includes('giris yap')) {
    console.log('  Login sayfasi, cookie yukleniyor...');
    const saved = loadSahibindenStorageState();
    if (saved.storageState && saved.cookieCount > 0) {
      await context.addCookies(saved.storageState.cookies);
    }
    const extra = loadAllSahibindenCookies();
    if (extra.length > 0) await context.addCookies(extra);

    // Cookie ile banaozel'e git
    try {
      await page.goto('https://banaozel.sahibinden.com/', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    } catch (_) {}
    await sleep(2000);
    url = page.url();
    html = await page.content().catch(() => '');

    if (url.includes('banaozel')) {
      console.log('  Session dogrulandi.');
    }
  }

  // Ekran fotografi
  try { await page.screenshot({ path: 'init_session.png', fullPage: false }); } catch (_) {}

  // Kalan paralel sayfalari ac
  if (PARALLEL_PAGES > 1) {
    for (let i = pages.length; i < PARALLEL_PAGES; i++) {
      pages.push(await context.newPage());
    }
    console.log(`  Toplam ${pages.length} sayfa hazir.`);
  }

  const saved = loadSahibindenStorageState();
  return { ok: true, code: 'OK', cookieSource: saved.source, cookieCount: saved.cookieCount };
}

async function fetchPage(targetUrl, label = '') {
  if (stats.creditsUsed >= MAX_CREDITS_PER_RUN) return { html: null, status: 'BUDGET_EXHAUSTED' };
  if (!(await ensureBrowser())) { stats.failedRequests++; return { html: null, status: 'FAILED' }; }

  const savedPage = page;
  page = acquirePage();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`  Page ${((nextPageIndex - 1) % PARALLEL_PAGES) + 1}/${PARALLEL_PAGES} -> ${label} (Deneme ${attempt})`);
    stats.totalRequests++;
    try {
      const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await sleep(1000);
      const html = await page.content();
      if (hasLikelyListingSignals(html)) {
        page = savedPage;
        stats.successfulRequests++;
        stats.pagesLoaded++;
        stats.creditsUsed++;
        return { html, status: 'OK' };
      }
      console.log(`  İlan sinyali yok (deneme ${attempt})`);
    } catch (err) {
      console.log(`  Hata (deneme ${attempt}): ${err.message}`);
    }
    page = savedPage;
    await sleep(1000);
  }
  stats.failedRequests++;
  return { html: null, status: 'FAILED' };
}

export function buildSahibindenUrl(offset, priceMin, priceMax) {
  const url = new URL(BASE_URL);
  url.searchParams.set('pagingOffset', String(offset));
  url.searchParams.set('pagingSize', String(ITEMS_PER_PAGE));
  url.searchParams.set('sorting', 'date_desc');
  if (priceMin != null) url.searchParams.set('price_min', String(priceMin));
  if (priceMax != null) url.searchParams.set('price_max', String(priceMax));
  return url.toString();
}

export async function scrapeSegment(priceMin, priceMax) {
  const label = `${priceMin.toLocaleString('tr')}-${priceMax.toLocaleString('tr')} TL`;
  console.log(`\n  Segment: ${label} (Kredi: ${stats.creditsUsed}/${MAX_CREDITS_PER_RUN})`);

  const firstUrl = buildSahibindenUrl(0, priceMin, priceMax);
  const { html: firstHtml, status } = await fetchPage(firstUrl, `${label} (s:1)`);

  if (!firstHtml || status === 'BUDGET_EXHAUSTED') {
    return { htmlPages: [], totalFound: 0, pages: 0, status };
  }

  const htmlPages = [firstHtml];
  const totalCount = extractTotalCountFromHtml(firstHtml);
  const totalPages = Math.min(Math.ceil(totalCount / ITEMS_PER_PAGE), MAX_PAGES_PER_SEGMENT);
  console.log(`  ${label}: ${totalCount.toLocaleString('tr')} ilan, ${totalPages} sayfa.`);

  if (totalPages <= 1) return { htmlPages, totalFound: totalCount, pages: 1, status: 'OK' };

  if (PARALLEL_PAGES > 1) {
    const pageIndexes = [];
    for (let i = 1; i < totalPages; i++) pageIndexes.push(i);
    for (let b = 0; b < pageIndexes.length; b += PARALLEL_PAGES) {
      const batch = pageIndexes.slice(b, b + PARALLEL_PAGES);
      const results = await Promise.allSettled(
        batch.map(async (pi) => {
          await sleep(REQUEST_DELAY_MS);
          return fetchPage(buildSahibindenUrl(pi * ITEMS_PER_PAGE, priceMin, priceMax), `${label} (s:${pi + 1})`);
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.html) htmlPages.push(r.value.html);
      }
    }
  } else {
    for (let i = 1; i < totalPages; i++) {
      await sleep(REQUEST_DELAY_MS);
      const { html } = await fetchPage(buildSahibindenUrl(i * ITEMS_PER_PAGE, priceMin, priceMax), `${label} (s:${i + 1})`);
      if (html) htmlPages.push(html);
    }
  }

  await saveStorageState();
  console.log(`  Segment bitti. Toplam sayfa: ${htmlPages.length}`);
  return { htmlPages, totalFound: totalCount, pages: htmlPages.length, status: 'OK' };
}

export async function scrapeDetailUrl(detailUrl) {
  return fetchPage(String(detailUrl || '').trim(), 'detail');
}

export async function saveChallengeProofScreenshot() {
  try { if (page && !page.isClosed()) await page.screenshot({ path: 'cf_proof.png', fullPage: false }); } catch (_) {}
}

export async function closeBrowser() {
  try {
    for (const p of pages) { await p.close().catch(() => {}); }
    pages = [];
    if (context) { await context.close().catch(() => {}); context = null; }
    if (browser) { await browser.close().catch(() => {}); browser = null; }
  } catch (_) {}
}

export async function saveStorageState() {
  if (!context) return;
  try {
    const fs = await import('fs');
    const stateFile = process.env.SAHIBINDEN_STORAGE_STATE_FILE || '.playwright/storage-state.json';
    const raw = await context.storageState();
    fs.mkdirSync(await import('path').then(p => p.dirname(stateFile)), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(raw, null, 2), 'utf-8');
    console.log(`  Storage state kaydedildi: ${stateFile} (${raw.cookies.length} cookie)`);
  } catch (err) { console.log(`  Storage state kaydedilemedi: ${err.message}`); }
}

export default { initSession, scrapeSegment, scrapeDetailUrl, getStats, saveChallengeProofScreenshot, closeBrowser, saveStorageState };
