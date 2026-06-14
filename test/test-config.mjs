/**
 * CONFIG.MJS — Tek Gerçek Kaynak
 * WARP + Cookie odakli calisma
 */
import 'dotenv/config';

// ─── ScrapeOps Ayarlari (opsiyonel) ──────────────────────────
export const SCRAPEOPS_API_KEY =
  process.env.SCRAPEOPS_API_KEY ||
  process.env.SCRAPEOPS_API_KEY_1 ||
  process.env.SCRAPEOPS_API_KEY_2 ||
  '';
export const MAX_CREDITS_PER_RUN = parseInt(process.env.MAX_CREDITS_PER_RUN || '1000', 10); // 5000+ ilan hedefi icin sayfa butcesi.
const USE_SCRAPEDO_PROXY = (process.env.USE_SCRAPEDO_PROXY || 'false').toLowerCase() === 'true';

if (USE_SCRAPEDO_PROXY && !SCRAPEOPS_API_KEY) {
  console.log('❌ SCRAPEOPS API KEY EKSİK!');
  process.exit(1);
}

// ─── Session ─────────────────────────────────────────────────
export const SESSION_NUMBER = Math.floor(10000 + Math.random() * 90000);

// ─── Telegram ────────────────────────────────────────────────
export const TELEGRAM_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN_1 ||
  process.env.TELEGRAM_BOT_TOKEN_2 ||
  '';
export const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID ||
  '-5083436032';
export const ENABLE_TELEGRAM = (process.env.ENABLE_TELEGRAM || 'false').toLowerCase() === 'true';

export const ANALYZER_DISPATCH_TOKEN = process.env.ANALYZER_DISPATCH_TOKEN || '';
export const ANALYZER_REPO_OWNER = process.env.ANALYZER_REPO_OWNER || 'univerisr-ai';
export const ANALYZER_REPO_NAME = process.env.ANALYZER_REPO_NAME || '2elAnaliz';
export const ANALYZER_DISPATCH_EVENT = process.env.ANALYZER_DISPATCH_EVENT || 'telegram_file_ready';

// ─── AI ──────────────────────────────────────────────────────
export const AI_PROVIDER = (process.env.AI_PROVIDER_SECRET || process.env.AI_PROVIDER || 'gemini').toLowerCase();
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-flash-1.5';
export const AI_CHUNK_SIZE = 100;
export const AI_DELAY_BETWEEN_CHUNKS_MS = 2000;
export const AI_TOP_RESULTS = 5;

// ─── Urun Profilleri ─────────────────────────────────────────
// GPU varsayilan kalir; CPU ayri workflow/env ile ayni motoru kullanir.
const GPU_PRICE_SEGMENTS = [
  [0,       500],
  [500,     1000],
  [1000,    1500],
  [1500,    2000],
  [2000,    2500],
  [2500,    3000],
  [3000,    3500],
  [3500,    4000],
  [4000,    4500],
  [4500,    5000],
  [5000,    5500],
  [5500,    6000],
  [6000,    6500],
  [6500,    7000],
  [7000,    7500],
  [7500,    8000],
  [8000,    8500],
  [8500,    9000],
  [9000,    9500],
  [9500,    10000],
  [10000,   11000],
  [11000,   12000],
  [12000,   13000],
  [13000,   14000],
  [14000,   15000],
  [15000,   16000],
  [16000,   17000],
  [17000,   18000],
  [18000,   19000],
  [19000,   20000],
  [20000,   22500],
  [22500,   25000],
  [25000,   27500],
  [27500,   30000],
  [30000,   35000],
  [35000,   40000],
  [40000,   45000],
  [45000,   50000],
  [50000,   60000],
  [60000,   70000],
  [70000,   80000],
  [80000,   90000],
  [90000,   120000],
  [120000,  999000],
];

const CPU_PRICE_SEGMENTS = [
  [0,       250],
  [250,     500],
  [500,     750],
  [750,     1000],
  [1000,    1250],
  [1250,    1500],
  [1500,    1750],
  [1750,    2000],
  [2000,    2250],
  [2250,    2500],
  [2500,    2750],
  [2750,    3000],
  [3000,    3250],
  [3250,    3500],
  [3500,    3750],
  [3750,    4000],
  [4000,    4500],
  [4500,    5000],
  [5000,    5500],
  [5500,    6000],
  [6000,    7000],
  [7000,    8000],
  [8000,    9000],
  [9000,    10000],
  [10000,   12000],
  [12000,   15000],
  [15000,   20000],
  [20000,   30000],
  [30000,   50000],
  [50000,   999000],
];

export const PRODUCT_PROFILES = {
  gpu: {
    type: 'gpu',
    label: 'Ekran Karti',
    reportTitle: 'EKRAN KARTI FIRSAT RAPORU',
    bannerTitle: 'SAHIBINDEN GPU FIRSAT AVCISI',
    baseUrl: 'https://www.sahibinden.com/ekran-karti-masaustu',
    priceSegments: GPU_PRICE_SEGMENTS,
    warmupPriceMax: 2000,
    artifactPrefix: 'scraper-results',
  },
  cpu: {
    type: 'cpu',
    label: 'Islemci',
    reportTitle: 'ISLEMCI FIRSAT RAPORU',
    bannerTitle: 'SAHIBINDEN CPU FIRSAT AVCISI',
    baseUrl: 'https://www.sahibinden.com/islemci-masaustu',
    priceSegments: CPU_PRICE_SEGMENTS,
    warmupPriceMax: 1500,
    artifactPrefix: 'scraper-results-cpu',
  },
};

function normalizeProductType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.hasOwn(PRODUCT_PROFILES, normalized) ? normalized : 'gpu';
}

export const PRODUCT_TYPE = normalizeProductType(
  process.env.SAHIBINDEN_PRODUCT_TYPE || process.env.PRODUCT_TYPE || 'gpu',
);
export const PRODUCT_PROFILE = PRODUCT_PROFILES[PRODUCT_TYPE];
export const PRODUCT_LABEL = PRODUCT_PROFILE.label;
export const PRODUCT_REPORT_TITLE = PRODUCT_PROFILE.reportTitle;
export const PRODUCT_BANNER_TITLE = PRODUCT_PROFILE.bannerTitle;
export const PRODUCT_ARTIFACT_PREFIX = PRODUCT_PROFILE.artifactPrefix;
export const WARMUP_PRICE_MAX = PRODUCT_PROFILE.warmupPriceMax;

// ─── Sahibinden ──────────────────────────────────────────────
export const BASE_URL = process.env.SAHIBINDEN_BASE_URL || PRODUCT_PROFILE.baseUrl;
export const ITEMS_PER_PAGE = 50;
export const MAX_PAGES_PER_SEGMENT = parseInt(process.env.MAX_PAGES_PER_SEGMENT || '40', 10); // 5000+ ilan hedefi icin segment basina daha derin tarama.

// ─── Performans ──────────────────────────────────────────────
export const CONCURRENCY_LIMIT = 1;
export const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '2', 10);
export const REQUEST_DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || '700', 10);
export const PARALLEL_PAGES = Math.max(1, parseInt(process.env.PARALLEL_PAGES || '10', 10));

// ─── Fiyat Segmentleri (TL) ─────────────────────────────────
// Yogun fiyat araliklarini bolerek Sahibinden sayfa tavanina takilmamayi hedefler.
export const PRICE_SEGMENTS = PRODUCT_PROFILE.priceSegments;

// ─── Workflow Dispatch ───────────────────────────────────────
export const CUSTOM_MIN_PRICE = process.env.CUSTOM_MIN_PRICE ? parseInt(process.env.CUSTOM_MIN_PRICE) : null;
export const CUSTOM_MAX_PRICE = process.env.CUSTOM_MAX_PRICE ? parseInt(process.env.CUSTOM_MAX_PRICE) : null;
export const BYPASS_AI = (process.env.BYPASS_AI || 'true').toLowerCase() === 'true';

export function getActiveSegments() {
  if (CUSTOM_MIN_PRICE !== null || CUSTOM_MAX_PRICE !== null) {
    const min = CUSTOM_MIN_PRICE ?? 0;
    const max = CUSTOM_MAX_PRICE ?? 1000000;
    return PRICE_SEGMENTS
      .filter(([lo, hi]) => hi > min && lo < max)
      .map(([lo, hi]) => [Math.max(lo, min), Math.min(hi, max)]);
  }
  return PRICE_SEGMENTS;
}
