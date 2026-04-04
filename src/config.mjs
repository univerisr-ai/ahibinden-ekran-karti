/**
 * ═══════════════════════════════════════════════════════════════
 *  CONFIG.MJS — Tek Gerçek Kaynak (Single Source of Truth)
 *  Tüm ayarlar, API anahtarları ve sabitler burada tanımlanır.
 * ═══════════════════════════════════════════════════════════════
 */
import 'dotenv/config';

// ─── ScrapeOps API Key Rotasyonu ─────────────────────────────
const rawKeys = (process.env.SCRAPEOPS_API_KEYS || process.env.SCRAPEOPS_API_KEY || '').trim();
export const SCRAPEOPS_KEYS = rawKeys.split(',').map(k => k.trim()).filter(Boolean);
if (SCRAPEOPS_KEYS.length === 0) {
  console.error('❌ SCRAPEOPS_API_KEYS tanımlı değil! GitHub Secrets kontrol edin.');
  process.exit(1);
}

// ─── Session Numarası (Her çalışmada benzersiz) ─────────────
export const SESSION_NUMBER = Math.floor(10000 + Math.random() * 90000);

// ─── Telegram ────────────────────────────────────────────────
export const TELEGRAM_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN_1 ||
  process.env.TELEGRAM_BOT_TOKEN_2 ||
  '';
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// ─── AI Provider ─────────────────────────────────────────────
export const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// ─── Sahibinden Ayarları ─────────────────────────────────────
export const BASE_URL = 'https://www.sahibinden.com/ekran-karti-masaustu';
export const ITEMS_PER_PAGE = 50;
export const MAX_PAGES_PER_SEGMENT = parseInt(process.env.MAX_PAGES_PER_SEGMENT || '8', 10);

// ─── ScrapeOps Proxy (Proxy-Only Mod) ───────────────────────
export const SCRAPEOPS_PROXY_SCHEME = process.env.SCRAPEOPS_PROXY_SCHEME || 'http';
export const SCRAPEOPS_PROXY_HOST = process.env.SCRAPEOPS_PROXY_HOST || 'proxy.scrapeops.io';
export const SCRAPEOPS_PROXY_PORT = parseInt(process.env.SCRAPEOPS_PROXY_PORT || '5353', 10);
export const SCRAPEOPS_PROXY_USER = process.env.SCRAPEOPS_PROXY_USER || 'scrapeops';

// ─── Performans Ayarları ─────────────────────────────────────
export const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT || '1', 10);
export const REQUEST_DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || '800', 10);
// Her sayfa istegi: sadece 1 deneme, hata olursa kosu durur.
export const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '1', 10);
export const RETRY_BASE_DELAY_MS = 2000;
export const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '45000', 10);

// ─── Bütçe / Hedef Ayarları ──────────────────────────────────
// 2500 ilan hedefi için yaklaşık 50 sayfa gerekir (50 ilan/sayfa).
export const TARGET_LISTINGS_PER_RUN = parseInt(process.env.TARGET_LISTINGS_PER_RUN || '2500', 10);
export const MAX_REQUESTS_PER_RUN = parseInt(process.env.MAX_REQUESTS_PER_RUN || '55', 10);
export const PROXY_CREDIT_PER_REQUEST = parseFloat(process.env.PROXY_CREDIT_PER_REQUEST || '1');

// ─── Fiyat Segmentleri (TL) ─────────────────────────────────
// Sahibinden sorgu başına max 1000 ilan gösterir.
// 14 segment × 1000 = 14.000 ilan kapasitesi.
export const PRICE_SEGMENTS = [
  [0,       1500],
  [1500,    3000],
  [3000,    5000],
  [5000,    7500],
  [7500,    10000],
  [10000,   15000],
  [15000,   20000],
  [20000,   30000],
  [30000,   50000],
  [50000,   75000],
  [75000,   100000],
  [100000,  150000],
  [150000,  300000],
  [300000,  1000000],
];

// ─── AI Chunk Ayarları ───────────────────────────────────────
export const AI_CHUNK_SIZE = 100;           // Her AI isteğine kaç ilan
export const AI_DELAY_BETWEEN_CHUNKS_MS = 2000;  // Chunk arası bekleme
export const AI_TOP_RESULTS = 5;            // Rapordaki en iyi ilan sayısı

// ─── Workflow Dispatch Parametreleri ─────────────────────────
// GitHub Actions'tan opsiyonel olarak geçilebilir
export const CUSTOM_MIN_PRICE = process.env.CUSTOM_MIN_PRICE ? parseInt(process.env.CUSTOM_MIN_PRICE) : null;
export const CUSTOM_MAX_PRICE = process.env.CUSTOM_MAX_PRICE ? parseInt(process.env.CUSTOM_MAX_PRICE) : null;
export const BYPASS_AI = (process.env.BYPASS_AI || 'true').toLowerCase() === 'true';

/**
 * Aktif fiyat segmentlerini döndürür.
 * Eğer CUSTOM_MIN/MAX ayarlandıysa, sadece ilgili aralığı filtreler.
 */
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

export default {
  SCRAPEOPS_KEYS,
  SESSION_NUMBER,
  TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID,
  AI_PROVIDER,
  GEMINI_API_KEY,
  OPENROUTER_API_KEY,
  BASE_URL,
  ITEMS_PER_PAGE,
  MAX_PAGES_PER_SEGMENT,
  SCRAPEOPS_PROXY_SCHEME,
  SCRAPEOPS_PROXY_HOST,
  SCRAPEOPS_PROXY_PORT,
  SCRAPEOPS_PROXY_USER,
  CONCURRENCY_LIMIT,
  REQUEST_DELAY_MS,
  MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  TARGET_LISTINGS_PER_RUN,
  MAX_REQUESTS_PER_RUN,
  PROXY_CREDIT_PER_REQUEST,
  PRICE_SEGMENTS,
  AI_CHUNK_SIZE,
  AI_DELAY_BETWEEN_CHUNKS_MS,
  AI_TOP_RESULTS,
  getActiveSegments,
};
