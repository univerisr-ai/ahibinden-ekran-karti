import {
  MAX_CREDITS_PER_RUN,
  MAX_RETRIES,
  REQUEST_DELAY_MS,
  ITEMS_PER_PAGE,
  BASE_URL,
  MAX_PAGES_PER_SEGMENT,
  WARMUP_PRICE_MAX,
} from './config.mjs';
import {
  extractTotalCountFromHtml,
  hasLikelyListingSignals,
} from './parser.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_NAV_TIMEOUT_MS = parseInt(process.env.NAV_TIMEOUT_MS || '120000', 10);

let stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  pagesLoaded: 0,
  creditsUsed: 0,
  flareSolverrConnected: false,
};

export function getStats() {
  return { ...stats };
}

const FLARESOLVERR_URL = 'http://localhost:8191/v1';
let flareSolverrSession = null;

function loadEnvCookies() {
  const raw = process.env.SAHIBINDEN_COOKIES || process.env.SAHIBINDEN_STORAGE_STATE_B64 || '';
  if (!raw) return [];
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
    if (Array.isArray(decoded)) return decoded;
    if (decoded.cookies && Array.isArray(decoded.cookies)) return decoded.cookies;
    return [];
  } catch {
    return [];
  }
}

const envCookies = loadEnvCookies();

async function callFlareSolverr(cmd, url, maxTimeout = DEFAULT_NAV_TIMEOUT_MS) {
  const body = {
    cmd,
    url,
    maxTimeout,
    session: flareSolverrSession || undefined,
  };
  if (cmd === 'request.get' && envCookies.length > 0) {
    body.cookies = envCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain || '.sahibinden.com',
    }));
  }
  const response = await fetch(FLARESOLVERR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`FlareSolverr HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data.status !== 'ok') {
    throw new Error(`FlareSolverr: ${data.message || 'unknown error'}`);
  }
  return data;
}

async function fetchPage(targetUrl, label = '') {
  if (stats.creditsUsed >= MAX_CREDITS_PER_RUN) {
    console.log(`  BÜTÇE LİMİTİ AŞILDI (${stats.creditsUsed}/${MAX_CREDITS_PER_RUN} kredi) — Koşu durduruluyor.`);
    return { html: null, status: 'BUDGET_EXHAUSTED' };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`  FlareSolverr -> ${label} (Deneme ${attempt})`);
    stats.totalRequests++;

    try {
      const data = await callFlareSolverr('request.get', targetUrl);
      const solution = data.solution;
      if (!solution || !solution.response) {
        throw new Error('Empty response from FlareSolverr');
      }
      const html = solution.response;
      const respStatus = solution.status || 200;
      const resolvedUrl = solution.url || targetUrl;
      console.log(`    Status: ${respStatus}, URL: ${resolvedUrl.substring(0, 80)}`);

      if (respStatus !== 200 && respStatus !== 404) {
        console.log(`  HTTP ${respStatus} (deneme ${attempt})`);
        await sleep(2000);
        continue;
      }

      if (!hasLikelyListingSignals(html)) {
        const snippet = String(html).replace(/\s+/g, ' ').substring(0, 500);
        console.log(`  İlan sinyali yok (deneme ${attempt}). Snippet: ${snippet}`);
        await sleep(2000);
        continue;
      }

      stats.successfulRequests++;
      stats.pagesLoaded++;
      stats.creditsUsed++;
      return { html, status: 'OK' };
    } catch (err) {
      console.log(`  FlareSolverr hatasi (deneme ${attempt}): ${err.message}`);
      await sleep(2000);
    }
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

  if (!firstHtml || status === 'BANNED' || status === 'BUDGET_EXHAUSTED') {
    return { htmlPages: [], totalFound: 0, pages: 0, status };
  }

  const htmlPages = [firstHtml];
  const totalCount = extractTotalCountFromHtml(firstHtml);
  const totalPages = Math.min(Math.ceil(totalCount / ITEMS_PER_PAGE), MAX_PAGES_PER_SEGMENT);
  console.log(`  ${label}: ${totalCount.toLocaleString('tr')} ilan, ${totalPages} sayfa.`);

  for (let pageIndex = 1; pageIndex < totalPages; pageIndex++) {
    await sleep(REQUEST_DELAY_MS);
    const offset = pageIndex * ITEMS_PER_PAGE;
    const url = buildSahibindenUrl(offset, priceMin, priceMax);
    const { html, status: pageStatus } = await fetchPage(url, `${label} (s:${pageIndex + 1})`);

    if (pageStatus === 'BANNED' || pageStatus === 'BUDGET_EXHAUSTED') {
      return { htmlPages, totalFound: totalCount, pages: htmlPages.length, status: pageStatus };
    }

    if (html) htmlPages.push(html);
  }

  console.log(`  Segment bitti. Toplam sayfa: ${htmlPages.length}`);
  return { htmlPages, totalFound: totalCount, pages: htmlPages.length, status: 'OK' };
}

export async function scrapeDetailUrl(detailUrl) {
  const targetUrl = String(detailUrl || '').trim();
  if (!targetUrl) {
    return { html: null, status: 'INVALID_URL' };
  }
  return fetchPage(targetUrl, `detail: ${targetUrl}`);
}

async function testFlareSolverr() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${FLARESOLVERR_URL}`, { method: 'GET' });
      if (res.ok || res.status === 405) {
        console.log('  FlareSolverr hazir.');
        stats.flareSolverrConnected = true;
        return true;
      }
    } catch (_) {
    }
    if (i % 10 === 9) console.log(`  FlareSolverr bekleniyor... (${i + 1}s)`);
    await sleep(2000);
  }
  stats.flareSolverrConnected = false;
  return false;
}

export async function initSession() {
  const ready = await testFlareSolverr();
  if (!ready) {
    console.log('  FlareSolverr ulasilamadi!');
    return { ok: false, code: 'FLARESOLVERR_UNAVAILABLE' };
  }

  const warmupUrl = buildSahibindenUrl(0, 0, WARMUP_PRICE_MAX);
  console.log('  FlareSolverr ile warmup sayfasi aciliyor...');
  const { html, status } = await fetchPage(warmupUrl, 'warmup');

  if (!html || status !== 'OK') {
    console.log('  Warmup basarisiz.');
    return { ok: false, code: 'WARMUP_FAILED' };
  }

  if (!hasLikelyListingSignals(html)) {
    console.log('  Sayfada ilan bulunamadi — muhtemelen Cloudflare engeli.');
    return { ok: false, code: 'NO_LISTINGS_SIGNALS' };
  }

  console.log('  Warmup basarili, Cloudflare gecildi.');
  return { ok: true, code: 'OK', cookieSource: 'flare-solverr', cookieCount: 0 };
}

export async function saveChallengeProofScreenshot(label) {
  try {
    const fs = await import('fs');
    const content = `Challenge screenshot not available (FlareSolverr mode). Label: ${label}\nTime: ${new Date().toISOString()}`;
    fs.writeFileSync('cf_proof.png.txt', content, 'utf-8');
  } catch (_) {}
}

export async function takeScreenshot(label) {
  // no-op, browser-based screenshots not available in FlareSolverr mode
}

export async function closeBrowser() {
  // no-op, no browser in FlareSolverr mode
}

export default {
  initSession,
  scrapeSegment,
  scrapeDetailUrl,
  getStats,
  saveChallengeProofScreenshot,
  takeScreenshot,
  closeBrowser,
};
