import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--no-proxy-server', '--proxy-server=direct://', '--proxy-bypass-list=*'],
});

const page = await browser.newPage();

try {
  await page.goto('https://www.sahibinden.com', {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
} catch (_) {
  // Continue to inspect whatever is loaded.
}

await page.waitForTimeout(5000);

const info = await page.evaluate(() => {
  const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => {
    const r = f.getBoundingClientRect();
    return {
      title: f.getAttribute('title') || '',
      src: f.getAttribute('src') || '',
      w: Math.round(r.width),
      h: Math.round(r.height),
      x: Math.round(r.x),
      y: Math.round(r.y),
    };
  });

  const candidates = [
    '#turnStileWidget',
    '#turnstileWidget',
    '[id*=turnstile i]',
    '[class*=turnstile i]',
    'input[name="cf-turnstile-response"]',
    '#btn-continue',
    'button',
    'a',
  ];

  const matched = [];
  for (const sel of candidates) {
    const nodes = Array.from(document.querySelectorAll(sel));
    matched.push({
      sel,
      count: nodes.length,
      sample: nodes.slice(0, 4).map((n) => {
        const r = n.getBoundingClientRect();
        return {
          tag: n.tagName,
          id: n.id || '',
          cls: String(n.className || '').slice(0, 120),
          txt: (n.innerText || n.value || '').trim().slice(0, 80),
          disabled: n.disabled === true,
          w: Math.round(r.width),
          h: Math.round(r.height),
          x: Math.round(r.x),
          y: Math.round(r.y),
        };
      }),
    });
  }

  const body = (document.body?.innerText || '').toLowerCase();

  return {
    url: location.href,
    hasHuman:
      body.includes('gercek kisi oldugunuzu dogrulayin') ||
      body.includes('gerçek kişi olduğunuzu doğrulayın') ||
      body.includes('verify you are human'),
    hasDevamEt: body.includes('devam et'),
    iframeCount: iframes.length,
    iframes: iframes.slice(0, 10),
    matched,
  };
});

console.log('URL=', page.url());
console.log(JSON.stringify(info, null, 2));

try {
  await page.screenshot({ path: 'challenge_dom_probe.png', fullPage: true });
} catch (_) {
  // Ignore screenshot errors.
}

await browser.close();
