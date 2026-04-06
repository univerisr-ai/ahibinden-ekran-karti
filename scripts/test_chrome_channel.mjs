import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: [
      '--ignore-certificate-errors',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const page = await browser.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    await page.goto('https://www.sahibinden.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  } catch (e) {}

  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'chrome_debug.png' });
  
  await browser.close();
})();
