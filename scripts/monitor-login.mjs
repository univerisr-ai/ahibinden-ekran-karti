import { chromium } from 'playwright';
import { NewBrowser, launchOptions } from 'camoufox';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUTPUT_DIR = resolve(process.cwd(), 'login-capture');
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

const captured = {
  startTime: new Date().toISOString(),
  requestLog: [],
  responseHeaders: [],
  setCookiesFromResponses: [],
  localStorageBefore: {},
  localStorageAfter: {},
  sessionStorageBefore: {},
  sessionStorageAfter: {},
  cookiesBefore: [],
  cookiesAfter: [],
  storageStateAfter: null,
  finalUrl: '',
  finalTitle: '',
};

async function captureStorage(page, phase) {
  captured[`cookies${phase}`] = await page.context().cookies();
  captured[`localStorage${phase}`] = await page.evaluate(() => ({ ...localStorage })).catch(() => ({}));
  captured[`sessionStorage${phase}`] = await page.evaluate(() => ({ ...sessionStorage })).catch(() => ({}));
}

const camouflageOptions = await launchOptions({
  headless: false,
  locale: 'tr-TR',
  disable_coop: true,
  humanize: true,
  window: { width: 1920, height: 1080 },
  i_know_what_im_doing: true,
});

const browser = await NewBrowser(chromium, false, camouflageOptions);

const context = browser.contexts()[0] || await browser.newContext({
  locale: 'tr-TR',
  timezoneId: 'Europe/Istanbul',
});

const page = context.pages()[0] || await context.newPage();

page.on('request', req => {
  captured.requestLog.push({
    ts: new Date().toISOString(),
    url: req.url().substring(0, 300),
    method: req.method(),
    type: req.resourceType(),
    headers: req.headers(),
    postData: req.postData()?.substring(0, 500) || null,
  });
});

page.on('response', resp => {
  const headers = resp.headers();
  const url = resp.url();
  const setCookies = headers['set-cookie'] || '';
  if (setCookies) {
    captured.setCookiesFromResponses.push({
      ts: new Date().toISOString(),
      url: url.substring(0, 300),
      status: resp.status(),
      setCookie: setCookies,
    });
  }
  if (url.includes('/api/') || url.includes('token') || url.includes('auth') || url.includes('login') || url.includes('session')) {
    resp.text().then(text => {
      captured.responseHeaders.push({
        ts: new Date().toISOString(),
        url: url.substring(0, 300),
        status: resp.status(),
        contentType: headers['content-type'] || '',
        body: text?.substring(0, 1000) || null,
      });
    }).catch(() => {});
  }
});

await page.goto('https://www.sahibinden.com/giris', { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('=== GIRIS SAYFASI YUKLENDI ===');
console.log(`Title: ${await page.title()}`);
console.log(`URL: ${page.url()}`);

await page.waitForTimeout(5000);
await captureStorage(page, 'Before');
console.log(`Cookies before login: ${captured.cookiesBefore.length}`);

console.log('\n=== TARAYICI ACIK, SUAN LOGIN YAP ===');
console.log('Lutfen kullanici adi ve sifrenizi girip giris yapin.');
console.log('Ana sayfaya yonlendirilinceyi bekliyorum...\n');

let loggedIn = false;
for (let i = 0; i < 600; i++) {
  await page.waitForTimeout(1000);
  const url = page.url();
  if (!url.includes('giris') && !url.includes('login') && !url.includes('challenge') && !url.includes('captcha')) {
    console.log(`\nLogin algilandi! Yeni URL: ${url}`);
    await page.waitForTimeout(3000);
    loggedIn = true;
    break;
  }
  if (i % 60 === 0) {
    console.log(`  Bekleniyor... (${Math.floor(i/60)} dk) URL: ${url.substring(0, 80)}`);
  }
}

if (!loggedIn) {
  console.log('Zaman asimi - sayfa su an: ' + page.url());
} else {
  console.log('\n=== LOGIN BASARILI ===');
  console.log(`Ana sayfaya yonlendirildi: ${captured.finalUrl}`);
}

captured.finalUrl = page.url();
captured.finalTitle = await page.title();
await captureStorage(page, 'After');
captured.storageStateAfter = await context.storageState();

writeFileSync(resolve(OUTPUT_DIR, 'full-capture.json'), JSON.stringify(captured, null, 2));
writeFileSync(resolve(OUTPUT_DIR, 'cookies.json'), JSON.stringify(captured.cookiesAfter, null, 2));
writeFileSync(resolve(OUTPUT_DIR, 'cookies-before.json'), JSON.stringify(captured.cookiesBefore, null, 2));
writeFileSync(resolve(OUTPUT_DIR, 'auth.json'), JSON.stringify(captured.storageStateAfter, null, 2));
writeFileSync(resolve(OUTPUT_DIR, 'network-requests.json'), JSON.stringify(captured.requestLog, null, 2));
writeFileSync(resolve(OUTPUT_DIR, 'set-cookie-responses.json'), JSON.stringify(captured.setCookiesFromResponses, null, 2));
writeFileSync(resolve(OUTPUT_DIR, 'api-responses.json'), JSON.stringify(captured.responseHeaders, null, 2));

console.log(`\n=== KAYDEDILEN DOSYALAR (${OUTPUT_DIR}) ===`);
console.log('  full-capture.json       - Tum veri');
console.log('  cookies-before.json     - Login oncesi cookie');
console.log('  cookies.json            - Login sonrasi cookie');
console.log('  auth.json               - Playwright storageState');
console.log('  network-requests.json   - Tum network istekleri');
console.log('  set-cookie-responses.json - Set-Cookie header\'lari');
console.log('  api-responses.json      - API yanitlari');
console.log(`\nCookie sayisi: ${captured.cookiesBefore.length} → ${captured.cookiesAfter.length}`);

const sessionCookies = captured.cookiesAfter.filter(c =>
  c.name.toLowerCase().includes('session') ||
  c.name.toLowerCase().includes('token') ||
  c.name.toLowerCase().includes('auth') ||
  c.name.toLowerCase().includes('sid') ||
  c.name.toLowerCase().includes('jwt') ||
  c.name.toLowerCase().includes('remember') ||
  c.name.toLowerCase().includes('login') ||
  c.name.toLowerCase().includes('access') ||
  c.name.toLowerCase().includes('refresh')
);

const newCookies = captured.cookiesAfter.filter(after =>
  !captured.cookiesBefore.some(before => before.name === after.name && before.value === after.value)
);

console.log(`\n=== ONEMLI COOKIE/TOKEN ANALIZI ===`);
console.log(`Yeni cookie'ler (login sirasinda eklenen): ${newCookies.length}`);
for (const c of newCookies.sort((a, b) => (b.expires || 9999999999) - (a.expires || 9999999999))) {
  const expiresStr = c.expires
    ? new Date(c.expires * 1000).toISOString()
    : 'Session';
  const daysLeft = c.expires
    ? Math.round((c.expires * 1000 - Date.now()) / 86400000)
    : 'N/A';
  console.log(`  [${c.name}] domain=${c.domain} path=${c.path} httpOnly=${c.httpOnly} secure=${c.secure} expires=${expiresStr} (${daysLeft} gun)`);
}

console.log(`\nSession/token cookie'leri:`);
for (const c of sessionCookies) {
  const expiresStr = c.expires
    ? new Date(c.expires * 1000).toISOString()
    : 'Session';
  console.log(`  ${c.name} = ${c.value.substring(0, 50)}... expires=${expiresStr}`);
}

console.log('\n=== LOCALSTORAGE ===');
const lsAfter = captured.localStorageAfter;
for (const [key, val] of Object.entries(lsAfter)) {
  if (!captured.localStorageBefore[key] || captured.localStorageBefore[key] !== val) {
    console.log(`  [NEW] ${key} = ${String(val).substring(0, 200)}`);
  }
}

await context.close();
await browser.close();
