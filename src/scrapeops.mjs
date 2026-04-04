/**
 * Hybrid scraping layer.
 * Supports ScrapeOps proxy tunnel, API endpoint, or auto fallback mode.
 */
import { ProxyAgent } from 'undici';
import {
  SCRAPEOPS_KEYS,
  SESSION_NUMBER,
  SCRAPEOPS_PROXY_SCHEME,
  SCRAPEOPS_PROXY_HOST,
  SCRAPEOPS_PROXY_PORT,
  SCRAPEOPS_PROXY_USER,
  SCRAPEOPS_TRANSPORT_MODE,
  SCRAPEOPS_API_ENDPOINT,
  SCRAPEOPS_API_BYPASS,
  SCRAPEOPS_API_RENDER_JS,
  SCRAPEOPS_API_RESIDENTIAL,
  SCRAPEOPS_API_WAIT_MS,
  SCRAPEOPS_API_CREDIT_PER_REQUEST,
  SCRAPEOPS_UNLOCK_BYPASS,
  SCRAPEOPS_UNLOCK_RENDER_JS,
  SCRAPEOPS_UNLOCK_RESIDENTIAL,
  SCRAPEOPS_UNLOCK_WAIT_MS,
  SCRAPEOPS_UNLOCK_CREDIT_COST,
  REQUEST_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  ITEMS_PER_PAGE,
  BASE_URL,
  MAX_PAGES_PER_SEGMENT,
  MAX_REQUESTS_PER_RUN,
  PROXY_CREDIT_PER_REQUEST,
} from './config.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const proxyAgentCache = new Map();
const exhaustedKeys = new Set();
let keyCursor = 0;
let currentKey = null;
let apiSessionPrimed = false;

let stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  estimatedCredits: 0,
  keyRotations: 0,
  exhaustedKeyCount: 0,
  blockedResponses: 0,
  budgetStopped: false,
  allKeysExhausted: false,
  runHalted: false,
  haltReason: '',
};

export function getStats() {
  return { ...stats };
}

export function getRemainingRequestBudget() {
  return Math.max(0, MAX_REQUESTS_PER_RUN - stats.totalRequests);
}

export function isRequestBudgetExhausted() {
  return stats.budgetStopped || stats.totalRequests >= MAX_REQUESTS_PER_RUN;
}

export function isRunHalted() {
  return !!stats.runHalted;
}

function getTransportMode() {
  const mode = (SCRAPEOPS_TRANSPORT_MODE || 'api').toLowerCase();
  if (mode === 'proxy' || mode === 'api' || mode === 'auto') {
    return mode;
  }
  return 'api';
}

function buildProxyUrlForKey(key) {
  return `${SCRAPEOPS_PROXY_SCHEME}://${SCRAPEOPS_PROXY_USER}:${encodeURIComponent(key)}@${SCRAPEOPS_PROXY_HOST}:${SCRAPEOPS_PROXY_PORT}`;
}

function getProxyAgent(key) {
  if (!proxyAgentCache.has(key)) {
    proxyAgentCache.set(key, new ProxyAgent(buildProxyUrlForKey(key)));
  }
  return proxyAgentCache.get(key);
}

function buildApiUrlForKey(key, targetUrl, unlock = false) {
  const url = new URL(SCRAPEOPS_API_ENDPOINT);
  url.searchParams.set('api_key', key);
  url.searchParams.set('url', targetUrl);
  url.searchParams.set('session_number', String(SESSION_NUMBER));

  const bypass = unlock ? SCRAPEOPS_UNLOCK_BYPASS : SCRAPEOPS_API_BYPASS;
  const renderJs = unlock ? SCRAPEOPS_UNLOCK_RENDER_JS : SCRAPEOPS_API_RENDER_JS;
  const residential = unlock ? SCRAPEOPS_UNLOCK_RESIDENTIAL : SCRAPEOPS_API_RESIDENTIAL;
  const waitMs = unlock ? SCRAPEOPS_UNLOCK_WAIT_MS : SCRAPEOPS_API_WAIT_MS;

  if (bypass) {
    url.searchParams.set('bypass', bypass);
  }
  if (renderJs) {
    url.searchParams.set('render_js', 'true');
  }
  if (residential) {
    url.searchParams.set('residential', 'true');
  }
  if (waitMs > 0) {
    url.searchParams.set('wait', String(waitMs));
  }

  return url.toString();
}

function findNextAvailableKey(excludeKey = null) {
  if (exhaustedKeys.size >= SCRAPEOPS_KEYS.length) {
    return null;
  }

  for (let i = 0; i < SCRAPEOPS_KEYS.length; i++) {
    const idx = (keyCursor + i) % SCRAPEOPS_KEYS.length;
    const key = SCRAPEOPS_KEYS[idx];
    if (exhaustedKeys.has(key)) {
      continue;
    }
    if (
      excludeKey &&
      key === excludeKey &&
      exhaustedKeys.size < SCRAPEOPS_KEYS.length - 1
    ) {
      continue;
    }

    keyCursor = (idx + 1) % SCRAPEOPS_KEYS.length;
    return key;
  }

  // If only one active key remains, allow returning the excluded one as fallback.
  for (let i = 0; i < SCRAPEOPS_KEYS.length; i++) {
    const idx = (keyCursor + i) % SCRAPEOPS_KEYS.length;
    const key = SCRAPEOPS_KEYS[idx];
    if (!exhaustedKeys.has(key)) {
      keyCursor = (idx + 1) % SCRAPEOPS_KEYS.length;
      return key;
    }
  }

  return null;
}

function getActiveKey() {
  if (currentKey && !exhaustedKeys.has(currentKey)) {
    return currentKey;
  }

  currentKey = findNextAvailableKey();
  return currentKey;
}

function isChallengeHtml(html = '') {
  const body = html.toLowerCase();
  return (
    body.includes('just a moment') ||
    body.includes('challenge-platform') ||
    body.includes('cf-chl') ||
    body.includes('error 1020') ||
    body.includes('attention required')
  );
}

function tryParseJson(text = '') {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isScrapeOpsKeyFailure(status, bodyText = '') {
  if (status === 401 || status === 407) {
    return true;
  }

  if (![402, 403, 429].includes(status)) {
    return false;
  }

  const asJson = tryParseJson(bodyText);
  const normalizedJson = asJson ? JSON.stringify(asJson).toLowerCase() : '';
  const normalizedText = (bodyText || '').toLowerCase();
  const text = `${normalizedJson} ${normalizedText}`;

  const keyHints = ['api key', 'quota', 'credit', 'invalid key', 'subscription', 'confirm your email'];
  const sourceHints = ['scrapeops', 'proxy authentication', 'proxy api'];

  const hasKeyHint = keyHints.some((hint) => text.includes(hint));
  const hasSourceHint = sourceHints.some((hint) => text.includes(hint)) || text.includes('api key');

  return hasKeyHint && hasSourceHint;
}

function isRecoverableBlock(status, bodyText = '') {
  if ([403, 429].includes(status)) {
    return true;
  }

  if (status >= 500) {
    return true;
  }

  return isChallengeHtml(bodyText);
}

function parseTotalCount(html = '') {
  const match = html.match(/([\d.]{1,9})\s*ilan/i);
  if (!match) {
    return 0;
  }
  return parseInt(match[1].replace(/\./g, ''), 10) || 0;
}

function markBudgetStop(label = '') {
  if (!stats.budgetStopped) {
    const suffix = label ? ` [${label}]` : '';
    console.log(`  ⛔ İstek limiti doldu${suffix}. Koşu kontrollü şekilde sonlandırılıyor.`);
  }
  stats.budgetStopped = true;
}

function haltRun(reason = '') {
  if (!stats.runHalted) {
    console.log(`  ⛔ Tek deneme modu: ${reason}. Koşu durduruluyor.`);
  }
  stats.runHalted = true;
  stats.haltReason = reason;
}

function markKeyExhausted(key) {
  exhaustedKeys.add(key);
  stats.exhaustedKeyCount = exhaustedKeys.size;
  stats.allKeysExhausted = exhaustedKeys.size >= SCRAPEOPS_KEYS.length;
}

export function buildSahibindenUrl(offset, priceMin, priceMax) {
  const url = new URL(BASE_URL);
  url.searchParams.set('pagingOffset', String(offset));
  url.searchParams.set('pagingSize', String(ITEMS_PER_PAGE));
  url.searchParams.set('sorting', 'date_desc');

  if (priceMin !== undefined && priceMin !== null) {
    url.searchParams.set('price_min', String(priceMin));
  }
  if (priceMax !== undefined && priceMax !== null) {
    url.searchParams.set('price_max', String(priceMax));
  }

  return url.toString();
}

async function fetchViaProxy(targetUrl, label = '') {
  if (isRequestBudgetExhausted()) {
    markBudgetStop(label);
    return null;
  }

  if (isRunHalted()) {
    return null;
  }

  const activeKey = getActiveKey();
  if (!activeKey) {
    stats.allKeysExhausted = true;
    haltRun(`${label} icin aktif key bulunamadi`);
    return null;
  }

  const transportMode = getTransportMode();
  if (transportMode === 'api') {
    return fetchViaApi(targetUrl, label, activeKey, { unlock: false, haltOnFailure: true });
  }

  stats.totalRequests += 1;
  stats.estimatedCredits += PROXY_CREDIT_PER_REQUEST;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      dispatcher: getProxyAgent(activeKey),
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
      },
    });

    const bodyText = await response.text();

    if (response.ok && !isChallengeHtml(bodyText)) {
      stats.successfulRequests += 1;
      return bodyText;
    }

    stats.failedRequests += 1;

    if (response.ok && isChallengeHtml(bodyText)) {
      stats.blockedResponses += 1;
      haltRun(`${label} challenge (200) dondu`);
      return null;
    }

    if (isScrapeOpsKeyFailure(response.status, bodyText)) {
      markKeyExhausted(activeKey);
      haltRun(`${label} proxy key reddedildi (HTTP ${response.status})`);
      return null;
    }

    if (isRecoverableBlock(response.status, bodyText)) {
      stats.blockedResponses += 1;
      haltRun(`${label} HTTP ${response.status} blok`);
      return null;
    }

    haltRun(`${label} HTTP ${response.status}`);
    return null;
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'zaman asimi' : (err?.message || 'bilinmeyen hata');
    if (transportMode === 'auto') {
      console.log(`  ↪️ Proxy baglanti hatasi [${label}] (${reason}) -> API fallback deneniyor.`);
      return fetchViaApi(targetUrl, label, activeKey, { unlock: false, haltOnFailure: true });
    }

    stats.failedRequests += 1;
    haltRun(`${label} hata: ${reason}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaApi(targetUrl, label, activeKey, { unlock = false, haltOnFailure = true } = {}) {
  const cost = unlock ? SCRAPEOPS_UNLOCK_CREDIT_COST : SCRAPEOPS_API_CREDIT_PER_REQUEST;
  stats.totalRequests += 1;
  stats.estimatedCredits += cost;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildApiUrlForKey(activeKey, targetUrl, unlock), {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
      },
    });

    const bodyText = await response.text();

    if (response.ok && !isChallengeHtml(bodyText)) {
      stats.successfulRequests += 1;
      if (unlock) {
        apiSessionPrimed = true;
      }
      return bodyText;
    }

    stats.failedRequests += 1;

    if (response.ok && isChallengeHtml(bodyText)) {
      stats.blockedResponses += 1;
      const reason = `${label} API challenge (200) dondu`;
      if (haltOnFailure) haltRun(reason);
      else console.log(`  ⚠️ ${reason}`);
      return null;
    }

    if (isScrapeOpsKeyFailure(response.status, bodyText)) {
      markKeyExhausted(activeKey);
      const reason = `${label} API key reddedildi (HTTP ${response.status})`;
      if (haltOnFailure) haltRun(reason);
      else console.log(`  ⚠️ ${reason}`);
      return null;
    }

    if (isRecoverableBlock(response.status, bodyText)) {
      stats.blockedResponses += 1;
      const reason = `${label} API HTTP ${response.status} blok`;
      if (haltOnFailure) haltRun(reason);
      else console.log(`  ⚠️ ${reason}`);
      return null;
    }

    const reason = `${label} API HTTP ${response.status}`;
    if (haltOnFailure) haltRun(reason);
    else console.log(`  ⚠️ ${reason}`);
    return null;
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'zaman asimi' : (err?.message || 'bilinmeyen hata');
    stats.failedRequests += 1;
    const full = `${label} API hata: ${reason}`;
    if (haltOnFailure) haltRun(full);
    else console.log(`  ⚠️ ${full}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function scrapeSegment(priceMin, priceMax, dynamicSplit = true) {
  const label = `${priceMin.toLocaleString('tr')}-${priceMax.toLocaleString('tr')} TL`;
  console.log(`\n  📦 Segment: ${label}`);

  const firstUrl = buildSahibindenUrl(0, priceMin, priceMax);
  const firstHtml = await fetchViaProxy(firstUrl, `${label} (Sayfa 1)`);

  if (!firstHtml) {
    console.log(`  ❌ ${label}: İlk sayfa alınamadı, segment atlanıyor.`);
    return { htmlPages: [], totalFound: 0, pages: 0 };
  }

  const htmlPages = [firstHtml];
  const totalCount = parseTotalCount(firstHtml);

  const canSplit =
    dynamicSplit &&
    totalCount >= 950 &&
    (priceMax - priceMin) >= 800 &&
    getRemainingRequestBudget() > 4;

  if (canSplit) {
    const mid = Math.floor((priceMin + priceMax) / 2);
    if (mid > priceMin && mid < priceMax) {
      console.log(`  🔀 LIMIT YAKLAŞTI: ${label} iki alt segmente bölünüyor.`);
      const left = await scrapeSegment(priceMin, mid, true);
      const right = await scrapeSegment(mid, priceMax, true);
      return {
        htmlPages: [...left.htmlPages, ...right.htmlPages],
        totalFound: left.totalFound + right.totalFound,
        pages: left.pages + right.pages,
      };
    }
  }

  const discoveredPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
  const maxByBudget = 1 + getRemainingRequestBudget();
  const totalPages = Math.max(1, Math.min(discoveredPages, MAX_PAGES_PER_SEGMENT, maxByBudget));

  console.log(
    `  📊 ${label}: ${totalCount.toLocaleString('tr')} ilan, planlanan ${totalPages} sayfa (kalan istek bütçesi: ${getRemainingRequestBudget()})`
  );

  for (let page = 1; page < totalPages; page++) {
    if (isRequestBudgetExhausted()) {
      markBudgetStop(`${label} (Sayfa ${page + 1})`);
      break;
    }

    await sleep(REQUEST_DELAY_MS);
    const offset = page * ITEMS_PER_PAGE;
    const pageUrl = buildSahibindenUrl(offset, priceMin, priceMax);
    const html = await fetchViaProxy(pageUrl, `${label} (Sayfa ${page + 1})`);

    if (!html) {
      break;
    }

    htmlPages.push(html);
  }

  console.log(`  ✅ ${label}: Toplam ${htmlPages.length} sayfa çekildi`);
  return {
    htmlPages,
    totalFound: totalCount,
    pages: htmlPages.length,
  };
}

export async function initSession() {
  const mode = getTransportMode();
  if (mode === 'proxy') {
    return 'PROXY_ONLY_MODE';
  }

  const key = getActiveKey();
  if (!key) {
    stats.allKeysExhausted = true;
    if (mode === 'api') {
      return null;
    }
    return 'AUTO_MODE_NO_KEY';
  }

  const primeLabel = 'API unlock';
  const unlockHtml = await fetchViaApi(BASE_URL, primeLabel, key, {
    unlock: true,
    haltOnFailure: mode === 'api',
  });

  if (unlockHtml) {
    console.log('  🔓 API session primed (tek sefer pahali unlock tamamlandi).');
    apiSessionPrimed = true;
    return 'API_SESSION_PRIMED';
  }

  if (mode === 'api') {
    return null;
  }

  console.log('  ⚠️ API unlock basarisiz, auto mod proxy ile devam edecek.');
  return 'AUTO_MODE_FALLBACK';
}

export default {
  initSession,
  scrapeSegment,
  buildSahibindenUrl,
  getStats,
  getRemainingRequestBudget,
  isRequestBudgetExhausted,
};
