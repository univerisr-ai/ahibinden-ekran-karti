import {
  MAX_CREDITS_PER_RUN,
  MAX_RETRIES,
  REQUEST_DELAY_MS,
  ITEMS_PER_PAGE,
  BASE_URL,
  MAX_PAGES_PER_SEGMENT,
  WARMUP_PRICE_MAX,
} from './config.mjs';
import { chromium, firefox } from 'playwright';
import {
  extractTotalCountFromHtml,
  hasLikelyListingSignals,
} from './parser.mjs';
import { loadSahibindenStorageState } from './session_state.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_NAV_TIMEOUT_MS = parseInt(process.env.NAV_TIMEOUT_MS || '90000', 10);

let browser = null;
let context = null;
let page = null;

let stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  pagesLoaded: 0,
  creditsUsed: 0,
};

export function getStats() {
  return { ...stats };
}

const CAMOUFOX_WS_ENDPOINT = String(process.env.CAMOUFOX_WS_ENDPOINT || '').trim();
const USE_CAMOUFOX = CAMOUFOX_WS_ENDPOINT.length > 0;

async function ensureBrowser() {
  if (browser && context && page) return true;
  try {
    if (USE_CAMOUFOX) {
      console.log('  Camoufox server mode baslatiliyor...');
      browser = await firefox.connect(CAMOUFOX_WS_ENDPOINT);
    } else {
      console.log('  Chromium baslatiliyor...');
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
        ],
      });
    }
    const fs = await import('fs');
    const videoDir = process.env.PLAYWRIGHT_VIDEO_DIR || 'videos';
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1366, height: 900 },
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
      recordVideo: { dir: videoDir, size: { width: 1366, height: 900 } },
    });
    page = await context.newPage();

    // Daha once kaydedilmis cookie varsa yukle
    const saved = loadSahibindenStorageState();
    if (saved.storageState && saved.cookieCount > 0) {
      await context.addCookies(saved.storageState.cookies);
      console.log(`  ${saved.cookieCount} adet kayitli cookie yuklendi (kaynak: ${saved.source}).`);
    }

    console.log('  Tarayici hazir.');
    return true;
  } catch (err) {
    console.log(`  Tarayici baslatilamadi: ${err.message}`);
    return false;
  }
}

async function maybeHandleChallenge(url) {
  if (!page) return false;
  try {
    const currentUrl = page.url();
    const html = await page.content();
    if (currentUrl.includes('secure.sahibinden.com/login') || html.includes('giris yap') || html.includes('login')) {
      console.log('  Login sayfasi algilandi, cookie olmadan devam edilemiyor.');
      console.log('  Login sayfasi URL:', currentUrl);
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

function isChallengePage(html) {
  if (!html) return false;
  const lower = html.toLowerCase();
  return (
    lower.includes('güvenlik doğrulaması') ||
    lower.includes('guvenlik dogrulamasi') ||
    lower.includes('doğrulanıyor') ||
    lower.includes('dogrulaniyor') ||
    lower.includes('challenge-platform') ||
    lower.includes('cf-challenge') ||
    lower.includes('turnstile') ||
    lower.includes('verify you are human') ||
    lower.includes('gerçek kişi olduğunuzu doğrulayın')
  );
}

async function solveTurnstileIfPresent(maxWait = 20000) {
  if (!page) return false;
  try {
    // 1. Click "Devam Et" / Continue button if present
    const devamBtn = page.locator('#btn-continue');
    if (await devamBtn.isVisible().catch(() => false)) {
      console.log('  Devam Et butonu bulundu, tiklaniyor.');
      await devamBtn.click({ force: true });
      await sleep(2000);
    }

    let clicked = false;

    // 2. Wait up to 8s for a Turnstile iframe/widget to appear
    const searchStart = Date.now();
    while (Date.now() - searchStart < 8000) {
      const iframes = page.locator('iframe');
      const count = await iframes.count().catch(() => 0);

      for (let i = 0; i < count; i++) {
        const iframe = iframes.nth(i);
        const src = await iframe.getAttribute('src').catch(() => '') || '';
        const box = await iframe.boundingBox().catch(() => null);
        console.log(`  Iframe ${i}: src=${src.substring(0, 80)} box=${box ? JSON.stringify(box) : 'null'}`);

        if (src.includes('turnstile') || src.includes('cloudflare') || src.includes('challenge')) {
          if (box) {
            const clickX = box.x + 30;
            const clickY = box.y + (box.height / 2);
            console.log(`  Turnstile iframe bulundu, tiklaniyor: ${clickX}, ${clickY}`);
            await page.mouse.move(clickX, clickY, { steps: 5 });
            await sleep(200);
            await page.mouse.down();
            await sleep(100);
            await page.mouse.up();
            clicked = true;
          }
        }
      }

      if (clicked) break;

      // Fallback: visible Turnstile widget container
      const tw = page.locator('#turnStileWidget, [id*="turnstile" i], [class*="turnstile" i], #challenge-stage, .cf-turnstile');
      if (await tw.isVisible().catch(() => false)) {
        const tbox = await tw.boundingBox().catch(() => null);
        if (tbox) {
          const clickX = tbox.x + 30;
          const clickY = tbox.y + (tbox.height / 2);
          console.log(`  Turnstile widget bulundu, tiklaniyor: ${clickX}, ${clickY}`);
          await page.mouse.click(clickX, clickY);
          clicked = true;
          break;
        }
      }

      await sleep(1000);
    }

    if (!clicked) {
      // Managed challenge: no visible iframe, wait for auto-verification
      const html = await page.content().catch(() => '');
      if (isChallengePage(html)) {
        console.log('  Cloudflare challenge sayfasi tespit edildi, otomatik dogrulama bekleniyor...');
        clicked = true;
      } else {
        console.log('  Turnstile iframe/widget bulunamadi.');
        return false;
      }
    }

    // 3. Wait for token or listings to appear
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await sleep(1000);
      const token = await page.evaluate(() => {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        return input ? input.value : null;
      }).catch(() => null);
      if (token && token.length > 0) {
        console.log('  Turnstile token alindi.');
        await sleep(1500);
        return true;
      }
      const html = await page.content().catch(() => '');
      if (hasLikelyListingSignals(html)) {
        console.log('  Sayfa yuklendi, ilanlar gorunuyor.');
        return true;
      }
    }
    console.log('  Turnstile cozumu zaman asimina ugradi.');
    return false;
  } catch (err) {
    console.log(`  Turnstile cozme hatasi: ${err.message}`);
    return false;
  }
}

async function fetchPage(targetUrl, label = '') {
  if (stats.creditsUsed >= MAX_CREDITS_PER_RUN) {
    console.log(`  BÜTÇE LİMİTİ AŞILDI (${stats.creditsUsed}/${MAX_CREDITS_PER_RUN})`);
    return { html: null, status: 'BUDGET_EXHAUSTED' };
  }

  if (!(await ensureBrowser())) {
    stats.failedRequests++;
    return { html: null, status: 'FAILED' };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`  Camoufox -> ${label} (Deneme ${attempt})`);
    stats.totalRequests++;

    try {
      const response = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_NAV_TIMEOUT_MS,
      });
      await sleep(1500);

      const urlOk = await maybeHandleChallenge(targetUrl);
      if (!urlOk) {
        console.log(`  Login sayfasi (deneme ${attempt})`);
        await sleep(2000);
        continue;
      }

      const html = await page.content();
      const respStatus = response ? response.status() : 200;

      if (!hasLikelyListingSignals(html)) {
        console.log(`  İlan sinyali yok (deneme ${attempt})`);
        // Cloudflare Turnstile challenge varsa coz
        const solved = await solveTurnstileIfPresent(20000);
        if (solved) {
          const htmlAfter = await page.content();
          if (hasLikelyListingSignals(htmlAfter)) {
            stats.successfulRequests++;
            stats.pagesLoaded++;
            stats.creditsUsed++;
            return { html: htmlAfter, status: 'OK' };
          }
        }
        await sleep(2000);
        continue;
      }

      stats.successfulRequests++;
      stats.pagesLoaded++;
      stats.creditsUsed++;
      return { html, status: 'OK' };
    } catch (err) {
      console.log(`  Hata (deneme ${attempt}): ${err.message}`);
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
  if (!targetUrl) return { html: null, status: 'INVALID_URL' };
  return fetchPage(targetUrl, `detail: ${targetUrl}`);
}

export async function initSession() {
  const ok = await ensureBrowser();
  if (!ok) return { ok: false, code: 'BROWSER_INIT_FAILED' };

  const warmupUrl = buildSahibindenUrl(0, 0, WARMUP_PRICE_MAX);
  console.log('  Warmup sayfasi aciliyor...');

  try {
    await page.goto(warmupUrl, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_NAV_TIMEOUT_MS,
    });
    await sleep(5000);

    // Cloudflare Turnstile challenge varsa coz (yoksa otomatik dogrulama bekle)
    await solveTurnstileIfPresent(45000);

    const html = await page.content();
    if (hasLikelyListingSignals(html)) {
      console.log('  Warmup basarili, ilanlar gorunuyor.');
      const saved = loadSahibindenStorageState();
      return {
        ok: true,
        code: 'OK',
        cookieSource: saved.source,
        cookieCount: saved.cookieCount,
      };
    }

    const url = page.url();
    if (url.includes('secure.sahibinden.com/login') || url.includes('giris') || html.includes('giris yap')) {
      console.log('  Login sayfasi — cookie gerekli.');
      return { ok: false, code: 'LOGIN_REQUIRED' };
    }

    console.log('  Ilan gorunmuyor, Cloudflare engeli olabilir.');
    return { ok: false, code: 'NO_LISTINGS' };
  } catch (err) {
    console.log(`  Session init hatasi: ${err.message}`);
    return { ok: false, code: 'INIT_SESSION_ERROR' };
  }
}

export async function saveChallengeProofScreenshot(label) {
  try {
    if (page && !page.isClosed()) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await page.screenshot({ path: `cf_proof.png`, fullPage: false });
    }
  } catch (_) {}
}

export async function takeScreenshot(label) {
  try {
    if (page && !page.isClosed()) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = process.env.SCREENSHOT_DIR || 'screenshots';
      const fs = await import('fs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/step-${label}-${ts}.png`, fullPage: false });
    }
  } catch (_) {}
}

export async function closeBrowser() {
  try {
    if (page) { await page.close().catch(() => {}); page = null; }
    if (context) { await context.close().catch(() => {}); context = null; }
    if (browser) { await browser.close().catch(() => {}); browser = null; }
  } catch (_) {}
}

export async function saveStorageState() {
  if (!context) return;
  try {
    const fs = await import('fs');
    const stateFile = process.env.SAHIBINDEN_STORAGE_STATE_FILE || '.playwright/storage-state.json';
    const rawState = await context.storageState();
    const dir = await import('path').then(p => p.dirname(stateFile));
    if (dir && dir !== '.') {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(stateFile, JSON.stringify(rawState, null, 2), 'utf-8');
    console.log(`  Storage state kaydedildi: ${stateFile} (${rawState.cookies.length} cookie)`);
  } catch (err) {
    console.log(`  Storage state kaydedilemedi: ${err.message}`);
  }
}

export default {
  initSession, scrapeSegment, scrapeDetailUrl, getStats,
  saveChallengeProofScreenshot, takeScreenshot, closeBrowser,
  saveStorageState,
};
