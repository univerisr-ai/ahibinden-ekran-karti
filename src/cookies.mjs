import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_COOKIES_FILE = 'cookies.json';

function normalizeCookieValue(value) {
  if (typeof value !== 'string') return String(value ?? '');
  const s = value.trim();
  if (s.startsWith("b'") && s.endsWith("'")) return s.slice(2, -1);
  if (s.startsWith('b"') && s.endsWith('"')) return s.slice(2, -1);
  return s;
}

function isSahibindenCookie(cookie) {
  if (!cookie || typeof cookie !== 'object') return false;
  const domain = String(cookie.domain || '').toLowerCase();
  const url = String(cookie.url || '').toLowerCase();
  return (
    domain.includes('sahibinden.com') ||
    domain.includes('shbdn.com') ||
    url.includes('sahibinden.com') ||
    url.includes('shbdn.com')
  );
}

function normalizeCookie(cookie) {
  const normalized = {
    name: String(cookie.name || ''),
    value: normalizeCookieValue(cookie.value),
    domain: cookie.domain,
    path: cookie.path || '/',
  };

  if (cookie.expires !== undefined && cookie.expires !== null && cookie.expires !== '') {
    const expiresNum = Number(cookie.expires);
    if (Number.isFinite(expiresNum)) normalized.expires = Math.floor(expiresNum);
  }
  if (typeof cookie.httpOnly === 'boolean') normalized.httpOnly = cookie.httpOnly;
  if (typeof cookie.secure === 'boolean') normalized.secure = cookie.secure;
  if (typeof cookie.sameSite === 'string') normalized.sameSite = cookie.sameSite;

  return normalized;
}

export function loadCookiesFromEnv() {
  const raw = String(process.env.SAHIBINDEN_COOKIES || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.log('  SAHIBINDEN_COOKIES array formatinda degil.');
      return [];
    }
    return parsed
      .filter((c) => c && typeof c === 'object' && typeof c.name === 'string' && typeof c.value !== 'undefined')
      .map(normalizeCookie)
      .filter((c) => c.name && c.value && isSahibindenCookie(c));
  } catch (err) {
    console.log(`  SAHIBINDEN_COOKIES parse hatasi: ${err.message}`);
    return [];
  }
}

export function loadCookiesFromFile(filePath) {
  const path = filePath ? resolve(process.cwd(), filePath) : resolve(process.cwd(), DEFAULT_COOKIES_FILE);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.log(`  ${path} array formatinda degil.`);
      return [];
    }
    return parsed
      .filter((c) => c && typeof c === 'object' && typeof c.name === 'string' && typeof c.value !== 'undefined')
      .map(normalizeCookie)
      .filter((c) => c.name && c.value && isSahibindenCookie(c));
  } catch (err) {
    console.log(`  ${path} okunurken hata: ${err.message}`);
    return [];
  }
}

export function loadAllSahibindenCookies(options = {}) {
  const envCookies = loadCookiesFromEnv();
  const fileCookies = loadCookiesFromFile(options.cookiesFile);
  const all = [...envCookies, ...fileCookies];

  // Ayni name+domain ikililerini son degerle birlestir.
  const map = new Map();
  for (const c of all) {
    const key = `${c.name}|${c.domain || ''}|${c.path || '/'}`;
    map.set(key, c);
  }
  return Array.from(map.values());
}
