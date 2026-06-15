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
import {
  solveUrlWithFlareSolverr,
  flareSolverrCookiesToPlaywright,
} from './flaresolverr.mjs';
import { loadMouseRecording, replayMouseRecording } from './mouse_recorder.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_NAV_TIMEOUT_MS = parseInt(process.env.NAV_TIMEOUT_MS || '90000', 10);

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

export function getStats() {
  return { ...stats };
}

const CAMOUFOX_WS_ENDPOINT = String(process.env.CAMOUFOX_WS_ENDPOINT || '').trim();
const CAMOUFOX_BIN = String(process.env.CAMOUFOX_BIN || '').trim();
const CAMOUFOX_CONFIG = String(process.env.CAMOUFOX_CONFIG || '').trim();
const USE_CAMOUFOX = CAMOUFOX_WS_ENDPOINT.length > 0 || CAMOUFOX_BIN.length > 0 || CAMOUFOX_CONFIG.length > 0;

async function ensureBrowser() {
  if (browser && context && pages.length > 0) return true;
  try {
    if (CAMOUFOX_WS_ENDPOINT) {
      console.log('  Camoufox server mode baslatiliyor...');
      browser = await firefox.connect(CAMOUFOX_WS_ENDPOINT);
    } else if (CAMOUFOX_CONFIG) {
      console.log('  Camoufox fingerprint config baslatiliyor...');
      const fs = await import('fs');
      const raw = fs.readFileSync(CAMOUFOX_CONFIG, 'utf8');
      const cfg = JSON.parse(raw);
      const launchOpts = {
        executablePath: cfg.executable_path,
        headless: true,
        args: [...(cfg.args || [])],
        firefoxUserPrefs: cfg.firefox_user_prefs || {},
      };
      const proxyUrl = process.env.CAMOUFOX_PROXY || process.env.ALL_PROXY || '';
      if (proxyUrl) {
        launchOpts.args.push('--proxy-server', proxyUrl);
      }
      if (cfg.env && typeof cfg.env === 'object') {
        launchOpts.env = cfg.env;
      }
      browser = await firefox.launch(launchOpts);
    } else if (CAMOUFOX_BIN) {
      console.log('  Camoufox binary baslatiliyor...');
      const launchArgs = [];
      const proxyUrl = process.env.CAMOUFOX_PROXY || process.env.ALL_PROXY || '';
      if (proxyUrl) {
        launchArgs.push('--proxy-server', proxyUrl);
      }
      browser = await firefox.launch({
        executablePath: CAMOUFOX_BIN,
        headless: true,
        args: launchArgs,
      });
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

    const contextOptions = {
      ignoreHTTPSErrors: true,
      viewport: { width: 1366, height: 900 },
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
    };
    // Camoufox/Firefox server mode does not support Playwright video recording.
    if (!USE_CAMOUFOX) {
      contextOptions.recordVideo = { dir: videoDir, size: { width: 1366, height: 900 } };
    }

    context = await browser.newContext(contextOptions);
    // Once sadece 1 sayfa ac, gerisi giris yapildiktan sonra
    page = await context.newPage();
    pages = [page];

    console.log('  Tarayici hazir (1 sayfa).');
    return true;
  } catch (err) {
    console.log(`  Tarayici baslatilamadi: ${err.message}`);
    return false;
  }
}

async function maybeHandleChallenge() {
  if (!page) return false;
  try {
    const currentUrl = page.url();
    if (currentUrl.includes('secure.sahibinden.com/login') || currentUrl.includes('giris.sahibinden.com')) {
      console.log('  Login sayfasina yonlendirildi, cookie olmadan devam edilemiyor.');
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
    lower.includes('g├╝venlik do─ƒrulamas─▒') ||
    lower.includes('guvenlik dogrulamasi') ||
    lower.includes('do─ƒrulan─▒yor') ||
    lower.includes('dogrulaniyor') ||
    lower.includes('challenge-platform') ||
    lower.includes('cf-challenge') ||
    lower.includes('turnstile') ||
    lower.includes('verify you are human') ||
    lower.includes('ger├ºek ki┼ƒi oldu─ƒunuzu do─ƒrulay─▒n') ||
    lower.includes('bir dakika') ||
    lower.includes('please wait') ||
    lower.includes('birazdan') ||
    lower.includes('checking your browser')
  );
}

async function applyFlareSolverrCookies(targetUrl) {
  if (!context) return { ok: false, cookies: [], html: '' };
  try {
    console.log('  FlareSolverr ile Cloudflare cozuluyor...');
    const solution = await solveUrlWithFlareSolverr(targetUrl);
    const cookies = flareSolverrCookiesToPlaywright(solution.cookies || []);
    if (cookies.length > 0) {
      await context.addCookies(cookies);
      console.log(`  FlareSolverr'den ${cookies.length} cookie eklendi.`);
    } else {
      console.log('  FlareSolverr cookie donmedi.');
    }
    const html = solution.response || '';
    return { ok: true, cookies, html };
  } catch (err) {
    console.log(`  FlareSolverr hatasi: ${err.message}`);
    return { ok: false, cookies: [], html: '' };
  }
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

    // 1b. Replay recorded human mouse movements if available
    const mouseRecording = loadMouseRecording();
    if (mouseRecording) {
      await replayMouseRecording(page, mouseRecording);
      await sleep(1000);
      await page.screenshot({ path: 'after_mouse_replay.png' });
    }

    let clicked = false;

    // 2. Wait up to 10s for a Turnstile iframe/widget to appear
    const searchStart = Date.now();
    while (Date.now() - searchStart < 10000) {
      // 2a. Try frameLocator approach: checkbox inside any iframe
      const frames = page.frames();
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        try {
          const checkbox = frame.locator('input[type="checkbox"]').first();
          if (await checkbox.isVisible().catch(() => false)) {
            console.log(`  Iframe ${i} icinde checkbox bulundu, tiklaniyor.`);
            await checkbox.click({ force: true });
            clicked = true;
            break;
          }
        } catch {}
      }
      if (clicked) break;

      // 2b. Find Turnstile iframes by src / bounding box
      const iframes = page.locator('iframe');
      const count = await iframes.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const iframe = iframes.nth(i);
        const src = await iframe.getAttribute('src').catch(() => '') || '';
        const box = await iframe.boundingBox().catch(() => null);
        console.log(`  Iframe ${i}: src=${src.substring(0, 80)} box=${box ? JSON.stringify(box) : 'null'}`);

        if (src.includes('turnstile') || src.includes('cloudflare') || src.includes('challenge')) {
          if (box) {
            const clickX = box.x + 25;
            const clickY = box.y + (box.height / 2);
            console.log(`  Turnstile iframe bulundu, tiklaniyor: ${clickX}, ${clickY}`);
            await page.mouse.move(clickX, clickY, { steps: 5 });
            await sleep(200);
            await page.mouse.down();
            await sleep(100);
            await page.mouse.up();
            clicked = true;
          }
        } else if (box && box.width > 250 && box.width < 350 && box.height > 50 && box.height < 90) {
          // Turnstile-like dimensions even if src doesn't match
          const clickX = box.x + 25;
          const clickY = box.y + (box.height / 2);
          console.log(`  Turnstile-benzeri iframe bulundu, tiklaniyor: ${clickX}, ${clickY}`);
          await page.mouse.click(clickX, clickY);
          clicked = true;
        }
      }
      if (clicked) break;

      // 2c. Fallback: visible Turnstile widget container
      const tw = page.locator('#turnStileWidget, [id*="turnstile" i], [class*="turnstile" i], #challenge-stage, .cf-turnstile, .challenge-stage');
      if (await tw.isVisible().catch(() => false)) {
        const tbox = await tw.boundingBox().catch(() => null);
        if (tbox) {
          const clickX = tbox.x + 25;
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
    let reloaded = false;
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
      // If waited more than half the time with no result, try reload
      if (!reloaded && Date.now() - start > maxWait / 2) {
        console.log('  Challenge cozulmedi, sayfa yenileniyor...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await sleep(3000);
        reloaded = true;
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
    console.log(`  B├£T├çE L─░M─░T─░ A┼₧ILDI (${stats.creditsUsed}/${MAX_CREDITS_PER_RUN})`);
    return { html: null, status: 'BUDGET_EXHAUSTED' };
  }

  if (!(await ensureBrowser())) {
    stats.failedRequests++;
    return { html: null, status: 'FAILED' };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const savedPage = page;
    page = acquirePage();
    console.log(`  Page ${((nextPageIndex - 1) % PARALLEL_PAGES) + 1}/${PARALLEL_PAGES} -> ${label} (Deneme ${attempt})`);
    stats.totalRequests++;

    try {
      const response = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_NAV_TIMEOUT_MS,
      });
      await sleep(1500);

      let html = await page.content();
      const respStatus = response ? response.status() : 200;

      // Once listing sinyali var mi kontrol et
      if (!hasLikelyListingSignals(html)) {
        console.log(`  İlan sinyali yok (deneme ${attempt})`);
        // Cloudflare Turnstile challenge varsa coz
        const solved = await solveTurnstileIfPresent(20000);
        if (solved) {
          html = await page.content();
          if (hasLikelyListingSignals(html)) {
            page = savedPage;
            stats.successfulRequests++;
            stats.pagesLoaded++;
            stats.creditsUsed++;
            return { html, status: 'OK' };
          }
        }
        // Turnstile cozulemezse FlareSolverr dene
        if (isChallengePage(html)) {
          console.log(`  FlareSolverr deneniyor (deneme ${attempt})...`);
          const fsResult = await applyFlareSolverrCookies(targetUrl);
          if (fsResult.ok && fsResult.html && hasLikelyListingSignals(fsResult.html)) {
            console.log('  FlareSolverr sayfayi cozdu, HTML kullaniliyor.');
            html = fsResult.html;
            page = savedPage;
            stats.successfulRequests++;
            stats.pagesLoaded++;
            stats.creditsUsed++;
            return { html, status: 'OK' };
          }
          if (fsResult.html) {
            await page.goto(targetUrl, {
              waitUntil: 'domcontentloaded',
              timeout: DEFAULT_NAV_TIMEOUT_MS,
            }).catch(() => {});
            await sleep(2000);
            html = await page.content();
            if (hasLikelyListingSignals(html)) {
              page = savedPage;
              stats.successfulRequests++;
              stats.pagesLoaded++;
              stats.creditsUsed++;
              return { html, status: 'OK' };
            }
          }
        }
        // Turnstile sonrasi hala sinyal yoksa login kontrolu yap (sadece URL bazli)
        const loginOk = await maybeHandleChallenge();
        if (!loginOk) {
          console.log(`  Login sayfasi (deneme ${attempt})`);
          await sleep(2000);
          continue;
        }
        await sleep(2000);
        continue;
      }

      // Listing sinyali var, sadece URL bazli login redirect kontrolu
      const loginOk = await maybeHandleChallenge();
      if (!loginOk) {
        console.log(`  Login redirect (deneme ${attempt})`);
        await sleep(2000);
        continue;
      }

      page = savedPage;
      stats.successfulRequests++;
      stats.pagesLoaded++;
      stats.creditsUsed++;
      return { html, status: 'OK' };
    } catch (err) {
      console.log(`  Hata (deneme ${attempt}): ${err.message}`);
      await sleep(2000);
    } finally {
      page = savedPage;
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

  if (PARALLEL_PAGES <= 1) {
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
  } else {
    const pageIndexes = [];
    for (let i = 1; i < totalPages; i++) {
      pageIndexes.push(i);
    }

    for (let batchStart = 0; batchStart < pageIndexes.length; batchStart += PARALLEL_PAGES) {
      const batch = pageIndexes.slice(batchStart, batchStart + PARALLEL_PAGES);
      console.log(`  Batch ${Math.floor(batchStart / PARALLEL_PAGES) + 1}: ${batch.length} sayfa paralel`);
      const batchResults = await Promise.allSettled(
        batch.map(async (pageIndex) => {
          await sleep(REQUEST_DELAY_MS);
          const offset = pageIndex * ITEMS_PER_PAGE;
          const url = buildSahibindenUrl(offset, priceMin, priceMax);
          return fetchPage(url, `${label} (s:${pageIndex + 1})`);
        })
      );

      let stopped = false;
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const { html, status: pageStatus } = result.value;
          if (html) htmlPages.push(html);
          if (pageStatus === 'BANNED' || pageStatus === 'BUDGET_EXHAUSTED') {
            stopped = true;
            break;
          }
        }
      }
      if (stopped) break;
    }
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

  console.log('  Ana sayfaya gidiliyor (cookiesiz)...');
  try {
    await page.goto('https://www.sahibinden.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }).catch(() => {});
    await sleep(2000);
  } catch (_) {}

  let url = page.url();
  let html = await page.content().catch(() => '');
  let cookieCount = 0;

  // Cookie yukle (her durumda, login sayfasi olsun ya da olmasin)
  const saved = loadSahibindenStorageState();
  if (saved.storageState && saved.cookieCount > 0) {
    const now = Math.floor(Date.now() / 1000);
    for (const c of saved.storageState.cookies) {
      if (['csid', 'cwt', 'st'].includes(c.name) && c.expires) {
        const days = Math.round((c.expires - now) / 86400);
        console.log(`  Cookie ${c.name}: expires in ${days} day(s)`);
      }
    }
    await context.addCookies(saved.storageState.cookies);
    cookieCount += saved.cookieCount;
  }
  const extraCookies = loadAllSahibindenCookies();
  if (extraCookies.length > 0) {
    await context.addCookies(extraCookies);
    cookieCount += extraCookies.length;
  }
  console.log(`  ${cookieCount} cookie yuklendi.`);

  // Login sayfasina yonlendirildikse banaozel'e git
  if (url.includes('giris') || html.toLowerCase().includes('giris yap')) {
    console.log('  Login sayfasi, banaozel kontrol ediliyor...');
    if (cookieCount > 0) {
      try {
        await page.goto('https://banaozel.sahibinden.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      } catch (_) {}
      await sleep(2000);
      url = page.url();
      html = await page.content().catch(() => '');
    }
  }

  // Ekran fotografi al
  try {
    await page.screenshot({ path: 'init_session.png', fullPage: false });
    console.log('  Ekran fotografi alindi: init_session.png');
  } catch (_) {}

  // Giris yapildiysa kalan paralel sayfalari ac
  if (PARALLEL_PAGES > 1) {
    console.log(`  ${PARALLEL_PAGES - 1} ek sayfa aciliyor...`);
    for (let i = pages.length; i < PARALLEL_PAGES; i++) {
      pages.push(await context.newPage());
    }
    console.log(`  Toplam ${pages.length} sayfa hazir.`);
  }

  const finalSaved = loadSahibindenStorageState();
  return { ok: true, code: 'OK', cookieSource: finalSaved.source, cookieCount: finalSaved.cookieCount };
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
    for (const p of pages) { await p.close().catch(() => {}); }
    pages = [];
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
