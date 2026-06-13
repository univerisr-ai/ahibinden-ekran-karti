import 'dotenv/config';
import { chromium } from 'playwright';
import { readFile, existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const readFileAsync = promisify(readFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEFAULT_RECORDING = resolve(process.cwd(), 'mouse-recording.json');
const DEFAULT_SIMULATOR_URL = 'file:///' + resolve(ROOT, 'local-challenge-simulator.html').replace(/\\/g, '/');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadRecording(path) {
  const raw = await readFileAsync(path, 'utf-8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.events)) {
    throw new Error('Kayit dosyasinda events dizisi bulunamadi.');
  }
  return data;
}

async function replayEvents(page, events, startTime) {
  const pendingButtons = new Set();

  for (const ev of events) {
    const targetTime = startTime + ev.t;
    const wait = targetTime - Date.now();
    if (wait > 0) {
      await sleep(wait);
    }

    const { type, x, y, button = 'left' } = ev;

    if (type === 'move') {
      await page.mouse.move(x, y);
    } else if (type === 'down') {
      await page.mouse.down({ button });
      pendingButtons.add(button);
    } else if (type === 'up') {
      await page.mouse.up({ button });
      pendingButtons.delete(button);
    }
  }

  // Eksik kalan down eventleri varsa serbest birak
  for (const button of pendingButtons) {
    await page.mouse.up({ button });
  }
}

async function main() {
  const recordingPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_RECORDING;
  const urlOverride = process.argv[3];

  if (!existsSync(recordingPath)) {
    console.error(`Kayit dosyasi bulunamadi: ${recordingPath}`);
    console.error('Kullanim: node scripts/replay-mouse.mjs [kayit.json] [url]');
    process.exit(1);
  }

  const recording = await loadRecording(recordingPath);
  const targetUrl = urlOverride || recording.source || DEFAULT_SIMULATOR_URL;

  console.log('Mouse hareketi oynatici baslatiliyor...');
  console.log(`Kayit: ${recordingPath}`);
  console.log(`Hedef: ${targetUrl}`);
  console.log(`Event sayisi: ${recording.events.length}`);
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

  const startTime = Date.now();
  await replayEvents(page, recording.events, startTime);

  await page.waitForTimeout(2000);

  // Simulasyon sayfasinda dogrulama durumunu kontrol et
  const verified = await page.evaluate(() => {
    const cb = document.getElementById('turnstile-checkbox');
    return cb ? cb.classList.contains('checked') : null;
  }).catch(() => null);

  if (verified === true) {
    console.log('✅ Simulatör dogrulamasi basarili.');
  } else if (verified === false) {
    console.log('⚠️ Simulatör dogrulamasi tamamlanmadi.');
  } else {
    console.log('ℹ️ Hedef sayfada dogrulama durumu okunamadi.');
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Hata:', err.message);
  process.exit(1);
});
