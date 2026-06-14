/**
 * ═══════════════════════════════════════════════════════════════
 *  PARSER.MJS — Sahibinden HTML Ayrıştırma + Deduplikasyon
 *  Cheerio tabanlı DOM parse, fiyat normalizasyonu, temizlik
 * ═══════════════════════════════════════════════════════════════
 */
import * as cheerio from 'cheerio';

const BASE_SITE = 'https://www.sahibinden.com';
const TOTAL_COUNT_PATTERNS = [
  /([\d.]+)\s*ilan/i,
  /([\d.]+)\s*sonu[cç]\s*bulundu/i,
  /toplam\s*([\d.]+)/i,
];
const PRICE_TEXT_REGEX = /(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?\s*TL)/i;
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

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractTextBySelectors($root, selectors) {
  const element = firstElement($root, selectors);
  return element && element.length ? cleanText(element.text()) : '';
}

function extractTitleFromLink(linkEl) {
  if (!linkEl || !linkEl.length) return '';

  const candidates = [
    linkEl.text(),
    linkEl.attr('title'),
    linkEl.attr('aria-label'),
    linkEl.attr('data-title'),
  ];

  for (const candidate of candidates) {
    const text = cleanText(candidate);
    if (text) return text;
  }

  return '';
}

function normalizeImageUrl(value = '') {
  const raw = String(value || '').trim().replace(/&amp;/g, '&');
  if (!raw) return '';

  try {
    return new URL(raw, BASE_SITE).toString();
  } catch {
    return raw;
  }
}

function isPlaceholderImageUrl(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    !normalized ||
    normalized.startsWith('data:') ||
    normalized.includes('no-image-camera') ||
    normalized.includes('/no-image') ||
    normalized.includes('blank.gif') ||
    normalized.includes('spacer.gif') ||
    normalized.includes('transparent')
  );
}

function looksLikeImageUrl(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    normalized.includes('shbdn.com/photos/') ||
    normalized.includes('/photos/') ||
    /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(normalized)
  );
}

function parseSrcsetCandidates(value = '') {
  return String(value || '')
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0] || '')
    .filter(Boolean);
}

function firstUsableImageUrl(values) {
  for (const value of values) {
    const normalized = normalizeImageUrl(value);
    if (!isPlaceholderImageUrl(normalized) && looksLikeImageUrl(normalized)) {
      return normalized;
    }
  }
  return '';
}

function extractImageUrl($row) {
  const candidates = [];
  const rowAttrs = $row.attr() || {};

  candidates.push(...Object.values(rowAttrs));

  $row.find('img').each((_, img) => {
    const attrs = img.attribs || {};
    candidates.push(
      attrs['data-src'],
      attrs['data-original'],
      attrs['data-lazy'],
      attrs['data-lazy-src'],
      attrs['data-img'],
      attrs['data-image'],
      ...parseSrcsetCandidates(attrs['data-srcset']),
      ...parseSrcsetCandidates(attrs.srcset),
      attrs.src,
    );
  });

  const directMatch = firstUsableImageUrl(candidates);
  if (directMatch) {
    return directMatch;
  }

  const rowHtml = $row.html() || '';
  const htmlMatches = rowHtml.match(/(?:https?:)?\/\/[^"'\s<>]+shbdn\.com\/photos\/[^"'\s<>]+/gi) || [];
  return firstUsableImageUrl(htmlMatches);
}

function extractPriceText($root) {
  const priceEl = firstElement($root, [
    'td.searchResultsPriceValue span',
    'td.searchResultsPriceValue div',
    'td.searchResultsPriceValue',
    '[data-testid*="price"]',
    '[data-test-id*="price"]',
    '[itemprop="price"]',
    '[class*="searchResultsPrice"]',
    '[class*="price"]',
    '[class*="Price"]',
  ]);
  if (priceEl && priceEl.length) {
    const text = cleanText(priceEl.text());
    if (text) return text;
  }

  const rowText = cleanText($root.text());
  const fallback = rowText.match(PRICE_TEXT_REGEX);
  return fallback ? cleanText(fallback[1]) : '';
}

function extractDateText($root) {
  return extractTextBySelectors($root, [
    'td.searchResultsDateValue span',
    'td.searchResultsDateValue',
    'time',
    '[data-testid*="date"]',
    '[data-test-id*="date"]',
    '[class*="date"]',
    '[class*="Date"]',
  ]);
}

function extractLocationText($root) {
  return extractTextBySelectors($root, [
    'td.searchResultsLocationValue',
    '[data-testid*="location"]',
    '[data-test-id*="location"]',
    '[class*="location"]',
    '[class*="Location"]',
    '[class*="town"]',
    '[class*="city"]',
  ]);
}

function toAbsoluteUrl(href = '') {
  const rawHref = String(href || '').trim();
  if (!rawHref) return '';

  try {
    return new URL(rawHref, BASE_SITE).toString();
  } catch {
    return rawHref.startsWith('http') ? rawHref : `${BASE_SITE}${rawHref}`;
  }
}

function extractListingFromContainer($root, segmentLabel = '') {
  const titleEl = firstElement($root, [
    'a.classifiedTitle',
    'td.searchResultsTitleValue a',
    'h2 a[href*="/ilan/"]',
    'h3 a[href*="/ilan/"]',
    'a[href*="/ilan/"]',
    'a[data-href*="/ilan/"]',
  ]);

  if (!titleEl || !titleEl.length) return null;

  const href = cleanText(titleEl.attr('href') || titleEl.attr('data-href') || '');
  const baslik = extractTitleFromLink(titleEl);
  const ilan_id = extractListingId(href);
  const fiyat_str = extractPriceText($root);
  const fiyat = normalizePrice(fiyat_str);
  const konum = extractLocationText($root);
  const tarih = extractDateText($root);
  const resim = extractImageUrl($root);
  const url = toAbsoluteUrl(href);

  if (!href || !baslik) return null;

  return {
    ilan_id,
    baslik,
    fiyat,
    fiyat_str,
    konum,
    tarih,
    url,
    resim,
    segment: segmentLabel,
  };
}

function addListingIfUnique(listings, seenKeys, listing) {
  if (!listing) return;

  const key = listing.ilan_id || listing.url;
  if (!key || seenKeys.has(key)) return;

  seenKeys.add(key);
  listings.push(listing);
}

function extractGenericContainers($) {
  const containers = [];
  const seen = new Set();
  const selectorChain = [
    'tr.searchResultsItem',
    'tr[class*="searchResultsItem"]',
    'article',
    'li',
    '[data-id]',
    '[data-listing-id]',
    '[class*="searchResult"]',
    '[class*="search-result"]',
    '[class*="listing"]',
    '[class*="Listing"]',
    'div',
    'section',
  ];

  $('a[href*="/ilan/"], a[data-href*="/ilan/"]').each((_, anchor) => {
    const $anchor = $(anchor);
    let $container = null;

    for (const selector of selectorChain) {
      const found = $anchor.closest(selector).first();
      if (found.length) {
        const textSize = cleanText(found.text()).length;
        if (textSize > 0 && textSize < 2000) {
          $container = found;
          break;
        }
      }
    }

    if (!$container || !$container.length) {
      $container = $anchor.parent();
    }

    const element = $container.get(0);
    if (!element) return;

    const html = $.html(element);
    if (!html || seen.has(html)) return;

    seen.add(html);
    containers.push($container);
  });

  return containers;
}

export function extractTotalCountFromHtml(html = '') {
  const $ = cheerio.load(html);
  const selectors = ['.result-text', '#searchResultsCount', '.searchResultCount', 'h1'];

  for (const selector of selectors) {
    const text = cleanText($(selector).first().text());
    for (const pattern of TOTAL_COUNT_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return parseInt(match[1].replace(/\./g, ''), 10);
      }
    }
  }

  const bodyText = cleanText($('body').text());
  for (const pattern of TOTAL_COUNT_PATTERNS) {
    const match = bodyText.match(pattern);
    if (match) {
      return parseInt(match[1].replace(/\./g, ''), 10);
    }
  }

  return 0;
}

export function hasLikelyListingSignals(html = '') {
  const lowered = String(html || '').toLowerCase();
  if (!lowered) return false;

  if (
    lowered.includes('searchresultsitem') ||
    lowered.includes('classifiedtitle') ||
    lowered.includes('searchresultspricevalue')
  ) {
    return true;
  }

  if (extractTotalCountFromHtml(html) > 0) {
    return true;
  }

  return parseListingPage(html).listings.length > 0;
}

// ─── Tek Sayfa Parse ─────────────────────────────────────────
export function parseListingPage(html, segmentLabel = '') {
  const $ = cheerio.load(html);
  const listings = [];
  const totalCount = extractTotalCountFromHtml(html);
  const seenKeys = new Set();

  // İlan satırlarını parse et
  $('tr.searchResultsItem, tr[class*="searchResultsItem"]').each((_, row) => {
    const $container = $(row);
    const classes = ($container.attr('class') || '').split(/\s+/);

    // Reklam ve promosyon ilanlarını atla
    const skipClasses = ['nativeAd', 'searchResultsPromoSuper', 'searchResultsPromoHighlight'];
    if (skipClasses.some(c => classes.includes(c))) return;

    addListingIfUnique(listings, seenKeys, extractListingFromContainer($container, segmentLabel));
  });

  // Yeni kart/list/grid DOM yapılarında klasik tablo satırı olmayabiliyor.
  for (const $container of extractGenericContainers($)) {
    addListingIfUnique(listings, seenKeys, extractListingFromContainer($container, segmentLabel));
  }

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
