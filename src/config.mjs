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
export const MAX_CREDITS_PER_RUN = 300; // Güvenlik limiti
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
  '';

// ─── AI ──────────────────────────────────────────────────────
export const AI_PROVIDER = (process.env.AI_PROVIDER_SECRET || process.env.AI_PROVIDER || 'gemini').toLowerCase();
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-flash-1.5';
export const AI_CHUNK_SIZE = 100;
export const AI_DELAY_BETWEEN_CHUNKS_MS = 2000;
export const AI_TOP_RESULTS = 5;

// ─── Sahibinden ──────────────────────────────────────────────
export const BASE_URL = 'https://www.sahibinden.com/ekran-karti-masaustu';
export const ITEMS_PER_PAGE = 50;
export const MAX_PAGES_PER_SEGMENT = parseInt(process.env.MAX_PAGES_PER_SEGMENT || '20', 10); // Segment başına 20 sayfa = 1000 ilan x 10 segment = 10000 ilan kapasitesi.

// ─── Performans ──────────────────────────────────────────────
export const CONCURRENCY_LIMIT = 1;
export const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '2', 10);
export const REQUEST_DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || '700', 10);

// ─── Fiyat Segmentleri (TL) ─────────────────────────────────
// Daha optimize edilmiş 10 segment
export const PRICE_SEGMENTS = [
  [0,       2000],
  [2000,    4000],
  [4000,    6000],
  [6000,    9000],
  [9000,    14000],
  [14000,   20000],
  [20000,   30000],
  [30000,   50000],
  [50000,   90000],
  [90000,   999000],
];

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
