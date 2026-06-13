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
    page = await context.newPage();

    // Daha once kaydedilmis cookie varsa yukle
    const saved = loadSahibindenStorageState();
    if (saved.storageState && saved.cookieCount > 0) {
      // Log cookie expiry diagnostics
      const now = Math.floor(Date.now() / 1000);
      for (const c of saved.storageState.cookies) {
        if (['csid', 'cwt', 'st'].includes(c.name) && c.expires) {
          const days = Math.round((c.expires - now) / 86400);
          console.log(`  Cookie ${c.name}: expires in ${days} day(s) (${new Date(c.expires * 1000).toISOString()})`);
        }
      }
      await context.addCookies(saved.storageState.cookies);
      console.log(`  ${saved.cookieCount} adet kayitli cookie yuklendi (kaynak: ${saved.source}).`);
    }

    // Ayrica SAHIBINDEN_COOKIES env ve cookies.json dosyasindaki cookie'leri yukle
    const extraCookies = loadAllSahibindenCookies();
    if (extraCookies.length > 0) {
      await context.addCookies(extraCookies);
      console.log(`  ${extraCookies.length} adet ek cookie yuklendi (env/dosya).`);
    }

    console.log('  Tarayici hazir.');
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
  if (!context) return false;
  try {
    console.log('  FlareSolverr ile Cloudflare cozuluyor...');
    const solution = await solveUrlWithFlareSolverr(targetUrl);
    const cookies = flareSolverrCookiesToPlaywright(solution.cookies || []);
    if (cookies.length === 0) {
      console.log('  FlareSolverr cookie donmedi.');
      return false;
    }
    await context.addCookies(cookies);
    console.log(`  FlareSolverr'den ${cookies.length} cookie eklendi.`);
    return true;
  } catch (err) {
    console.log(`  FlareSolverr hatasi: ${err.message}`);
    return false;
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
    console.log(`  Camoufox -> ${label} (Deneme ${attempt})`);
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
            stats.successfulRequests++;
            stats.pagesLoaded++;
            stats.creditsUsed++;
            return { html, status: 'OK' };
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

export async function scrapePageSections(sectionCount) {
  const firstUrl = buildSahibindenUrl(0, null, null);
  const { html: firstHtml, status } = await fetchPage(firstUrl, 'Toplam hesaplama');

  if (!firstHtml || status === 'BANNED' || status === 'BUDGET_EXHAUSTED') {
    return [];
  }

  const totalCount = extractTotalCountFromHtml(firstHtml);
  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
  const pagesPerSection = Math.ceil(totalPages / sectionCount);

  console.log(`\n  📋 ${sectionCount} bölüm halinde ${totalPages} sayfa taranacak`);
  console.log(`  📊 Toplam: ${totalCount.toLocaleString('tr')} ilan, bölüm başına ~${pagesPerSection} sayfa`);

  const results = [];
  let currentPage = 0;

  for (let s = 0; s < sectionCount && currentPage < totalPages; s++) {
    const startPage = currentPage;
    const endPage = Math.min(startPage + pagesPerSection - 1, totalPages - 1);
    const label = `Bölüm ${s + 1}`;

    console.log(`\n  ${label}: sayfa ${startPage + 1}-${endPage + 1} (Kredi: ${stats.creditsUsed}/${MAX_CREDITS_PER_RUN})`);

    const htmlPages = [];

    for (let p = startPage; p <= endPage; p++) {
      if (p === 0 && s === 0) {
        htmlPages.push(firstHtml);
        continue;
      }
      await sleep(REQUEST_DELAY_MS);
      const offset = p * ITEMS_PER_PAGE;
      const url = buildSahibindenUrl(offset, null, null);
      const { html, status: pageStatus } = await fetchPage(url, `${label} (s:${p + 1})`);

      if (pageStatus === 'BUDGET_EXHAUSTED') break;
      if (html) htmlPages.push(html);
    }

    results.push({ htmlPages, totalFound: totalCount, pages: htmlPages.length, status: 'OK' });
    currentPage = endPage + 1;

    console.log(`  ${label} bitti. Sayfa: ${htmlPages.length}`);
  }

  return results;
}

export async function scrapeDetailUrl(detailUrl) {
  const targetUrl = String(detailUrl || '').trim();
  if (!targetUrl) return { html: null, status: 'INVALID_URL' };
  return fetchPage(targetUrl, `detail: ${targetUrl}`);
}

export async function initSession() {
  const ok = await ensureBrowser();
  if (!ok) return { ok: false, code: 'BROWSER_INIT_FAILED' };

  console.log('  Session dogrulaniyor (banaozel.sahibinden.com)...');
  try {

    // 1. Once ana sayfaya git (Cloudflare challenge varsa cozulsun)
    await page.goto('https://www.sahibinden.com/', {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_NAV_TIMEOUT_MS,
    });
    await sleep(3000);
    await solveTurnstileIfPresent(30000);

    // 2. Session dogrulamasi icin login gerektiren sayfaya git
    await page.goto('https://banaozel.sahibinden.com/', {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_NAV_TIMEOUT_MS,
    });
    await sleep(5000);

    const url = page.url();
    const html = await page.content().catch(() => '');

    // Login sayfasina yonlendirildik ΓåÆ session gecersiz
    if (url.includes('giris') || html.toLowerCase().includes('giris yap')) {
      console.log('  Login sayfasi ΓÇö cookie gerekli.');
      return { ok: false, code: 'LOGIN_REQUIRED' };
    }

    // Bana Ozel sayfasi acildi ΓåÆ session gecerli
    if (url.includes('banaozel')) {
      console.log('  Session dogrulandi, login kalindi.');
      const saved = loadSahibindenStorageState();
      return {
        ok: true,
        code: 'OK',
        cookieSource: saved.source,
        cookieCount: saved.cookieCount,
      };
    }

    // Cloudflare challenge sayfasi
    if (isChallengePage(html)) {
      const fsOk = await applyFlareSolverrCookies(url);
      if (fsOk) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: DEFAULT_NAV_TIMEOUT_MS });
        await sleep(5000);
        const url2 = page.url();
        if (url2.includes('banaozel')) {
          console.log('  Session dogrulandi (FlareSolverr ile).');
          const saved = loadSahibindenStorageState();
          return { ok: true, code: 'OK', cookieSource: saved.source, cookieCount: saved.cookieCount };
        }
      }
      console.log('  Cloudflare engeli asilamadi.');
      return { ok: false, code: 'CF_BLOCKED' };
    }

    console.log('  Bilinmeyen yonlendirme.');
    return { ok: false, code: 'UNKNOWN_REDIRECT' };
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
  initSession, scrapeSegment, scrapePageSections, scrapeDetailUrl, getStats,
  saveChallengeProofScreenshot, takeScreenshot, closeBrowser,
  saveStorageState,
};
