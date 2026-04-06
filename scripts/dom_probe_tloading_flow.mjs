import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--no-proxy-server', '--proxy-server=direct://', '--proxy-bypass-list=*'],
});

const page = await browser.newPage();

const snapshot = async (label) => {
  const info = await page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => {
      const r = f.getBoundingClientRect();
      return {
        title: f.getAttribute('title') || '',
        src: f.getAttribute('src') || '',
        id: f.id || '',
        cls: String(f.className || '').slice(0, 80),
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.x),
        y: Math.round(r.y),
      };
    });

    const widget = document.querySelector('#turnStileWidget');
    const widgetRect = widget ? widget.getBoundingClientRect() : null;
    const btn = document.querySelector('#btn-continue');
    const tokenInput = document.querySelector('input[name="cf-turnstile-response"]');

    const body = (document.body?.innerText || '').toLowerCase();

    return {
      url: location.href,
      hasHuman:
        body.includes('gercek kisi oldugunuzu dogrulayin') ||
        body.includes('gerçek kişi olduğunuzu doğrulayın') ||
        body.includes('verify you are human'),
      hasDevamEt: body.includes('devam et'),
      widgetRect: widgetRect
        ? {
            x: Math.round(widgetRect.x),
            y: Math.round(widgetRect.y),
            w: Math.round(widgetRect.width),
            h: Math.round(widgetRect.height),
          }
        : null,
      btn: btn
        ? {
            disabled: !!btn.disabled,
            value: String(btn.value || ''),
          }
        : null,
      tokenLen: tokenInput && typeof tokenInput.value === 'string' ? tokenInput.value.trim().length : -1,
      iframeCount: iframes.length,
      iframes: iframes.slice(0, 12),
    };
  });

  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(info, null, 2));

  try {
    await page.screenshot({ path: `challenge_probe_${label}.png`, fullPage: true });
  } catch (_) {
    // ignore screenshot errors
  }
};

try {
  await page.goto('https://www.sahibinden.com', {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
} catch (_) {
  // continue
}

await page.waitForTimeout(4000);
await snapshot('initial');

try {
  await page.click('#btn-continue', { timeout: 4000, force: true });
  console.log('\nClicked #btn-continue');
} catch (err) {
  console.log('\nCould not click #btn-continue:', err.message);
}

await page.waitForTimeout(2500);
await snapshot('after_continue_2s');

await page.waitForTimeout(5000);
await snapshot('after_continue_7s');

await page.waitForTimeout(6000);
await snapshot('after_continue_13s');

await browser.close();
