/**
 * ═══════════════════════════════════════════════════════════════
 *  PARSER.MJS — Sahibinden HTML Ayrıştırma + Deduplikasyon
 *  Cheerio tabanlı DOM parse, fiyat normalizasyonu, temizlik
 * ═══════════════════════════════════════════════════════════════
 */
import * as cheerio from 'cheerio';

const BASE_SITE = 'https://www.sahibinden.com';

// ─── Fiyat Normalizasyonu ────────────────────────────────────
// "12.500 TL" → 12500 (number)
export function normalizePrice(priceStr) {
  if (!priceStr) return 0;
  // "12.500 TL" → "12500"
  const cleaned = priceStr
    .replace(/[^\d.,]/g, '')   // Harfleri ve TL'yi kaldır
    .replace(/\./g, '')         // Binlik noktaları kaldır
    .replace(',', '.');         // Decimal virgülü noktaya çevir
  return parseFloat(cleaned) || 0;
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
  $('tr.searchResultsItem').each((_, row) => {
    const $row = $(row);
    const classes = ($row.attr('class') || '').split(/\s+/);

    // Reklam ve promosyon ilanlarını atla
    const skipClasses = ['nativeAd', 'searchResultsPromoSuper', 'searchResultsPromoHighlight'];
    if (skipClasses.some(c => classes.includes(c))) return;

    // Başlık ve link
    const titleEl = $row.find('a.classifiedTitle').first().length
      ? $row.find('a.classifiedTitle').first()
      : $row.find('td.searchResultsTitleValue a').first();

    if (!titleEl.length) return;

    const href = (titleEl.attr('href') || '').trim();
    const baslik = titleEl.text().trim();

    // İlan ID — URL'den çıkar
    const idMatch = href.match(/\/(\d{7,})(?:\/|$)/);
    const ilan_id = idMatch ? idMatch[1] : '';

    // Fiyat
    const priceEl = $row.find('td.searchResultsPriceValue span').first().length
      ? $row.find('td.searchResultsPriceValue span').first()
      : $row.find('td.searchResultsPriceValue div').first();
    const fiyatStr = priceEl.length ? priceEl.text().trim() : '';
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

    const url = href.startsWith('http') ? href : `${BASE_SITE}${href}`;

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
  return listings.filter(item => {
    // ID'si yok ise atla
    if (!item.ilan_id) return false;
    // Fiyatı 0 veya çok absürt olanlari atla
    if (item.fiyat <= 0) return false;
    // Başlığı boş ise atla
    if (!item.baslik || item.baslik.length < 3) return false;
    return true;
  });
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
  parseListingPage,
  parseAllPages,
  deduplicateListings,
  filterInvalidListings,
};
