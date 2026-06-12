import fs from 'fs';

export const STORAGE_STATE_ENV_VAR = 'SAHIBINDEN_STORAGE_STATE';
export const STORAGE_STATE_B64_ENV_VAR = 'SAHIBINDEN_STORAGE_STATE_B64';
export const STORAGE_STATE_FILE_ENV_VAR = 'SAHIBINDEN_STORAGE_STATE_FILE';
export const DEFAULT_STORAGE_STATE_FILE = 'auth.json';

function makeStorageStateError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isAllowedSahibindenHost(hostname = '') {
  const host = String(hostname || '').trim().toLowerCase();
  return host === 'sahibinden.com' || host.endsWith('.sahibinden.com') || host === 'shbdn.com';
}

function cookieHost(cookie) {
  if (typeof cookie.domain === 'string' && cookie.domain.trim()) {
    return cookie.domain.trim().replace(/^\./, '');
  }

  if (typeof cookie.url === 'string' && cookie.url.trim()) {
    try {
      return new URL(cookie.url).hostname;
    } catch {
      return '';
    }
  }

  return '';
}

function originHost(origin = '') {
  try {
    return new URL(origin).hostname;
  } catch {
    return '';
  }
}

function assertStorageStateShape(rawState) {
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
    throw makeStorageStateError('STORAGE_STATE_SCHEMA_INVALID', 'Storage state object formatinda olmali.');
  }

  if (!Array.isArray(rawState.cookies)) {
    throw makeStorageStateError('STORAGE_STATE_SCHEMA_INVALID', 'Storage state cookies array olmali.');
  }

  if (rawState.origins !== undefined && !Array.isArray(rawState.origins)) {
    throw makeStorageStateError('STORAGE_STATE_SCHEMA_INVALID', 'Storage state origins array olmali.');
  }
}

function assertCookieShape(cookie, index) {
  if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie)) {
    throw makeStorageStateError('STORAGE_STATE_SCHEMA_INVALID', `Storage cookie #${index} object olmali.`);
  }

  if (typeof cookie.name !== 'string' || !cookie.name.trim() || typeof cookie.value !== 'string') {
    throw makeStorageStateError(
      'STORAGE_STATE_SCHEMA_INVALID',
      `Storage cookie #${index} name/value alanlari gecersiz.`,
    );
  }

  if (!cookieHost(cookie)) {
    throw makeStorageStateError(
      'STORAGE_STATE_SCHEMA_INVALID',
      `Storage cookie #${index} domain veya url alanina sahip olmali.`,
    );
  }
}

export function filterSahibindenStorageState(rawState, options = {}) {
  assertStorageStateShape(rawState);

  const nowSec =
    Number.isFinite(Number(options.nowSec)) ? Number(options.nowSec) : Math.floor(Date.now() / 1000);
  const cookies = [];
  let droppedExpired = 0;
  let droppedUnrelated = 0;

  rawState.cookies.forEach((cookie, idx) => {
    assertCookieShape(cookie, idx + 1);

    const host = cookieHost(cookie);
    if (!isAllowedSahibindenHost(host)) {
      droppedUnrelated += 1;
      return;
    }

    const expires = Number(cookie.expires);
    const isExpired = Number.isFinite(expires) && expires > 0 && expires <= nowSec;
    if (isExpired) {
      droppedExpired += 1;
      return;
    }

    // Playwright addCookies only accepts specific fields
    const normalized = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
    };

    if (cookie.expires !== undefined && cookie.expires !== null && cookie.expires !== '') {
      const expiresNum = Number(cookie.expires);
      if (Number.isFinite(expiresNum)) {
        normalized.expires = Math.floor(expiresNum);
      }
    }

    if (typeof cookie.httpOnly === 'boolean') {
      normalized.httpOnly = cookie.httpOnly;
    }

    if (typeof cookie.secure === 'boolean') {
      normalized.secure = cookie.secure;
    }

    const sameSite = normalizeCookieSameSite(cookie.sameSite);
    if (sameSite) {
      normalized.sameSite = sameSite;
    }

    cookies.push(normalized);
  });

  const origins = (rawState.origins || [])
    .filter((originEntry) => {
      if (!originEntry || typeof originEntry !== 'object' || Array.isArray(originEntry)) {
        return false;
      }
      return isAllowedSahibindenHost(originHost(originEntry.origin));
    })
    .map((originEntry) => ({
      ...originEntry,
      localStorage: Array.isArray(originEntry.localStorage)
        ? originEntry.localStorage.map((item) => ({ ...item }))
        : [],
    }));

  return {
    storageState: {
      cookies,
      origins,
    },
    source: options.source || 'inline',
    inputCookieCount: rawState.cookies.length,
    cookieCount: cookies.length,
    originCount: origins.length,
    droppedExpired,
    droppedUnrelated,
  };
}

function normalizeCookieSameSite(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const lowered = value.trim().toLowerCase();
  if (lowered === 'no_restriction') {
    return 'None';
  }
  if (lowered === 'lax') {
    return 'Lax';
  }
  if (lowered === 'strict') {
    return 'Strict';
  }
  if (lowered === 'none') {
    return 'None';
  }
  return undefined;
}

function parseStorageState(payload, sourceLabel) {
  try {
    return JSON.parse(payload);
  } catch (err) {
    throw makeStorageStateError(
      'STORAGE_STATE_PARSE_INVALID',
      `${sourceLabel} JSON parse hatasi: ${err.message}`,
    );
  }
}

export function loadSahibindenStorageState(options = {}) {
  const env = options.env || process.env;
  const existsSync = options.existsSync || fs.existsSync;
  const readFileSync = options.readFileSync || fs.readFileSync;

  const b64Payload = String(env[STORAGE_STATE_B64_ENV_VAR] || '').trim();
  const rawPayload = String(env[STORAGE_STATE_ENV_VAR] || '').trim();
  const stateFile = String(env[STORAGE_STATE_FILE_ENV_VAR] || DEFAULT_STORAGE_STATE_FILE).trim();

  let source = 'none';
  let payload = '';
  let sourceLabel = '';

  if (b64Payload) {
    source = 'env-b64';
    sourceLabel = STORAGE_STATE_B64_ENV_VAR;
    payload = Buffer.from(b64Payload, 'base64').toString('utf8');
  } else if (rawPayload) {
    source = 'env';
    sourceLabel = STORAGE_STATE_ENV_VAR;
    payload = rawPayload;
  } else if (stateFile && existsSync(stateFile)) {
    source = 'file';
    sourceLabel = stateFile;
    payload = readFileSync(stateFile, 'utf8');
  }

  if (source === 'none') {
    return {
      source,
      storageState: null,
      inputCookieCount: 0,
      cookieCount: 0,
      originCount: 0,
      droppedExpired: 0,
      droppedUnrelated: 0,
    };
  }

  const parsed = parseStorageState(payload, sourceLabel);
  return filterSahibindenStorageState(parsed, {
    nowSec: options.nowSec,
    source,
  });
}
