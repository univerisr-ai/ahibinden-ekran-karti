import 'dotenv/config';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';

import { filterSahibindenStorageState } from '../src/session_state.mjs';

const LOGIN_URL = process.env.SAHIBINDEN_LOGIN_URL || 'https://secure.sahibinden.com/giris';
const TARGET_URL =
  process.env.TARGET_URL || 'https://www.sahibinden.com/ekran-karti-masaustu';
const STATE_PATH = resolve(process.cwd(), process.env.SAHIBINDEN_STORAGE_STATE_FILE || 'auth.json');
const LOGIN_WAIT_MS = parseInt(process.env.SAHIBINDEN_LOGIN_WAIT_MS || '300000', 10);
const POLL_MS = 2000;
const AUTO_SUBMIT = String(process.env.SAHIBINDEN_AUTO_SUBMIT || 'false').toLowerCase() === 'true';
const SUBMIT_DELAY_MS = parseInt(process.env.SAHIBINDEN_SUBMIT_DELAY_MS || '5000', 10);
const BROWSER_MODE = String(process.env.SAHIBINDEN_BROWSER_MODE || 'playwright').toLowerCase();
const MANUAL_LOGIN = String(process.env.SAHIBINDEN_MANUAL_LOGIN || 'false').toLowerCase() === 'true';
const KEEP_BROWSER_OPEN =
  String(process.env.SAHIBINDEN_KEEP_BROWSER_OPEN || 'false').toLowerCase() === 'true';
const CDP_PORT = parseInt(process.env.SAHIBINDEN_CDP_PORT || '9223', 10);
const CDP_PROFILE_DIR = resolve(
  process.cwd(),
  process.env.SAHIBINDEN_CDP_PROFILE_DIR || '.chrome_profile_sahibinden',
);

function withoutProxyEnv() {
  const launchEnv = { ...process.env };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete launchEnv[key];
  }
  return launchEnv;
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

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Google Chrome executable bulunamadi. CHROME_PATH ile path verin.');
  }

  return found;
}

async function waitForCdpEndpoint(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  const endpoint = `http://127.0.0.1:${port}`;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        return endpoint;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Chrome CDP endpoint acilmadi: ${endpoint}`);
}

async function launchBrowserSession() {
  if (BROWSER_MODE === 'cdp') {
    await mkdir(CDP_PROFILE_DIR, { recursive: true });
    const chromePath = resolveChromeExecutable();
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
      {
        env: withoutProxyEnv(),
        stdio: 'ignore',
        windowsHide: false,
      },
    );

    const endpoint = await waitForCdpEndpoint(CDP_PORT);
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    return {
      browser,
      context,
      page,
      async close() {
        await browser.close().catch(() => {});
        if (!chromeProcess.killed) {
          chromeProcess.kill();
        }
      },
    };
  }

  const browser = await chromium.launch({
    headless: false,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    args: ['--no-proxy-server', '--proxy-server=direct://', '--proxy-bypass-list=*', '--lang=tr-TR'],
    env: withoutProxyEnv(),
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

async function firstVisible(locator) {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) {
      return item;
    }
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
  const clicked = await clickVisibleByText(page, [
    'Tüm Çerezleri Kabul Et',
    'Tum Cerezleri Kabul Et',
    'Tümünü Kabul Et',
    'Kabul Et',
  ]);

  if (clicked) {
    console.log('Cerez banneri kapatildi.');
  }
}

async function enableStaySignedIn(page) {
  const checkbox = await firstVisible(
    page.locator(
      'input[type="checkbox"], label:has-text("Oturumum açık kalsın"), label:has-text("Oturumum acik kalsin")',
    ),
  );

  if (!checkbox) {
    return;
  }

  const checked = await checkbox.isChecked().catch(() => false);
  if (!checked) {
    await checkbox.click({ timeout: 5000 }).catch(() => {});
    console.log('Oturumum acik kalsin secildi.');
  }
}

async function promptLine(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return '';
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return String(await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function promptPassword(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return '';
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    function cleanup() {
      stdin.off('keypress', onKeypress);
      if (stdin.isTTY) {
        stdin.setRawMode(wasRaw || false);
      }
      stdin.pause();
    }

    function onKeypress(str, key = {}) {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.stdout.write('\n');
        reject(new Error('Kullanici tarafindan iptal edildi.'));
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        process.stdout.write('\n');
        resolve(value);
        return;
      }

      if (key.name === 'backspace') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }

      if (str && !key.ctrl && !key.meta) {
        value += str;
        process.stdout.write('*'.repeat(str.length));
      }
    }

    process.stdout.write(question);
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('keypress', onKeypress);
  });
}

async function resolveCredentials() {
  if (MANUAL_LOGIN) {
    return { email: '', password: '' };
  }

  let email = String(process.env.SAHIBINDEN_EMAIL || '').trim();
  let password = String(process.env.SAHIBINDEN_PASSWORD || '');

  if (!email) {
    email = await promptLine('Sahibinden e-posta: ');
  }

  if (!password) {
    password = await promptPassword('Sahibinden sifre: ');
  }

  return { email, password };
}

async function waitForEnterToClose() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('Browser acik birakildi. Terminal interaktif degil; kapatmak icin Chrome penceresini kapatin.');
    await new Promise(() => {});
    return;
  }

  await promptLine('Browser acik. Kapatmak icin Enter basin: ');
}

async function fillCredentials(page, credentials) {
  const email = String(credentials?.email || '').trim();
  const password = String(credentials?.password || '');

  if (!email || !password) {
    console.log('Credentials alinamadi. Browser icinde manuel giris yapabilirsiniz.');
    return false;
  }

  const emailInput = await firstVisible(
    page.locator(
      'input[type="email"], input[name="username"], input[name="email"], input[id*="email" i], input[id*="username" i]',
    ),
  );
  const passwordInput = await firstVisible(
    page.locator('input[type="password"], input[name="password"], input[id*="password" i]'),
  );

  if (!emailInput || !passwordInput) {
    console.log('Login alanlari otomatik bulunamadi. Browser icinde manuel giris yapin.');
    return false;
  }

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await enableStaySignedIn(page);

  if (!AUTO_SUBMIT) {
    console.log('Login bilgileri dolduruldu. Dogrulamayi tamamlayip giris butonuna browser icinde manuel basin.');
    return true;
  }

  await acceptCookieBanner(page);
  if (SUBMIT_DELAY_MS > 0) {
    console.log(`Submit oncesi ${SUBMIT_DELAY_MS}ms bekleniyor.`);
    await page.waitForTimeout(SUBMIT_DELAY_MS);
  }

  const submitButton = await firstVisible(
    page.locator(
      'button[type="submit"], input[type="submit"], button:has-text("Giris yap"), button:has-text("Giriş yap")',
    ),
  );

  if (submitButton) {
    await submitButton.click();
  } else {
    await passwordInput.press('Enter');
  }

  console.log('Login formu gonderildi. Ek dogrulama cikarsa browser icinde tamamlayin.');
  return true;
}

function isLoginLikePage(html = '', currentUrl = '') {
  const h = String(html || '').toLowerCase();
  const u = String(currentUrl || '').toLowerCase();
  const hasLoginUrl = u.includes('/giris') || u.includes('/login') || u.includes('/uyelik/giris');
  const hasLoginForm =
    (h.includes('giris yap') || h.includes('giriş yap') || h.includes('uye girisi') || h.includes('üye girişi')) &&
    (h.includes('sifre') || h.includes('şifre'));
  return hasLoginUrl || hasLoginForm;
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
    h.includes('çıkış yap') ||
    h.includes('/cikis') ||
    h.includes('/logout')
  );
}

function detectBlockingMessage(html = '') {
  const h = String(html || '').toLowerCase();

  if (
    h.includes('doğrulama başarısız') ||
    h.includes('dogrulama basarisiz') ||
    h.includes('doğrulama tamamlanamadı') ||
    h.includes('dogrulama tamamlanamadi')
  ) {
    return 'Dogrulama basarisiz.';
  }

  if (
    h.includes('güvenlik doğrulaması') ||
    h.includes('guvenlik dogrulamasi') ||
    h.includes('gerçek kişi olduğunuzu') ||
    h.includes('gercek kisi oldugunuzu') ||
    h.includes('robot olmadığınızı') ||
    h.includes('robot olmadiginizi')
  ) {
    return 'Manuel guvenlik dogrulamasi gerekiyor.';
  }

  if (h.includes('hatalı şifre') || h.includes('hatali sifre')) {
    return 'Sifre hatali gorunuyor.';
  }

  return '';
}

async function waitForUsableSession(page, context) {
  const deadline = Date.now() + LOGIN_WAIT_MS;
  let lastLogAt = 0;

  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_MS);

    try {
      const currentHtml = await page.content();
      const blockingMessage = detectBlockingMessage(currentHtml);
      const now = Date.now();

      if (now - lastLogAt > 10000) {
        console.log(`Session kontrolu: url=${page.url()}${blockingMessage ? ` | ${blockingMessage}` : ''}`);
        lastLogAt = now;
      }

      if (blockingMessage === 'Dogrulama basarisiz.' || blockingMessage === 'Sifre hatali gorunuyor.') {
        throw new Error(blockingMessage);
      }

      if (isLoginLikePage(currentHtml, page.url())) {
        continue;
      }

      if (hasLoggedInHint(currentHtml)) {
        return true;
      }

      const cookies = await context.cookies('https://www.sahibinden.com');
      const hasSahibindenCookies = cookies.some((cookie) =>
        String(cookie.domain || '').toLowerCase().includes('sahibinden.com'),
      );

      if (!hasSahibindenCookies) {
        continue;
      }

      await page.goto(TARGET_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      const html = await page.content();
      if (!isLoginLikePage(html, page.url()) && hasLoggedInHint(html)) {
        return true;
      }
    } catch (err) {
      if (
        err.message === 'Dogrulama basarisiz.' ||
        err.message === 'Sifre hatali gorunuyor.'
      ) {
        throw err;
      }
      console.log(`Session kontrolu tekrar denenecek: ${err.message}`);
    }
  }

  return false;
}

async function main() {
  const credentials = await resolveCredentials();
  const session = await launchBrowserSession();
  const { context, page } = session;

  try {
    console.log(`Browser modu: ${BROWSER_MODE}`);
    await page.goto(LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await fillCredentials(page, credentials);

    const loggedIn = await waitForUsableSession(page, context);
    if (!loggedIn) {
      throw new Error('Login dogrulanamadi. Hesap, sifre veya ek dogrulama ekranini kontrol edin.');
    }

    const rawState = await context.storageState({ indexedDB: true });
    const filtered = filterSahibindenStorageState(rawState);
    if (filtered.cookieCount === 0) {
      throw new Error('Kaydedilecek sahibinden cookie bulunamadi.');
    }

    await mkdir(dirname(STATE_PATH), { recursive: true });
    await writeFile(STATE_PATH, `${JSON.stringify(filtered.storageState, null, 2)}\n`, 'utf8');
    console.log(`Auth state kaydedildi: ${STATE_PATH}`);
    console.log(`Cookie: ${filtered.cookieCount}/${filtered.inputCookieCount}, origin: ${filtered.originCount}`);
    await page.goto(TARGET_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    }).catch(() => {});
    console.log(`Ilan sayfasi acildi: ${page.url()}`);
  } finally {
    if (KEEP_BROWSER_OPEN) {
      await waitForEnterToClose();
    }
    await session.close();
  }
}

main().catch((err) => {
  console.error(`Session kaydi basarisiz: ${err.message}`);
  process.exit(1);
});
