import 'dotenv/config';

import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

import { filterSahibindenStorageState } from '../src/session_state.mjs';

const LOGIN_URL = process.env.SAHIBINDEN_LOGIN_URL || 'https://secure.sahibinden.com/giris';
const TARGET_URL = process.env.TARGET_URL || 'https://www.sahibinden.com/ekran-karti-masaustu';
const REPORT_PATH = resolve(process.cwd(), process.env.SAHIBINDEN_LOGIN_REPORT || 'login-inspection-report.json');
const AUTH_STATE_PATH = resolve(process.cwd(), process.env.SAHIBINDEN_STORAGE_STATE_FILE || 'auth.json');
const PROFILE_DIR = resolve(
  process.cwd(),
  process.env.SAHIBINDEN_CDP_PROFILE_DIR || '.chrome_profile_sahibinden_inspect',
);
const CDP_PORT = parseInt(process.env.SAHIBINDEN_CDP_PORT || '9223', 10);
const LOGIN_TIMEOUT_MS = parseInt(process.env.SAHIBINDEN_LOGIN_WAIT_MS || '900000', 10);
const POLL_MS = parseInt(process.env.SAHIBINDEN_LOGIN_POLL_MS || '2000', 10);
const SAVE_AUTH_STATE = String(process.env.SAHIBINDEN_SAVE_AUTH_STATE || 'true').toLowerCase() !== 'false';

const sensitiveQueryNames = new Set([
  'token',
  'code',
  'state',
  'auth',
  'session',
  'sid',
  'csrf',
  'xsrf',
  'password',
  'email',
]);

function sha(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function sanitizeUrl(rawUrl = '') {
  try {
    const url = new URL(String(rawUrl));
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveQueryNames.has(key.toLowerCase())) {
        url.searchParams.set(key, '<redacted>');
      } else {
        const value = url.searchParams.get(key) || '';
        if (value.length > 20) {
          url.searchParams.set(key, `${value.slice(0, 8)}...${value.length}`);
        }
      }
    }
    return url.toString();
  } catch {
    return String(rawUrl).slice(0, 220);
  }
}

function summarizeCookie(cookie) {
  const expires = Number(cookie.expires);
  return {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    expires:
      Number.isFinite(expires) && expires > 0
        ? new Date(Math.floor(expires) * 1000).toISOString()
        : 'session',
    secondsLeft:
      Number.isFinite(expires) && expires > 0
        ? Math.max(0, Math.floor(expires - Date.now() / 1000))
        : null,
    httpOnly: !!cookie.httpOnly,
    secure: !!cookie.secure,
    sameSite: cookie.sameSite || null,
    valueLength: String(cookie.value || '').length,
    valueHash: sha(cookie.value || ''),
  };
}

function parseSetCookieHeader(headerValue = '') {
  const raw = String(headerValue || '').trim();
  if (!raw) return [];

  // Split on comma only when it looks like a new cookie starts. This avoids Expires=Wed, ...
  return raw
    .split(/,(?=\s*[^;,=\s]+=[^;]+)/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((line) => {
      const [pair = '', ...attrs] = line.split(';').map((part) => part.trim());
      const eq = pair.indexOf('=');
      const name = eq >= 0 ? pair.slice(0, eq) : pair;
      const attrMap = {};
      for (const attr of attrs) {
        const attrEq = attr.indexOf('=');
        const key = (attrEq >= 0 ? attr.slice(0, attrEq) : attr).toLowerCase();
        const value = attrEq >= 0 ? attr.slice(attrEq + 1) : true;
        if (['expires', 'max-age', 'domain', 'path', 'samesite'].includes(key)) {
          attrMap[key] = value;
        } else if (['httponly', 'secure'].includes(key)) {
          attrMap[key] = true;
        }
      }
      return {
        name,
        attrs: attrMap,
        valueLength: eq >= 0 ? pair.slice(eq + 1).length : 0,
        valueHash: eq >= 0 ? sha(pair.slice(eq + 1)) : null,
      };
    });
}

function looksLoggedIn(html = '', url = '') {
  const h = String(html || '').toLowerCase();
  const u = String(url || '').toLowerCase();
  if (u.includes('/giris') || u.includes('/login') || u.includes('/uyelik/giris')) {
    return false;
  }
  return (
    h.includes('hesabım') ||
    h.includes('hesabim') ||
    h.includes('bana özel') ||
    h.includes('bana ozel') ||
    h.includes('mesajlarım') ||
    h.includes('mesajlarim') ||
    h.includes('favori ilanlarım') ||
    h.includes('favori ilanlarim') ||
    h.includes('çıkış yap') ||
    h.includes('cikis yap') ||
    h.includes('/cikis') ||
    h.includes('/logout')
  );
}

function resolveChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Google Chrome bulunamadi. CHROME_PATH ile chrome.exe path verin.');
  }
  return found;
}

async function waitForCdpEndpoint(port, timeoutMs = 20000) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return endpoint;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Chrome CDP endpoint acilmadi: ${endpoint}`);
}

async function summarizeStorageState(context) {
  const raw = await context.storageState({ indexedDB: true });
  return {
    cookies: raw.cookies.map(summarizeCookie).sort((a, b) => a.name.localeCompare(b.name)),
    origins: (raw.origins || []).map((origin) => ({
      origin: origin.origin,
      localStorageKeys: (origin.localStorage || []).map((item) => ({
        name: item.name,
        valueLength: String(item.value || '').length,
        valueHash: sha(item.value || ''),
      })),
      indexedDB:
        Array.isArray(origin.indexedDB)
          ? origin.indexedDB.map((db) => ({
              name: db.name,
              version: db.version,
              stores: Array.isArray(db.stores) ? db.stores.map((store) => store.name) : [],
            }))
          : [],
    })),
  };
}

async function main() {
  await mkdir(PROFILE_DIR, { recursive: true });
  const chromePath = resolveChromeExecutable();
  const chromeProcess = spawn(
    chromePath,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
      '--lang=tr-TR',
    ],
    {
      stdio: 'ignore',
      windowsHide: false,
    },
  );

  const report = {
    startedAt: new Date().toISOString(),
    loginUrl: LOGIN_URL,
    targetUrl: TARGET_URL,
    profileDir: PROFILE_DIR,
    browserMode: 'chrome-cdp',
    notes: [
      'Cookie ve storage degerleri rapora yazilmadi; sadece uzunluk/hash/metadata var.',
      'Secret degerleri auth.json icinde saklanir; GitHub loguna basmayin.',
    ],
    urls: [],
    network: [],
    setCookies: [],
    console: [],
    requestFailures: [],
    cookieSnapshots: [],
    finalStorage: null,
    detectedLogin: false,
    finishedAt: null,
  };

  let browser;
  try {
    const endpoint = await waitForCdpEndpoint(CDP_PORT);
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    const cdp = await context.newCDPSession(page);

    await cdp.send('Network.enable');
    cdp.on('Network.responseReceived', (event) => {
      const response = event.response || {};
      report.network.push({
        ts: new Date().toISOString(),
        type: event.type,
        status: response.status,
        url: sanitizeUrl(response.url),
        mimeType: response.mimeType || '',
        remoteIPAddress: response.remoteIPAddress || '',
        fromDiskCache: !!response.fromDiskCache,
        fromServiceWorker: !!response.fromServiceWorker,
        headers: {
          location: response.headers?.location ? sanitizeUrl(response.headers.location) : undefined,
          server: response.headers?.server,
          'cf-ray': response.headers?.['cf-ray'] || response.headers?.['CF-Ray'],
          'content-type': response.headers?.['content-type'] || response.headers?.['Content-Type'],
          'cache-control': response.headers?.['cache-control'] || response.headers?.['Cache-Control'],
        },
      });
    });

    cdp.on('Network.responseReceivedExtraInfo', (event) => {
      const headers = event.headers || {};
      const setCookie = headers['set-cookie'] || headers['Set-Cookie'];
      if (setCookie) {
        report.setCookies.push({
          ts: new Date().toISOString(),
          statusCode: event.statusCode,
          cookies: parseSetCookieHeader(setCookie),
        });
      }
    });

    page.on('console', (msg) => {
      report.console.push({
        ts: new Date().toISOString(),
        type: msg.type(),
        text: String(msg.text()).slice(0, 1000),
      });
    });

    page.on('pageerror', (err) => {
      report.console.push({
        ts: new Date().toISOString(),
        type: 'pageerror',
        text: String(err.message || err).slice(0, 1000),
      });
    });

    page.on('requestfailed', (request) => {
      report.requestFailures.push({
        ts: new Date().toISOString(),
        method: request.method(),
        url: sanitizeUrl(request.url()),
        failure: request.failure()?.errorText || '',
      });
    });

    console.log(`Chrome acildi. Profil: ${PROFILE_DIR}`);
    console.log('Giris yontemini tarayicida dene. Script Network/Console/Cookie metadata izleyecek.');
    console.log(`Rapor: ${REPORT_PATH}`);
    console.log(`Auth state: ${AUTH_STATE_PATH}`);

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let lastUrl = '';
    let lastCookieHash = '';
    while (Date.now() < deadline) {
      const currentUrl = page.url();
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        report.urls.push({ ts: new Date().toISOString(), url: sanitizeUrl(currentUrl) });
        console.log(`URL: ${sanitizeUrl(currentUrl)}`);
      }

      const cookies = await context.cookies([
        'https://www.sahibinden.com',
        'https://secure.sahibinden.com',
      ]);
      const cookieSummary = cookies.map(summarizeCookie).sort((a, b) => a.name.localeCompare(b.name));
      const cookieHash = sha(JSON.stringify(cookieSummary));
      if (cookieHash !== lastCookieHash) {
        lastCookieHash = cookieHash;
        report.cookieSnapshots.push({
          ts: new Date().toISOString(),
          count: cookieSummary.length,
          cookies: cookieSummary,
        });
        console.log(`Cookie snapshot: ${cookieSummary.length} cookie`);
      }

      const html = await page.content().catch(() => '');
      if (looksLoggedIn(html, currentUrl)) {
        report.detectedLogin = true;
        console.log('Login belirtisi yakalandi. Target sayfasi kontrol ediliyor...');
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(5000);
        break;
      }

      await page.waitForTimeout(POLL_MS);
    }

    report.finalStorage = await summarizeStorageState(context);
    report.finishedAt = new Date().toISOString();

    if (SAVE_AUTH_STATE) {
      const rawState = await context.storageState({ indexedDB: true });
      const filtered = filterSahibindenStorageState(rawState);
      await mkdir(dirname(AUTH_STATE_PATH), { recursive: true });
      await writeFile(AUTH_STATE_PATH, `${JSON.stringify(filtered.storageState, null, 2)}\n`, 'utf8');
      console.log(`Auth state kaydedildi: ${AUTH_STATE_PATH} (${filtered.cookieCount}/${filtered.inputCookieCount} cookie)`);
    }

    await mkdir(dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Inspection raporu kaydedildi: ${REPORT_PATH}`);
    console.log(`Login detected: ${report.detectedLogin ? 'yes' : 'no'}`);
  } finally {
    await browser?.close().catch(() => {});
    if (!chromeProcess.killed) chromeProcess.kill();
  }
}

main().catch((err) => {
  console.error(`Login inspection basarisiz: ${err.message}`);
  process.exit(1);
});
