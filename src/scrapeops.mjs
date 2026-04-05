/**
 * SCRAPER.MJS — Playwright Tabanlı Sahibinden Scraper
 * ScrapeOps'a bağımlılık YOK. Gerçek tarayıcı ile Cloudflare bypass.
 * Maliyet: 0 TL, sınırsız ilan.
 */
import { chromium } from 'playwright';
import {
  MAX_RETRIES,
  REQUEST_DELAY_MS,
  ITEMS_PER_PAGE,
  BASE_URL,
  MAX_PAGES_PER_SEGMENT,
} from './config.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  pagesLoaded: 0,
};
export function getStats() { return { ...stats }; }

// ─── Tarayıcı bağlamı (tek sefer açılır, herkes paylaşır) ───
let _browser = null;
let _context = null;

async function getBrowserContext() {
  if (_context) return _context;

  console.log('  🌐 Playwright tarayıcı başlatılıyor...');
  _browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  _context = await _browser.newContext({
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  return _context;
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
    _context = null;
  }
}

// ─── Cloudflare challenge'ı geçene kadar bekle ──────────────
async function waitForCloudflare(page, maxWaitSec = 30) {
  for (let i = 0; i < maxWaitSec; i++) {
    const content = await page.content();
    const isChallenge =
      content.includes('Just a moment') ||
      content.includes('challenge-platform') ||
      content.includes('cf-spinner');

    if (!isChallenge) return true;
    await sleep(1000);
  }
  return false;
}

// ─── URL oluştur ────────────────────────────────────────────
export function buildSahibindenUrl(offset, priceMin, priceMax) {
  const url = new URL(BASE_URL);
  url.searchParams.set('pagingOffset', String(offset));
  url.searchParams.set('pagingSize', String(ITEMS_PER_PAGE));
  if (priceMin != null) url.searchParams.set('price_min', String(priceMin));
  if (priceMax != null) url.searchParams.set('price_max', String(priceMax));
  return url.toString();
}

// ─── Tek sayfa çek ──────────────────────────────────────────
async function fetchPage(targetUrl, label = '') {
  const ctx = await getBrowserContext();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    stats.totalRequests++;
    const page = await ctx.newPage();

    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // Cloudflare varsa bekle
      const passed = await waitForCloudflare(page, 20);
      if (!passed) {
        console.log(`  ⚠️ CF Challenge geçilemedi [${label}] (deneme ${attempt})`);
        await page.close();
        await sleep(3000);
        continue;
      }

      // İlan tablosu yüklenene kadar bekle
      await page.waitForSelector('tr.searchResultsItem', { timeout: 15000 }).catch(() => {});
      await sleep(1000); // Ekstra stabilite

      const html = await page.content();
      await page.close();

      // Boş veya hata sayfası kontrolü
      if (html.includes('error-page-container')) {
        console.log(`  ⚠️ Sahibinden hata sayfası [${label}] (deneme ${attempt})`);
        await sleep(3000);
        continue;
      }

      stats.successfulRequests++;
      stats.pagesLoaded++;
      return html;

    } catch (err) {
      console.log(`  ❌ ${err.message} [${label}] (deneme ${attempt})`);
      await page.close().catch(() => {});
      await sleep(2000 * attempt);
    }
  }

  stats.failedRequests++;
  console.log(`  💀 BAŞARISIZ [${label}] — Atlanıyor.`);
  return null;
}

// ─── Segment scraper ────────────────────────────────────────
export async function scrapeSegment(priceMin, priceMax) {
  const label = `${priceMin.toLocaleString('tr')}-${priceMax.toLocaleString('tr')} TL`;
  console.log(`\n  📦 Segment: ${label}`);

  const firstUrl = buildSahibindenUrl(0, priceMin, priceMax);
  const firstHtml = await fetchPage(firstUrl, `${label} (Sayfa 1)`);

  if (!firstHtml) {
    console.log(`  ❌ ${label}: İlk sayfa alınamadı.`);
    return { htmlPages: [], totalFound: 0, pages: 0 };
  }

  const htmlPages = [firstHtml];

  // Toplam ilan sayısını bul
  let totalCount = 0;
  const totalMatch = firstHtml.match(/([\d.]+)\s*ilan/i);
  if (totalMatch) {
    totalCount = parseInt(totalMatch[1].replace(/\./g, ''), 10);
  }

  const totalPages = Math.min(
    Math.ceil(totalCount / ITEMS_PER_PAGE),
    MAX_PAGES_PER_SEGMENT
  );
  console.log(`  📊 ${label}: ${totalCount.toLocaleString('tr')} ilan, ${totalPages} sayfa çekilecek`);

  // Kalan sayfaları sırayla çek (paralel değil — ban riski)
  for (let page = 1; page < totalPages; page++) {
    await sleep(REQUEST_DELAY_MS);
    const offset = page * ITEMS_PER_PAGE;
    const url = buildSahibindenUrl(offset, priceMin, priceMax);
    const html = await fetchPage(url, `${label} (Sayfa ${page + 1})`);
    if (html) {
      htmlPages.push(html);
    }
  }

  console.log(`  ✅ ${label}: ${htmlPages.length} sayfa çekildi`);
  return { htmlPages, totalFound: totalCount, pages: htmlPages.length };
}

// ─── Uyumluluk: eski main.mjs initSession çağrısı için ──────
export async function initSession() {
  // İlk sayfayı ziyaret ederek tarayıcıyı ısıt ve CF cookie'leri al
  const ctx = await getBrowserContext();
  const page = await ctx.newPage();

  try {
    console.log('  🔐 Cloudflare bypass deneniyor...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const passed = await waitForCloudflare(page, 30);

    if (!passed) {
      console.log('  ❌ Cloudflare geçilemedi!');
      await page.close();
      return null;
    }

    // İlan tablosu yüklenmesini bekle
    await page.waitForSelector('tr.searchResultsItem', { timeout: 20000 }).catch(() => {});
    console.log('  ✅ Cloudflare bypass başarılı! Cookie\'ler kaydedildi.');
    await page.close();
    return 'OK';
  } catch (err) {
    console.log(`  ❌ initSession hatası: ${err.message}`);
    await page.close().catch(() => {});
    return null;
  }
}

export default {
  initSession,
  scrapeSegment,
  buildSahibindenUrl,
  getStats,
  closeBrowser,
};
