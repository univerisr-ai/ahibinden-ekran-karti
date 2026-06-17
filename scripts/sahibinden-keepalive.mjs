/**
 * Sahibinden Session Keepalive
 * - Camoufox WebSocket uzerinden baglanir
 * - Kayitli cookie'leri yukler
 * - Bana Ozel sayfasini ziyaret ederek session yeniler
 * - Guncellenmis storage state'i kaydeder
 */
import { chromium, firefox } from 'playwright';
import { loadSahibindenStorageState } from '../src/session_state.mjs';
import { loadAllSahibindenCookies } from '../src/cookies.mjs';
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WS_ENDPOINT = String(process.env.CAMOUFOX_WS_ENDPOINT || '').trim();
const STATE_FILE = process.env.SAHIBINDEN_STORAGE_STATE_FILE || '.playwright/storage-state.json';

async function main() {
  if (!WS_ENDPOINT) {
    console.log('CAMOUFOX_WS_ENDPOINT bulunamadi, Chromium ile devam ediliyor...');
  }

  let browser, context, page;

  try {
    if (WS_ENDPOINT) {
      console.log(`Camoufox server'a baglaniliyor: ${WS_ENDPOINT}`);
      browser = await firefox.connect(WS_ENDPOINT);
    } else {
      console.log('Chromium baslatiliyor...');
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      });
    }
    console.log('Tarayici hazir.');

    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1366, height: 900 },
      locale: 'tr-TR',
      timezoneId: 'Europe/Istanbul',
    });
    page = await context.newPage();

    // Cookie yukle
    const saved = loadSahibindenStorageState();
    if (saved.storageState && saved.cookieCount > 0) {
      await context.addCookies(saved.storageState.cookies);
      console.log(`${saved.cookieCount} cookie yuklendi (kaynak: ${saved.source}).`);
    }
    const extra = loadAllSahibindenCookies();
    if (extra.length > 0) {
      await context.addCookies(extra);
      console.log(`${extra.length} ek cookie yuklendi.`);
    }

    // Ana sayfaya git
    console.log('Ana sayfaya gidiliyor...');
    await page.goto('https://www.sahibinden.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(3000);

    const url = page.url();
    console.log(`Sayfa: ${url}`);

    // Bana Ozel'e git
    console.log('Bana Ozel sayfasina gidiliyor...');
    try {
      await page.goto('https://banaozel.sahibinden.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await sleep(3000);
    } catch (e) {
      console.log(`Bana Ozel gecis hatasi: ${e.message}`);
    }

    const finalUrl = page.url();
    console.log(`Son sayfa: ${finalUrl}`);

    if (finalUrl.includes('banaozel')) {
      console.log('Session aktif, cookie\'ler guncelleniyor...');
    } else if (finalUrl.includes('giris')) {
      console.log('Login sayfasi - session gecersiz olabilir.');
    }

    // Storage state kaydet
    const rawState = await context.storageState();
    const dir = path.dirname(STATE_FILE);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(rawState, null, 2), 'utf-8');
    console.log(`Storage state kaydedildi: ${STATE_FILE} (${rawState.cookies.length} cookie)`);

    // Cookie expiry kontrolu
    const now = Math.floor(Date.now() / 1000);
    let minExpiry = Infinity;
    for (const c of rawState.cookies) {
      if (c.expires && c.expires > 0) {
        const days = Math.round((c.expires - now) / 86400);
        if (days < minExpiry) minExpiry = days;
        if (['csid', 'cwt', 'st'].includes(c.name)) {
          console.log(`  Cookie ${c.name}: ${days} gun kaldi (${new Date(c.expires * 1000).toISOString()})`);
        }
      }
    }

    if (minExpiry < 7) {
      console.log(`UYARI: En kisa cookie suresi ${minExpiry} gun!`);
    } else {
      console.log(`Cookie\'ler en az ${minExpiry} gun daha gecerli.`);
    }

    console.log('Keepalive basarili.');
  } catch (err) {
    console.error(`Keepalive hatasi: ${err.message}`);
    process.exit(1);
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main();
