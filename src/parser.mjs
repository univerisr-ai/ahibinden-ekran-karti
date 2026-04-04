/**
 * ═══════════════════════════════════════════════════════════════
 *  PARSER.MJS — Sahibinden HTML Ayrıştırma + Deduplikasyon
 *  Cheerio tabanlı DOM parse, fiyat normalizasyonu, temizlik
 * ═══════════════════════════════════════════════════════════════
 */
import * as cheerio from 'cheerio';

const BASE_SITE = 'https://www.sahibinden.com';
let lastFilterStats = {
  missingId: 0,
  invalidPrice: 0,
  missingTitle: 0,
  kept: 0,
};

// ─── Fiyat Normalizasyonu ────────────────────────────────────
// "12.500 TL" → 12500 (number)
export function normalizePrice(priceStr) {
  if (!priceStr) return 0;
  // "12.500 TL" → "12500"
  const cleaned = priceStr
    .replace(/\u00A0/g, ' ')
    .replace(/[^\d.,\s]/g, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return parseFloat(cleaned) || 0;
}

export function extractListingId(url = '') {
  if (!url) return '';

  let match = url.match(/-(\d{6,})(?:\/detay)?(?:[/?#]|$)/i);
  if (match) return match[1];

  match = url.match(/\/(\d{6,})(?:\/detay)?(?:[/?#]|$)/i);
  if (match) return match[1];

  match = url.match(/[?&](?:id|ilan_id|listingId)=(\d{6,})/i);
  return match ? match[1] : '';
}

function firstElement($root, selectors) {
  for (const selector of selectors) {
    const found = $root.find(selector).first();
    if (found.length) return found;
  }
  return null;
}

// ─── Tek Sayfa Parse ─────────────────────────────────────────
export function parseListingPage(html, segmentLabel = '') {
  const $ = cheerio.load(html);
  const listings = [];

  // Toplam ilan sayısını bul
  let totalCount = 0;
  const selectors = ['.result-text', '#searchResultsCount', '.searchResultCount', 'h1'];
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length) {
      const match = el.text().match(/([\d.]+)\s*ilan/i);
      if (match) {
        totalCount = parseInt(match[1].replace(/\./g, ''), 10);
        break;
      }
    }
  }

  // Fallback: tüm body text'te ara
  if (totalCount === 0) {
    const bodyText = $('body').text();
    const match = bodyText.match(/([\d.]{3,})\s*ilan/i);
    if (match) {
      totalCount = parseInt(match[1].replace(/\./g, ''), 10);
    }
  }

  // İlan satırlarını parse et
  $('tr.searchResultsItem, tr[class*="searchResultsItem"]').each((_, row) => {
    const $row = $(row);
    const classes = ($row.attr('class') || '').split(/\s+/);

    // Reklam ve promosyon ilanlarını atla
    const skipClasses = ['nativeAd', 'searchResultsPromoSuper', 'searchResultsPromoHighlight'];
    if (skipClasses.some(c => classes.includes(c))) return;

    // Başlık ve link
    const titleEl = firstElement($row, [
      'a.classifiedTitle',
      'td.searchResultsTitleValue a',
      'a[href*="/ilan/"]',
    ]);

    if (!titleEl || !titleEl.length) return;

    const href = (titleEl.attr('href') || titleEl.attr('data-href') || '').trim();
    const baslik = titleEl.text().trim();

    // İlan ID — URL'den çıkar
    const ilan_id = extractListingId(href);

    // Fiyat
    const priceEl = firstElement($row, [
      'td.searchResultsPriceValue span',
      'td.searchResultsPriceValue div',
      'td.searchResultsPriceValue',
      '[class*="searchResultsPrice"]',
    ]);
    let fiyatStr = priceEl && priceEl.length ? priceEl.text().trim() : '';
    if (!fiyatStr) {
      const rowText = $row.text().replace(/\s+/g, ' ');
      const fallback = rowText.match(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?\s*TL)/i);
      fiyatStr = fallback ? fallback[1] : '';
    }
    const fiyat = normalizePrice(fiyatStr);

    // Konum
    const locEl = $row.find('td.searchResultsLocationValue').first();
    const konum = locEl.length ? locEl.text().trim().replace(/\s+/g, ' ') : '';

    // Tarih
    const dateEl = $row.find('td.searchResultsDateValue span').first().length
      ? $row.find('td.searchResultsDateValue span').first()
      : $row.find('td.searchResultsDateValue').first();
    const tarih = dateEl.length ? dateEl.text().trim() : '';

    // Resim
    const imgEl = $row.find('img').first();
    const resim = imgEl.length
      ? (imgEl.attr('src') || imgEl.attr('data-src') || '')
      : '';

    let url = '';
    try {
      url = href ? new URL(href, BASE_SITE).toString() : '';
    } catch {
      url = href.startsWith('http') ? href : `${BASE_SITE}${href}`;
    }

    listings.push({
      ilan_id,
      baslik,
      fiyat,
      fiyat_str: fiyatStr,
      konum,
      tarih,
      url,
      resim,
      segment: segmentLabel,
    });
  });

  return { listings, totalCount };
}

// ─── Deduplikasyon (O(n) Map tabanlı) ───────────────────────
export function deduplicateListings(allListings) {
  const map = new Map();
  for (const item of allListings) {
    const key = item.ilan_id || item.url;
    if (key && !map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

// ─── Temel Filtre — Bozuk/Anlamsız ilanları temizle ─────────
export function filterInvalidListings(listings) {
  const stats = {
    missingId: 0,
    invalidPrice: 0,
    missingTitle: 0,
    kept: 0,
  };

  const filtered = [];

  for (const item of listings) {
    const normalized = { ...item };
    normalized.ilan_id = normalized.ilan_id || extractListingId(normalized.url || '');
    if (!normalized.ilan_id) {
      stats.missingId += 1;
      continue;
    }

    const price = normalized.fiyat > 0
      ? normalized.fiyat
      : normalizePrice(normalized.fiyat_str || '');
    if (!(price > 0)) {
      stats.invalidPrice += 1;
      continue;
    }
    normalized.fiyat = price;

    if (!normalized.baslik || normalized.baslik.trim().length < 3) {
      stats.missingTitle += 1;
      continue;
    }

    filtered.push(normalized);
    stats.kept += 1;
  }

  lastFilterStats = stats;
  return filtered;
}

export function getLastFilterStats() {
  return { ...lastFilterStats };
}

// ─── Toplu Parse: Birden fazla HTML sayfasını işle ───────────
export function parseAllPages(htmlPages, segmentLabel = '') {
  const allListings = [];
  let maxTotal = 0;

  for (const html of htmlPages) {
    const { listings, totalCount } = parseListingPage(html, segmentLabel);
    allListings.push(...listings);
    if (totalCount > maxTotal) maxTotal = totalCount;
  }

  return { listings: allListings, totalCount: maxTotal };
}

export default {
  normalizePrice,
  extractListingId,
  parseListingPage,
  parseAllPages,
  deduplicateListings,
  filterInvalidListings,
  getLastFilterStats,
};
