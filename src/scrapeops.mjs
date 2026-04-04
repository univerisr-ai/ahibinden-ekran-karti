/**
 * ═══════════════════════════════════════════════════════════════
 *  SCRAPEOPS.MJS — ScrapeOps Proxy API Motor Katmanı
 *  Full CF Bypass, Otomatik Key Rotasyonu, Overload Koruması
 * ═══════════════════════════════════════════════════════════════
 */
import {
  getNextKey,
  MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  REQUEST_DELAY_MS,
  ITEMS_PER_PAGE,
  BASE_URL,
} from './config.mjs';

const SCRAPEOPS_ENDPOINT = 'https://proxy.scrapeops.io/v1/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  estimatedCredits: 0,
};
export function getStats() { return { ...stats }; }

// ─── Sahibinden URL ──────────────────────────────────────────
export function buildSahibindenUrl(offset, priceMin, priceMax) {
  const url = new URL(BASE_URL);
  url.searchParams.set('pagingOffset', String(offset));
  url.searchParams.set('pagingSize', String(ITEMS_PER_PAGE));
  if (priceMin !== undefined && priceMin !== null) url.searchParams.set('price_min', String(priceMin));
  if (priceMax !== undefined && priceMax !== null) url.searchParams.set('price_max', String(priceMax));
  // Not: En yeni ilanlardan taramaya başlamak 2000'den fazlasında faydalıdır.
  // url.searchParams.set('sorting', 'date_desc'); 
  return url.toString();
}

// ─── Kesin Tutan Fetch ve Key Rotasyonu ───────────────────────
async function fetchWithFullBypass(targetUrl, label = '') {
  let currentKey = getNextKey();
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    stats.totalRequests++;
    
    const proxyUrl = new URL(SCRAPEOPS_ENDPOINT);
    proxyUrl.searchParams.set('api_key', currentKey);
    proxyUrl.searchParams.set('url', targetUrl);
    proxyUrl.searchParams.set('render_js', 'true');
    proxyUrl.searchParams.set('bypass', 'cloudflare_level_3');
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000); // 90sn CF timeout
      
      const resp = await fetch(proxyUrl.toString(), {
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      clearTimeout(timeout);
      
      if (resp.ok) {
        stats.successfulRequests++;
        stats.estimatedCredits += 25; // RenderJs + CF Level 3 = ~25 Kredi
        const html = await resp.text();
        
        // Cloudflare ekranında kalmışsa (200 OK dönebilir)
        if (html.includes('Just a moment') || html.includes('challenge-platform')) {
          console.log(`  ⚠️ CF Challenge takıldı [${label}]. Tekrar deneniyor... (deneme ${attempt})`);
          await sleep(3000);
          continue;
        }
        return html;
      }
      
      if (resp.status === 403) {
        console.log(`  🚫 403 Forbidden [${label}] — Mevcut API KEY'in kredisi bitti! (${currentKey.substring(0, 5)}...)`);
        currentKey = getNextKey(); // Havuzdaki SIRADAKİ KEY'i AL
        console.log(`  🔄 Yeni Key'e geçildi: ${currentKey.substring(0, 5)}...`);
        // Kredi bittiği için attempt sayısını arttırmadan direkt yeni key ile dene
        attempt--; 
        await sleep(1000);
        continue;
      }
      
      if (resp.status === 429) {
        console.log(`  ⏳ 429 Rate Limit [${label}] — Scrapeops bizi bekletiyor.`);
        await sleep(5000);
        continue;
      }
      
      console.log(`  ⚠️ HTTP ${resp.status} [${label}] (deneme ${attempt}/${MAX_RETRIES})`);
      await sleep(RETRY_BASE_DELAY_MS * attempt);
      
    } catch (err) {
      console.log(`  ❌ Hata: ${err.name === 'AbortError' ? 'Zaman Aşımı' : err.message} [${label}]`);
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  stats.failedRequests++;
  console.log(`  💀 BAŞARISIZ [${label}] — Atlanıyor.`);
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  SEGMENT SCRAPER — Bir fiyat aralığının sayfalarını dolaşır
// ═══════════════════════════════════════════════════════════════
export async function scrapeSegment(priceMin, priceMax, dynamicSplit = true) {
  const label = `${priceMin.toLocaleString('tr')}-${priceMax.toLocaleString('tr')} TL`;
  console.log(`\n  📦 Segment: ${label}`);

  const targetFirstPageUrl = buildSahibindenUrl(0, priceMin, priceMax);
  const firstHtml = await fetchWithFullBypass(targetFirstPageUrl, `${label} (Sayfa 1)`);
  
  if (!firstHtml) {
    console.log(`  ❌ ${label}: İlk sayfa alınamadı, segment atlanıyor.`);
    return { listings: [], totalFound: 0, pages: 0 };
  }

  const htmlPages = [firstHtml];

  // Regex ile sayfadaki "X ilan" metninden toplam ilan sayısını al
  let totalCount = 0;
  const totalMatch = firstHtml.match(/([\d.]+)\s*ilan/i);
  if (totalMatch) {
    totalCount = parseInt(totalMatch[1].replace(/\./g, ''), 10);
  }

  const totalPages = Math.min(Math.ceil(totalCount / ITEMS_PER_PAGE), 20);
  console.log(`  📊 ${label}: ${totalCount.toLocaleString('tr')} ilan, ${totalPages} sayfa`);

  if (dynamicSplit && totalCount >= 950) {
    const mid = Math.floor((priceMin + priceMax) / 2);
    if (mid > priceMin && mid < priceMax) {
      console.log(`  🔀 LIMIT AŞILDI (1000)! ${label} iki parçaya bölünüyor...`);
      const leftResult = await scrapeSegment(priceMin, mid, true);
      const rightResult = await scrapeSegment(mid, priceMax, true);
      return {
        listings: [],
        htmlPages: [...leftResult.htmlPages, ...rightResult.htmlPages],
        totalFound: leftResult.totalFound + rightResult.totalFound,
        pages: leftResult.pages + rightResult.pages,
      };
    }
  }

  // 2. Sayfadan 20. Sayfaya kadar döngü
  for (let page = 1; page < totalPages; page++) {
    await sleep(REQUEST_DELAY_MS); // Spam yapmamak için bekle
    const offset = page * ITEMS_PER_PAGE;
    const urlPage = buildSahibindenUrl(offset, priceMin, priceMax);
    
    const html = await fetchWithFullBypass(urlPage, `${label} (Sayfa ${page + 1})`);
    if (html) {
      htmlPages.push(html);
    }
  }

  console.log(`  ✅ ${label}: Toplam ${htmlPages.length} sayfa çekildi`);
  return { listings: [], htmlPages, totalFound: totalCount, pages: htmlPages.length };
}

// Master / session_init fonksiyonunu siliyoruz çünkü API'de oturum tutunamadı
export async function initSession() {
  return "BYPASSED_SUCCESSFULLY"; // Main.js çökmesin diye dummy dönüyoruz
}

export default {
  initSession,
  scrapeSegment,
  buildSahibindenUrl,
  getStats
};
