import { chromium } from 'playwright';
import fs from 'fs';

const wsEndpoint = process.env.CAMOUFOX_WS_ENDPOINT;
if (!wsEndpoint) { console.error('CAMOUFOX_WS_ENDPOINT gerekli'); process.exit(1); }

const browser = await chromium.connectOverCDP(wsEndpoint);
const context = await browser.newContext({ locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
const page = await context.newPage();

await page.goto('https://www.sahibinden.com/giris', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

const title = await page.title();
const url = page.url();
console.log(`Title: ${title}`);
console.log(`URL: ${url}`);
const blocked = url.includes('challenge') || url.includes('captcha') || url.includes('error');
console.log(`Blocked: ${blocked}`);

await page.screenshot({ path: 'test-sahibinden-giris.png', fullPage: true });
console.log('Screenshot: test-sahibinden-giris.png');

await context.close();
await browser.close();
