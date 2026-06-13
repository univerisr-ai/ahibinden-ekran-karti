import 'dotenv/config';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { filterSahibindenStorageState } from '../src/session_state.mjs';

const LOGIN_URL = process.env.SAHIBINDEN_LOGIN_URL || 'https://secure.sahibinden.com/giris';
const TARGET_URL = process.env.TARGET_URL || 'https://www.sahibinden.com/ekran-karti-masaustu';
const STATE_PATH = resolve(process.cwd(), process.env.SAHIBINDEN_STORAGE_STATE_FILE || 'auth.json');
const COOKIES_PATH = resolve(process.cwd(), process.env.SAHIBINDEN_COOKIES_FILE || 'cookies.json');
const LOGIN_WAIT_MS = parseInt(process.env.SAHIBINDEN_LOGIN_WAIT_MS || '300000', 10);
const POLL_MS = 2000;
const BROWSER_MODE = String(process.env.SAHIBINDEN_BROWSER_MODE || 'launch').toLowerCase();
const CDP_PORT = parseInt(process.env.SAHIBINDEN_CDP_PORT || '9223', 10);
const CDP_PROFILE_DIR = resolve(process.cwd(), process.env.SAHIBINDEN_CDP_PROFILE_DIR || '.chrome_profile_sahibinden');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function promptLine(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return '';
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return String(await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function firstVisible(locator) {
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const item = locator.nth(i);
    if (await item.isVisible().catch(() => false)) return item;
  }
  return null;
}

async function clickVisibleByText(page, texts) {
  for (const text of texts) {
    const locator = page.getByText(text, { exact: false });
    const item = await firstVisible(locator);
    if (item) {
      await item.click({ timeout: 5000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function acceptCookieBanner(page) {
  await clickVisibleByText(page, [
    'Tüm Çerezleri Kabul Et',
    'Tum Cerezleri Kabul Et',
    'Tümünü Kabul Et',
    'Kabul Et',
  ]);
}

function resolveChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROME_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  return candidates.find((c) => existsSync(c));
}

async function waitForCdpEndpoint(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return `http://127.0.0.1:${port}`;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Chrome CDP endpoint acilmadi: http://127.0.0.1:${port}`);
}

async function launchBrowserSession() {
  if (BROWSER_MODE === 'cdp') {
    await mkdir(CDP_PROFILE_DIR, { recursive: true });
    const chromePath = resolveChromeExecutable();
    if (!chromePath) throw new Error('Google Chrome executable bulunamadi. CHROME_PATH ile path verin.');

    const { spawn } = await import('node:child_process');
    const chromeProcess = spawn(
      chromePath,
      [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${CDP_PROFILE_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate',
        '--no-proxy-server',
        '--proxy-server=direct://',
        '--proxy-bypass-list=*',
        '--lang=tr-TR',
      ],
      { stdio: 'ignore', windowsHide: false },
    );

    const endpoint = await waitForCdpEndpoint(CDP_PORT);
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || (await context.newPage());

    return {
      browser,
      context,
      page,
      async close() {
        await browser.close().catch(() => {});
        if (!chromeProcess.killed) chromeProcess.kill();
      },
    };
  }

  const browser = await chromium.launch({
    headless: false,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    args: ['--no-proxy-server', '--proxy-server=direct://', '--proxy-bypass-list=*', '--lang=tr-TR'],
    slowMo: parseInt(process.env.PLAYWRIGHT_SLOWMO_MS || '50', 10),
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1366, height: 900 },
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  });

  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

function hasLoggedInHint(html = '') {
  const h = String(html || '').toLowerCase();
  return (
    h.includes('hesabim') ||
    h.includes('hesabım') ||
    h.includes('bana ozel') ||
    h.includes('bana özel') ||
    h.includes('mesajlarim') ||
    h.includes('mesajlarım') ||
    h.includes('favori ilanlarim') ||
    h.includes('favori ilanlarım') ||
    h.includes('cikis yap') ||
    h.includes('çıkış yap')
  );
}

async function waitForUsableSession(page) {
  const deadline = Date.now() + LOGIN_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    try {
      const html = await page.content();
      if (hasLoggedInHint(html)) return true;
    } catch {}
  }
  return false;
}

async function main() {
  console.log('Sahibinden oturum kayit scripti baslatiliyor...');
  console.log(`Mod: ${BROWSER_MODE}`);
  console.log(`Login URL: ${LOGIN_URL}`);
  console.log(`Hedef URL: ${TARGET_URL}`);
  console.log('');

  const session = await launchBrowserSession();
  const { context, page } = session;

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await acceptCookieBanner(page);

    console.log('Lutfen tarayici penceresinde sahibinden hesabinizla giris yapin.');
    console.log('Giris yaptiktan sonra burada Enter basin.');
    await promptLine('Giris yapip Enter basin: ');

    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const html = await page.content();
    if (!hasLoggedInHint(html)) {
      console.log('Giris isareti tespit edilemedi. Yine de mevcut state kaydediliyor.');
    }

    const rawState = await context.storageState({ indexedDB: true });
    const filtered = filterSahibindenStorageState(rawState);
    if (filtered.cookieCount === 0) {
      throw new Error('Kaydedilecek sahibinden cookie bulunamadi.');
    }

    await mkdir(dirname(STATE_PATH), { recursive: true });
    await writeFile(STATE_PATH, `${JSON.stringify(filtered.storageState, null, 2)}\n`, 'utf8');

    const simpleCookies = filtered.storageState.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
      expires: c.expires,
    }));
    await writeFile(COOKIES_PATH, `${JSON.stringify(simpleCookies, null, 2)}\n`, 'utf8');

    console.log(`✅ Storage state kaydedildi: ${STATE_PATH}`);
    console.log(`✅ Cookies kaydedildi: ${COOKIES_PATH}`);
    console.log(`   Cookie: ${filtered.cookieCount}/${filtered.inputCookieCount}`);
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  console.error(`Session kaydi basarisiz: ${err.message}`);
  process.exit(1);
});
