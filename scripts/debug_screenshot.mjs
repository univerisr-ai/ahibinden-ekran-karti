import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--ignore-certificate-errors',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    await page.goto('https://www.sahibinden.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  } catch (e) {
    console.log('Goto timeout/error, continuing...', e.message);
  }

  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'debug_0_initial.png' });

  // Click Devam Et
  const devamEt = page.locator('#btn-continue');
  if (await devamEt.isVisible()) {
    console.log('Clicking Devam Et');
    await devamEt.click({ force: true });
  }

  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'debug_1_after_devam_et.png' });

  // Locate iframes
  const iframes = page.locator('iframe');
  const count = await iframes.count();
  console.log('Found iframes:', count);
  
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const iframe = iframes.nth(i);
    const src = await iframe.getAttribute('src') || '';
    console.log(`Iframe ${i} src: ${src.substring(0, 50)}`);
    
    // Turnstile iframe
    if (src.includes('turnstile') || src.includes('cloudflare') || src.includes('challenge')) {
      console.log('Found turnstile/challenge iframe! Taking interaction...');
      
      const box = await iframe.boundingBox();
      if (box) {
        console.log('Box coordinates:', box);
        // Turnstile checkboxes are usually on the left side of the iframe.
        // Let's click around x: 25-35, y: center
        const clickX = box.x + 30;
        const clickY = box.y + (box.height / 2);
        
        await page.mouse.move(clickX, clickY, { steps: 5 });
        await page.waitForTimeout(200);
        await page.mouse.down();
        await page.waitForTimeout(100);
        await page.mouse.up();
        
        console.log(`Clicked at ${clickX}, ${clickY}`);
        clicked = true;
      }
    }
  }

  if (!clicked) {
    console.log('No specific challenge iframe found or bounding box missing. Clicking absolute center of #turnStileWidget as fallback.');
    const tw = page.locator('#turnStileWidget');
    if (await tw.isVisible()) {
      const tbox = await tw.boundingBox();
      if (tbox) {
         // Fallback inside target div
         await page.mouse.click(tbox.x + 30, tbox.y + tbox.height / 2);
      }
    }
  }

  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'debug_2_after_click.png' });

  const token = await page.evaluate(() => {
    const input = document.querySelector('input[name="cf-turnstile-response"]');
    return input ? input.value : null;
  });

  console.log('Token length:', token ? token.length : 0);

  await browser.close();
})();
