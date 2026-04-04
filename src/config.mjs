/**
 * ═══════════════════════════════════════════════════════════════
 *  CONFIG.MJS — Tek Gerçek Kaynak (Single Source of Truth)
 *  Tüm ayarlar, API anahtarları ve sabitler burada tanımlanır.
 * ═══════════════════════════════════════════════════════════════
 */
import 'dotenv/config';

// ─── ScrapeOps API Key Rotasyonu ─────────────────────────────
const rawKeys = (process.env.SCRAPEOPS_API_KEYS || process.env.SCRAPEOPS_API_KEY || '').trim();
const SCRAPEOPS_KEYS = rawKeys.split(',').map(k => k.trim()).filter(Boolean);
if (SCRAPEOPS_KEYS.length === 0) {
  console.error('❌ SCRAPEOPS_API_KEYS tanımlı değil! GitHub Secrets kontrol edin.');
  process.exit(1);
}

let _keyIndex = 0;
export function getNextKey() {
  const key = SCRAPEOPS_KEYS[_keyIndex % SCRAPEOPS_KEYS.length];
  _keyIndex++;
  return key;
}
export function resetKeyIndex() { _keyIndex = 0; }

// ─── Session Numarası (Her çalışmada benzersiz) ─────────────
export const SESSION_NUMBER = Math.floor(10000 + Math.random() * 90000);

// ─── Telegram ────────────────────────────────────────────────
export const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// ─── AI Provider ─────────────────────────────────────────────
export const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// ─── Sahibinden Ayarları ─────────────────────────────────────
export const BASE_URL = 'https://www.sahibinden.com/ekran-karti-masaustu';
export const ITEMS_PER_PAGE = 50;
export const MAX_PAGES_PER_SEGMENT = 20;

// ─── Performans Ayarları ─────────────────────────────────────
export const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT || '5', 10);
export const REQUEST_DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || '800', 10);
export const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '4', 10);
export const RETRY_BASE_DELAY_MS = 2000;

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
export const BYPASS_AI = (process.env.BYPASS_AI || 'false').toLowerCase() === 'true';

/**
 * Aktif fiyat segmentlerini döndürür.
 * Eğer CUSTOM_MIN/MAX ayarlandıysa, sadece ilgili aralığı filtreler.
 */
export function getActiveSegments() {
  if (CUSTOM_MIN_PRICE !== null || CUSTOM_MAX_PRICE !== null) {
    const min = CUSTOM_MIN_PRICE ?? 0;
    const max = CUSTOM_MAX_PRICE ?? 1000000;
    return PRICE_SEGMENTS.filter(([lo, hi]) => hi > min && lo < max);
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
  CONCURRENCY_LIMIT,
  REQUEST_DELAY_MS,
  MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  PRICE_SEGMENTS,
  AI_CHUNK_SIZE,
  AI_DELAY_BETWEEN_CHUNKS_MS,
  AI_TOP_RESULTS,
  getNextKey,
  getActiveSegments,
};
