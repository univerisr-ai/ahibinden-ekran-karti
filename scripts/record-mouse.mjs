import 'dotenv/config';
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SIMULATOR_URL = 'file:///' + resolve(ROOT, 'local-challenge-simulator.html').replace(/\\/g, '/');
const OUTPUT_PATH = resolve(process.cwd(), process.env.MOUSE_RECORDING_OUTPUT || 'mouse-recording.json');
const POLL_MS = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForEnter(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('Terminal interaktif degil. Kayit otomatik durdurulamayacak.');
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function main() {
  const outputPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : OUTPUT_PATH;
  const targetUrl = process.argv[3] || SIMULATOR_URL;
  const isSimulator = targetUrl === SIMULATOR_URL || targetUrl.includes('local-challenge-simulator');

  console.log('Mouse hareketi kaydedici baslatiliyor...');
  console.log(`Hedef sayfa: ${targetUrl}`);
  console.log(`Cikis dosyasi: ${outputPath}`);
  console.log('');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,900',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || {};
  });

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);

  // Sayfa icinde fare kaydediciyi baslat
  await page.evaluate((isSim) => {
    window.__mouseRecorder = {
      startAt: performance.now(),
      events: [],
      verified: false,
    };

    const push = (type, e) => {
      window.__mouseRecorder.events.push({
        type,
        t: Math.round(performance.now() - window.__mouseRecorder.startAt),
        x: e.clientX,
        y: e.clientY,
        sx: window.scrollX,
        sy: window.scrollY,
        button: e.button === 0 ? 'left' : e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left',
      });
    };

    document.addEventListener('mousemove', (e) => push('move', e), { passive: true });
    document.addEventListener('mousedown', (e) => push('down', e), { passive: true });
    document.addEventListener('mouseup', (e) => push('up', e), { passive: true });

    if (isSim) {
      window.addEventListener('simulator:verified', () => {
        window.__mouseRecorder.verified = true;
      });
    } else {
      // Real site: mark verified if Turnstile-like checkbox is clicked.
      const markVerified = () => { window.__mouseRecorder.verified = true; };
      document.addEventListener('click', (e) => {
        const el = e.target;
        if (
          el && (
            el.id === 'turnstile-checkbox' ||
            el.closest('#turnStileWidget') ||
            el.closest('.cf-turnstile') ||
            el.closest('[class*="turnstile" i]')
          )
        ) {
          markVerified();
        }
      }, { passive: true });
    }
  }, isSimulator);

  console.log('Lutfen tarayici penceresindeki simulasyonu tamamlayin:');
  console.log('  1) "Devam Et" butonuna tiklayin');
  console.log('  2) "Ben robot degilim" kutucuguna tiklayin');
  console.log('  Islemi bitirdikten sonra burada Enter basin.');
  console.log('');

  // verified eventi veya Enter bekleyen iki yarismaci promise
  let verified = false;
  const verifyPromise = (async () => {
    while (!verified) {
      verified = await page.evaluate(() => window.__mouseRecorder.verified).catch(() => false);
      if (verified) return true;
      await sleep(POLL_MS);
    }
    return false;
  })();

  const enterPromise = waitForEnter('Kaydi durdurmak icin Enter basin: ').then(() => false);

  const finishedByVerify = await Promise.race([verifyPromise, enterPromise]);
  if (finishedByVerify) {
    console.log('Simulasyon dogrulama eventi alindi, kayit tamamlaniyor...');
    await sleep(500);
  }

  const recording = await page.evaluate(() => ({
    events: window.__mouseRecorder.events,
    verified: window.__mouseRecorder.verified,
    duration: Math.round(performance.now() - window.__mouseRecorder.startAt),
  }));

  const payload = {
    recordedAt: new Date().toISOString(),
    source: SIMULATOR_URL,
    viewport: { width: 1366, height: 900 },
    duration: recording.duration,
    verified: recording.verified,
    eventCount: recording.events.length,
    events: recording.events,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf-8');

  console.log(`\n✅ Kayit kaydedildi: ${outputPath}`);
  console.log(`   Event sayisi: ${recording.events.length}`);
  console.log(`   Sure: ${recording.duration}ms`);
  console.log(`   Doğrulama: ${recording.verified ? 'basarili' : 'manuel durduruldu'}`);

  await browser.close();
}

main().catch((err) => {
  console.error('Hata:', err.message);
  process.exit(1);
});
