/**
 * SCRAPEOPTS.MJS — Akıllı ScrapeOps Motoru
 * - Üç Kademe Bütçe Stratejisi
 * - Maksimum 300 kredi üst sınır
 */
import {
  SCRAPEOPS_API_KEY,
  MAX_CREDITS_PER_RUN,
  MAX_RETRIES,
  REQUEST_DELAY_MS,
  ITEMS_PER_PAGE,
  BASE_URL,
  MAX_PAGES_PER_SEGMENT,
} from './config.mjs';

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  pagesLoaded: 0,
  creditsUsed: 0,
};
export function getStats() { return { ...stats }; }

// ─── Otomatik Kademe Sistemi (Auto-Tier) ────────────────────
let currentTier = 3; // 1: optimize (1cr), 2: render_js_cheap (5cr), 3: render_js (10cr)
// Kullanıcının isteği üzerine kademe yükseltmeyi beklemek "yerine" doğrudan EN GÜÇLÜ (Kademe 3) teknikle başlıyoruz.

function getScrapeOpsUrl(targetUrl) {
  const urlParams = new URLSearchParams({
    api_key: SCRAPEOPS_API_KEY,
    url: targetUrl,
    country: 'tr', // TÜRKİYE IP ZORUNLU
  });

  if (currentTier === 1) {
    urlParams.append('optimize_request', 'true');
  } else if (currentTier === 2) {
    urlParams.append('render_js_cheap', 'true');
  } else if (currentTier === 3) {
    urlParams.append('render_js', 'true');
  }

  return `https://proxy.scrapeops.io/v1/?${urlParams.toString()}`;
}

function getCreditCostForTier(tier) {
  if (tier === 1) return 1;
  if (tier === 2) return 5;
  if (tier === 3) return 10;
  return 10;
}

// ─── Hata kontrolü (Hesap patlamış mı?) ─────────────────────
function checkScrapeOpsErrors(html) {
  if (html.includes('This account has been banned') || 
      html.includes('You have used 100% of your ScrapeOps proxy credits')) {
    return 'BANNED';
  }
  if (html.includes('Just a moment') || html.includes('challenge-platform')) {
    return 'CLOUDFLARE';
  }
  // Sahibinden 403 veya bos veri atayabilir
  if (html.includes('error-page-container')) {
    return 'BLOCK_SAHIBINDEN';
  }
  // Eğer ilan tablosu yoksa parse edemeyiz
  if (!html.includes('searchResultsItem') && html.length < 5000) {
     return 'INVALID';
  }
  return 'OK';
}

// ─── Tek sayfa çekme ──────────────────────────────────────────
async function fetchPage(targetUrl, label = '') {
  if (stats.creditsUsed >= MAX_CREDITS_PER_RUN) {
    console.log(`  💀 BÜTÇE LİMİTİ AŞILDI (${stats.creditsUsed}/${MAX_CREDITS_PER_RUN} kredi) — Koşu durduruluyor.`);
    return { html: null, status: 'BUDGET_EXHAUSTED' };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Basic scrapeops residential proxy endpoint mapping
    const proxyUrl = `http://scrapeops:${SCRAPEOPS_API_KEY}@proxy.scrapeops.io:5353`;
    const cost = 10; // We define cost as 10 conceptually for budget tracking
    
    console.log(`  🌐 -> Python curl_cffi Bot (Proxy Tüneli) [${cost}cr] (${label})`);
    stats.totalRequests++;

    try {
      const pythonScript = path.join(currentDir, 'python_scraper.py');
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      const result = spawnSync(pythonCmd, [pythonScript, targetUrl, proxyUrl], { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
      
      let html = "";
      let respStatus = 0;
      
      if (result.error) {
        console.log(`  ❌ Python Çalıştırma Hatası: ${result.error.message}`);
        await sleep(2000);
        continue;
      }
      
      try {
        const parsed = JSON.parse(result.stdout);
        respStatus = parsed.status;
        html = parsed.html || "";
        if (parsed.error) console.log(`  ⚠️ Python İç Hatası: ${parsed.error}`);
      } catch(e) {
         console.log(`  ⚠️ Çıktı JSON Parse Edilemedi: ${result.stdout ? result.stdout.substring(0, 100) : 'Boş çıktı'}...`);
         await sleep(2000);
         continue;
      }

      if (respStatus !== 200 && respStatus !== 404 && respStatus !== 403) {
         console.log(`  ⚠️ HTTP ${respStatus} (deneme ${attempt}) - DETAY: ${html.substring(0, 300)}`);
         await sleep(2000);
         continue;
      }

      const status = checkScrapeOpsErrors(html);
      
      // If ScrapeOps Proxy strictly blocks
      if (status === 'BANNED') {
         console.log(`  💀 ScrapeOps Proxy YASAKLANMIŞ veya Kredisi Bitti!`);
         return { html: null, status: 'BANNED' };
      }
      
      stats.creditsUsed += cost;
      
      if (status === 'CLOUDFLARE' || status === 'INVALID') {
         console.log(`  ⚠️ Tarayıcı engeli geçilemedi (curl_cffi impersonate deneme ${attempt})`);
         // We can fallback to retry
         await sleep(2000);
         continue;
      }

      // BAŞARILI
      stats.successfulRequests++;
      stats.pagesLoaded++;
      return { html, status: 'OK' };

    } catch (err) {
      console.log(`  ❌ Hata: ${err.message} (deneme ${attempt})`);
      await sleep(2000);
    }
  }

  stats.failedRequests++;
  return { html: null, status: 'FAILED' };
}

// ─── URL oluştur ────────────────────────────────────────────
export function buildSahibindenUrl(offset, priceMin, priceMax) {
  const url = new URL(BASE_URL);
  url.searchParams.set('pagingOffset', String(offset));
  url.searchParams.set('pagingSize', String(ITEMS_PER_PAGE));
  url.searchParams.set('sorting', 'date_desc'); // FIRSAT ICIN YENILER ONEMLI
  if (priceMin != null) url.searchParams.set('price_min', String(priceMin));
  if (priceMax != null) url.searchParams.set('price_max', String(priceMax));
  return url.toString();
}

// ─── Segment scraper ────────────────────────────────────────
export async function scrapeSegment(priceMin, priceMax) {
  const label = `${priceMin.toLocaleString('tr')}-${priceMax.toLocaleString('tr')} TL`;
  console.log(`\n  📦 Segment: ${label} (Mevcut Kredi: ${stats.creditsUsed}/${MAX_CREDITS_PER_RUN})`);

  const firstUrl = buildSahibindenUrl(0, priceMin, priceMax);
  const { html: firstHtml, status } = await fetchPage(firstUrl, `${label} (s:1)`);

  if (!firstHtml || status === 'BANNED' || status === 'BUDGET_EXHAUSTED') {
    return { htmlPages: [], totalFound: 0, pages: 0, status };
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
  console.log(`  📊 ${label}: Toplam ${totalCount.toLocaleString('tr')} ilan, ${totalPages} sayfa.`);

  for (let page = 1; page < totalPages; page++) {
    await sleep(REQUEST_DELAY_MS);
    const offset = page * ITEMS_PER_PAGE;
    const url = buildSahibindenUrl(offset, priceMin, priceMax);
    const { html, status: pageStatus } = await fetchPage(url, `${label} (s:${page + 1})`);
    
    if (pageStatus === 'BANNED' || pageStatus === 'BUDGET_EXHAUSTED') {
       return { htmlPages, totalFound: totalCount, pages: htmlPages.length, status: pageStatus };
    }
    
    if (html) htmlPages.push(html);
  }

  console.log(`  ✅ Segment bitti. Toplam çekilen sayfa: ${htmlPages.length}`);
  return { htmlPages, totalFound: totalCount, pages: htmlPages.length, status: 'OK' };
}

// ─── Uyumluluk
export async function initSession() {
  return 'OK'; // ScrapeOps API kullandığımız için session init gerekmiyor
}

export async function closeBrowser() {
  // Uyumluluk
}

export default {
  initSession,
  scrapeSegment,
  getStats,
  closeBrowser,
};
