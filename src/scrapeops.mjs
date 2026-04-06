/**
 * SCRAPEOPS.MJS — Canli Tarayici + Scrape.do Proxy Motoru
 * - Playwright Chromium (headless false varsayilan)
 * - Scrape.do Proxy Mode (auth + parametre)
 * - Cloudflare challenge icin manuel "Basili Tutun" bekleme dongusu
 */
import {
  MAX_CREDITS_PER_RUN,
  MAX_RETRIES,
  REQUEST_DELAY_MS,
  ITEMS_PER_PAGE,
  BASE_URL,
  MAX_PAGES_PER_SEGMENT,
} from './config.mjs';
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const USE_WARP_PROXY = (process.env.USE_WARP_PROXY || 'false').toLowerCase() === 'true';

const USE_SCRAPEDO_PROXY = (process.env.USE_SCRAPEDO_PROXY || 'false').toLowerCase() === 'true';
// ScrapingAnt Proxy Ayarları (Germany Residential / Ev IP'si)
const SCRAPEDO_TOKEN = process.env.SCRAPEDO_TOKEN || 'scrapingant&browser=false&proxy_type=residential&proxy_country=de'; // ScrapingAnt Username (Ayarlar) Almanya
const SCRAPEDO_PROXY_SERVER = process.env.SCRAPEDO_PROXY_SERVER || 'http://proxy.scrapingant.com:8080';
const SCRAPEDO_PROXY_PARAMS =
  process.env.SCRAPEDO_PROXY_PARAMS ||
  'cee42f01acbd4930a48dd3577d673468'; // ScrapingAnt API Token şifre (password) olarak girilir.


const DEFAULT_NAV_TIMEOUT_MS = parseInt(process.env.NAV_TIMEOUT_MS || '90000', 10);
const CHALLENGE_WAIT_MS = parseInt(process.env.CHALLENGE_WAIT_MS || '180000', 10);
const CHALLENGE_CLICK_INTERVAL_MS = parseInt(process.env.CHALLENGE_CLICK_INTERVAL_MS || '3500', 10);
const CHALLENGE_RELOAD_INTERVAL_MS = parseInt(process.env.CHALLENGE_RELOAD_INTERVAL_MS || '20000', 10);
const CHECKBOX_SETTLE_MS = parseInt(process.env.CHECKBOX_SETTLE_MS || '2200', 10);
const TLOADING_MAX_RELOADS = parseInt(process.env.TLOADING_MAX_RELOADS || '2', 10);
const TLOADING_STUCK_RELOAD_MS = parseInt(process.env.TLOADING_STUCK_RELOAD_MS || '14000', 10);
const TURNSTILE_TOKEN_MIN_LEN = parseInt(process.env.TURNSTILE_TOKEN_MIN_LEN || '20', 10);
const TLOADING_MANUAL_GRACE_MS = parseInt(process.env.TLOADING_MANUAL_GRACE_MS || '18000', 10);
const TLOADING_CONTINUE_STABLE_MS = parseInt(process.env.TLOADING_CONTINUE_STABLE_MS || '5000', 10);
const TLOADING_POSTLOCK_CLICK_COOLDOWN_MS = parseInt(
  process.env.TLOADING_POSTLOCK_CLICK_COOLDOWN_MS || '4500',
  10,
);

const CONTINUE_BUTTON_SELECTORS = [
  'button:has-text("Devam Et")',
  'a:has-text("Devam Et")',
  'input[value*="Devam Et"]',
  'button.btn.btn-secondary',
  '#js-submit-button',
];

let browser = null;
let context = null;
let page = null;
let hardStopStatus = null;

let stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  pagesLoaded: 0,
  creditsUsed: 0,
};

export function getStats() {
  return { ...stats };
}

function isChallengePage(html = '', currentUrl = '') {
  const h = String(html || '').toLowerCase();
  const u = String(currentUrl || '').toLowerCase();
  return (
    u.includes('/cs/hloading') ||
    u.includes('/cs/tloading') ||
    h.includes('baglantiniz kontrol ediliyor') ||
    h.includes('ba\u011flant\u0131n\u0131z kontrol ediliyor') ||
    h.includes('tarayicinizi kontrol ediyoruz') ||
    h.includes('tarayıcınızı kontrol ediyoruz') ||
    h.includes('devam et butonuna') ||
    h.includes('devam et') ||
    h.includes('basili tutun') ||
    h.includes('bas\u0131l\u0131 tutun') ||
    h.includes('guvenlik dogrulamasi gerceklestirme') ||
    h.includes('güvenlik doğrulaması gerçekleştirme') ||
    h.includes('gercek kisi oldugunuzu dogrulayin') ||
    h.includes('gerçek kişi olduğunuzu doğrulayın') ||
    h.includes('just a moment') ||
    h.includes('challenge-platform') ||
    h.includes('cf-chl')
  );
}

function isTLoadingPage(html = '', currentUrl = '') {
  const h = String(html || '').toLowerCase();
  const u = String(currentUrl || '').toLowerCase();
  return (
    u.includes('/cs/tloading') ||
    h.includes('tarayicinizi kontrol ediyoruz') ||
    h.includes('tarayıcınızı kontrol ediyoruz') ||
    h.includes('devam et butonuna') ||
    h.includes('devam et')
  );
}

function hasHumanVerificationHint(html = '') {
  const h = String(html || '').toLowerCase();
  return (
    h.includes('gercek kisi oldugunuzu dogrulayin') ||
    h.includes('gerçek kişi olduğunuzu doğrulayın') ||
    h.includes('gerçek bir insan') ||
    h.includes('gercek bir insan') ||
    h.includes('verify you are human') ||
    h.includes('i am human')
  );
}

async function getTLoadingTurnstileState() {
  if (!page || page.isClosed()) {
    return {
      hasWidget: false,
      widgetRect: null,
      iframeRect: null,
      tokenLen: 0,
      hasTokenInput: false,
      continueDisabled: null,
      continueRect: null,
      hasHumanText: false,
      hasTurnstileWord: false,
    };
  }

  try {
    return await page.evaluate(() => {
      const tokenInput = document.querySelector('input[name="cf-turnstile-response"]');
      let widget =
        document.querySelector('#turnStileWidget') ||
        document.querySelector('#turnstileWidget') ||
        document.querySelector('[id*="turnstile" i]') ||
        document.querySelector('[class*="turnstile" i]');

      if (!widget && tokenInput) {
        widget = tokenInput.closest('div');
        if (widget && widget.parentElement && widget.getBoundingClientRect().width < 20) {
          widget = widget.parentElement;
        }
      }

      const continueBtn = document.querySelector('#btn-continue');
      const turnstileIframe = Array.from(document.querySelectorAll('iframe')).find((f) => {
        const title = (f.getAttribute('title') || '').toLowerCase();
        const src = (f.getAttribute('src') || '').toLowerCase();
        return (
          title.includes('turnstile') ||
          title.includes('cloudflare') ||
          title.includes('challenge') ||
          src.includes('turnstile') ||
          src.includes('cloudflare') ||
          src.includes('challenge')
        );
      });
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const htmlLower = (document.documentElement?.innerHTML || '').toLowerCase();

      const rect = widget ? widget.getBoundingClientRect() : null;
      const widgetRect =
        rect && rect.width > 0 && rect.height > 0
          ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
          : null;

      const iframeRectRaw = turnstileIframe ? turnstileIframe.getBoundingClientRect() : null;
      const iframeRect =
        iframeRectRaw && iframeRectRaw.width > 0 && iframeRectRaw.height > 0
          ? { x: iframeRectRaw.x, y: iframeRectRaw.y, w: iframeRectRaw.width, h: iframeRectRaw.height }
          : null;

      const continueRectRaw = continueBtn ? continueBtn.getBoundingClientRect() : null;
      const continueRect =
        continueRectRaw && continueRectRaw.width > 0 && continueRectRaw.height > 0
          ? { x: continueRectRaw.x, y: continueRectRaw.y, w: continueRectRaw.width, h: continueRectRaw.height }
          : null;

      const tokenLen = tokenInput && typeof tokenInput.value === 'string' ? tokenInput.value.trim().length : 0;

      const hasHumanText =
        bodyText.includes('gerçek kişi olduğunuzu doğrulayın') ||
        bodyText.includes('gercek kisi oldugunuzu dogrulayin') ||
        bodyText.includes('gerçek bir insan') ||
        bodyText.includes('gercek bir insan') ||
        bodyText.includes('verify you are human') ||
        bodyText.includes('i am human');

      return {
        hasWidget: !!widget,
        widgetRect,
        iframeRect,
        tokenLen,
        hasTokenInput: !!tokenInput,
        continueDisabled: continueBtn ? !!continueBtn.disabled : null,
        continueRect,
        hasHumanText,
        hasTurnstileWord: htmlLower.includes('turnstile') || htmlLower.includes('cf-turnstile'),
      };
    });
  } catch (_) {
    return {
      hasWidget: false,
      widgetRect: null,
      iframeRect: null,
      tokenLen: 0,
      hasTokenInput: false,
      continueDisabled: null,
      continueRect: null,
      hasHumanText: false,
      hasTurnstileWord: false,
    };
  }
}

function isTLoadingVerificationStage(state) {
  if (!state) return false;

  const widgetVisible = !!(
    state.widgetRect &&
    Number(state.widgetRect.w || 0) > 80 &&
    Number(state.widgetRect.h || 0) > 20
  );

  return (
    state.hasTokenInput === true ||
    state.continueDisabled === true ||
    widgetVisible ||
    state.hasHumanText === true
  );
}

function isTLoadingWidgetActive(state) {
  if (!state) return false;

  const widgetVisible = !!(
    state.widgetRect &&
    Number(state.widgetRect.w || 0) > 80 &&
    Number(state.widgetRect.h || 0) > 20
  );

  return widgetVisible || state.hasHumanText === true || state.continueDisabled === true;
}

async function tryTLoadingContinuePrimingInteraction(currentUrl = '', html = '') {
  if (!page || page.isClosed()) return false;
  if (!isTLoadingPage(html, currentUrl)) return false;

  for (const selector of CONTINUE_BUTTON_SELECTORS) {
    try {
      const candidate = page.locator(selector).first();
      if ((await candidate.count()) === 0) continue;
      if (!(await candidate.isVisible())) continue;
      if (!(await isElementActuallyEnabled(candidate))) continue;

      await candidate.scrollIntoViewIfNeeded();
      const box = await candidate.boundingBox();
      if (box) {
        await humanLikeClickBox(box);
      }

      await candidate.click({ timeout: 2500, force: true });
      console.log('  🖱️ /cs/tloading ön faz için "Devam Et" tıklandı (doğrulama fazı açma).');
      return true;
    } catch (_) {
      // Sıradaki seçiciyi dene
    }
  }

  return false;
}

async function tryTLoadingTurnstileWidgetInteraction(existingState = null) {
  if (!page || page.isClosed()) return false;

  const st = existingState || (await getTLoadingTurnstileState());
  if (!st.widgetRect && !st.iframeRect) return false;

  const clickTargets = [];
  if (st.iframeRect) {
    clickTargets.push({ type: 'iframe', rect: st.iframeRect });
  }
  if (st.widgetRect) {
    clickTargets.push({ type: 'widget', rect: st.widgetRect });
  }

  for (const target of clickTargets) {
    try {
      let baseX = target.rect.x + 24;
      let baseY = target.rect.y + Math.min(34, target.rect.h / 2);

      if (target.type === 'iframe') {
        // Turnstile checkbox çoğunlukla iframe içinde solda konumlanır.
        baseX = target.rect.x + Math.min(34, Math.max(20, target.rect.w * 0.2));
        baseY = target.rect.y + Math.max(18, Math.min(target.rect.h / 2, target.rect.h - 18));
      }

      const x = Math.max(10, baseX + Math.floor(Math.random() * 9) - 4);
      const y = Math.max(10, baseY + Math.floor(Math.random() * 7) - 3);

      await page.mouse.move(Math.max(5, x - 36), Math.max(5, y - 10), { steps: 7 });
      await sleep(120 + Math.floor(Math.random() * 120));
      await page.mouse.move(x, y, { steps: 6 });
      await sleep(60 + Math.floor(Math.random() * 120));
      await page.mouse.down();
      await sleep(55 + Math.floor(Math.random() * 90));
      await page.mouse.up();

      if (target.type === 'iframe') {
        console.log('  ✅ Turnstile iframe hotspot tıklama denendi.');
      } else {
        console.log('  ✅ Turnstile widget hotspot tıklama denendi.');
      }
      return true;
    } catch (_) {
      // Bir sonraki hedefe geç.
    }
  }

  return false;
}

async function tryTLoadingWidgetCheckboxInteraction(existingState = null) {
  if (!page || page.isClosed()) return false;

  const st = existingState || (await getTLoadingTurnstileState());
  if (!st.widgetRect) return false;

  try {
    // Widget içinde checkbox ara ve tıkla.
    const widgetLocator = page.locator('#turnStileWidget');
    if ((await widgetLocator.count()) === 0) return false;

    const checkboxSelectors = [
      'input[type="checkbox"]',
      'div[role="checkbox"]',
      'label:has(input[type="checkbox"])',
    ];

    for (const sel of checkboxSelectors) {
      try {
        const checkbox = widgetLocator.locator(sel).first();
        if ((await checkbox.count()) === 0) continue;
        if (!(await checkbox.isVisible())) continue;

        const box = await checkbox.boundingBox();
        if (box) {
          await humanLikeClickBox(box);
        }

        await checkbox.click({ timeout: 2000, force: true });
        console.log('  ✅ Turnstile widget içinde checkbox tıklandı.');
        return true;
      } catch (_) {
        // Sıradaki selector
      }
    }

    return false;
  } catch (_) {
    return false;
  }
}

async function tryTLoadingRelativeVerificationClick(existingState = null) {
  if (!page || page.isClosed()) return false;

  const st = existingState || (await getTLoadingTurnstileState());
  if (!st.continueRect) return false;

  try {
    // Widget seçici kaçırılırsa, Devam Et butonuna göre doğrulama kutusunun bilinen relatif noktasını dener.
    const x = Math.max(10, st.continueRect.x - 320 + Math.floor(Math.random() * 13) - 6);
    const y = Math.max(10, st.continueRect.y + 90 + Math.floor(Math.random() * 11) - 5);

    await page.mouse.move(Math.max(5, x - 34), Math.max(5, y - 12), { steps: 7 });
    await sleep(100 + Math.floor(Math.random() * 120));
    await page.mouse.move(x, y, { steps: 6 });
    await sleep(60 + Math.floor(Math.random() * 100));
    await page.mouse.down();
    await sleep(55 + Math.floor(Math.random() * 85));
    await page.mouse.up();

    console.log('  ✅ Relatif doğrulama hotspot tıklama denendi.');
    return true;
  } catch (_) {
    return false;
  }
}

async function isElementActuallyEnabled(locator) {
  try {
    if ((await locator.count()) === 0) return false;
    if (!(await locator.isVisible())) return false;

    return await locator.evaluate((el) => {
      const ariaDisabled = String(el.getAttribute('aria-disabled') || '').toLowerCase();
      const dataDisabled = String(el.getAttribute('data-disabled') || '').toLowerCase();
      const className = String(el.className || '').toLowerCase();
      const style = window.getComputedStyle(el);

      if (el.hasAttribute('disabled')) return false;
      if (ariaDisabled === 'true' || dataDisabled === 'true') return false;
      if (className.includes('disabled')) return false;
      if (style.pointerEvents === 'none') return false;
      if (style.visibility === 'hidden' || style.display === 'none') return false;

      return true;
    });
  } catch (_) {
    return false;
  }
}

async function isDevamEtEnabled() {
  if (!page || page.isClosed()) return false;

  for (const selector of CONTINUE_BUTTON_SELECTORS) {
    try {
      const candidate = page.locator(selector).first();
      if (await isElementActuallyEnabled(candidate)) {
        return true;
      }
    } catch (_) {
      // Sıradaki seçiciyi dene
    }
  }

  return false;
}

async function humanLikeClickBox(box) {
  if (!page || !box) return false;

  const jitterX = (Math.random() * 2 - 1) * Math.min(10, box.width * 0.2);
  const jitterY = (Math.random() * 2 - 1) * Math.min(6, box.height * 0.2);
  const x = box.x + box.width / 2 + jitterX;
  const y = box.y + box.height / 2 + jitterY;

  await page.mouse.move(Math.max(5, x - 45), Math.max(5, y - 20), { steps: 8 });
  await sleep(80 + Math.floor(Math.random() * 140));
  await page.mouse.move(x, y, { steps: 7 });
  await sleep(50 + Math.floor(Math.random() * 120));
  await page.mouse.down();
  await sleep(45 + Math.floor(Math.random() * 90));
  await page.mouse.up();
  return true;
}

async function waitForExitFromTLoading(timeoutMs = 6000) {
  if (!page || page.isClosed()) return false;
  try {
    await page.waitForFunction(() => !window.location.pathname.includes('/cs/tloading'), { timeout: timeoutMs });
    return true;
  } catch (_) {
    return false;
  }
}

async function tryTLoadingContinueInteraction(currentUrl = '', html = '') {
  if (!page || page.isClosed()) return false;
  if (!isTLoadingPage(html, currentUrl)) return false;

  for (const selector of CONTINUE_BUTTON_SELECTORS) {
    try {
      const candidate = page.locator(selector).first();
      if ((await candidate.count()) === 0) continue;
      if (!(await candidate.isVisible())) continue;

      if (!(await isElementActuallyEnabled(candidate))) {
        continue;
      }

      await candidate.scrollIntoViewIfNeeded();

      const box = await candidate.boundingBox();
      if (box) {
        await humanLikeClickBox(box);
      }

      try {
        await candidate.click({ timeout: 2500, force: true });
      } catch (_) {
        const handle = await candidate.elementHandle();
        if (handle) {
          await handle.evaluate((el) => {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.click();
          });
        }
      }

      await sleep(1000);
      const movedOn = await waitForExitFromTLoading(7000);
      if (movedOn) {
        console.log('  ✅ "Devam Et" sonrası /cs/tloading aşaması geçildi.');
        return true;
      } else {
        console.log('  ℹ️ "Devam Et" tıklandı fakat hâlâ /cs/tloading sayfasında.');
        return false;
      }
    } catch (_) {
      // Sıradaki seçiciyi dene
    }
  }

  return false;
}

function isRetryMessageVisible(html = '') {
  const h = String(html || '').toLowerCase();
  return (
    h.includes('isleminizi gerceklestiremedik') ||
    h.includes('işleminizi gerçekleştiremedik') ||
    h.includes('lutfen tekrar deneyiniz') ||
    h.includes('lütfen tekrar deneyiniz')
  );
}

async function tryChallengeInteraction() {
  if (!page) return false;

  const selectors = [
    ...CONTINUE_BUTTON_SELECTORS,
    'button:has-text("Basılı Tutun")',
    'button:has-text("Basili Tutun")',
  ];

  for (const selector of selectors) {
    try {
      const candidate = page.locator(selector).first();
      if ((await candidate.count()) === 0) continue;
      if (!(await candidate.isVisible())) continue;

      if (selector.includes('Devam Et') && !(await isElementActuallyEnabled(candidate))) {
        continue;
      }

      await candidate.click({ timeout: 2000, force: true });
      console.log('  🖱️ Challenge adımı için butona tıklandı.');
      await sleep(1200);
      return true;
    } catch (_) {
      // Sıradaki seçiciyi dene
    }
  }

  return false;
}

async function tryCloudflareCheckboxInteraction() {
  if (!page) return false;

  const directSelectors = [
    'input[type="checkbox"]',
    'input[type="checkbox"][aria-label*="Gercek"]',
    'input[type="checkbox"][aria-label*="Verify"]',
    'div[role="checkbox"]',
    'label:has(input[type="checkbox"])',
    'label:has-text("Gerçek kişi olduğunuzu doğrulayın")',
    'label:has-text("Gercek kisi oldugunuzu dogrulayin")',
  ];

  for (const selector of directSelectors) {
    try {
      const target = page.locator(selector).first();
      if ((await target.count()) === 0) continue;
      if (!(await target.isVisible())) continue;

      const box = await target.boundingBox();
      if (box) {
        await humanLikeClickBox(box);
      }

      await target.click({ timeout: 2000, force: true });
      console.log('  ✅ Cloudflare doğrulama kutusuna tıklandı (ana sayfa).');
      await sleep(1200);
      return true;
    } catch (_) {
      // Sıradaki seçiciyi dene
    }
  }

  try {
    const iframes = page.locator('iframe');
    const iframeCount = await iframes.count();

    for (let i = 0; i < iframeCount; i++) {
      const iframeEl = iframes.nth(i);
      const title = ((await iframeEl.getAttribute('title')) || '').toLowerCase();
      const src = ((await iframeEl.getAttribute('src')) || '').toLowerCase();
      const looksLikeChallenge =
        title.includes('cloudflare') ||
        title.includes('turnstile') ||
        title.includes('challenge') ||
        src.includes('cloudflare') ||
        src.includes('turnstile') ||
        src.includes('challenge');

      const frameHandle = await iframeEl.elementHandle();
      if (!frameHandle) continue;
      const frame = await frameHandle.contentFrame();
      if (!frame) continue;

      const frameSelectors = ['input[type="checkbox"]', 'div[role="checkbox"]', 'label'];
      let clicked = false;

      for (const selector of frameSelectors) {
        try {
          const target = frame.locator(selector).first();
          if ((await target.count()) === 0) continue;
          if (!(await target.isVisible())) continue;
          await target.click({ timeout: 2000, force: true });
          console.log('  ✅ Cloudflare doğrulama kutusuna tıklandı (iframe).');
          await sleep(1200);
          clicked = true;
          break;
        } catch (_) {
          // Sıradaki seçiciyi dene
        }
      }

      if (clicked) return true;

      if (looksLikeChallenge) {
        try {
          const box = await iframeEl.boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            console.log('  ✅ Challenge iframe merkezine tıklandı.');
            await sleep(1200);
            return true;
          }
        } catch (_) {
          // Merkez tıklama başarısızsa sıradaki iframe
        }
      }
    }
  } catch (_) {
    // iframe taraması başarısız olabilir, sessiz geç
  }

  return false;
}

async function tryTextHintCheckboxInteraction() {
  if (!page) return false;

  const hintTexts = [
    'Gerçek kişi olduğunuzu doğrulayın',
    'Gercek kisi oldugunuzu dogrulayin',
    'gerçek bir insan',
    'gercek bir insan',
    'Verify you are human',
    'I am human',
  ];

  for (const hint of hintTexts) {
    try {
      const label = page.getByText(hint, { exact: false }).first();
      if ((await label.count()) === 0) continue;
      if (!(await label.isVisible())) continue;

      const box = await label.boundingBox();
      if (!box) continue;

      // Turnstile checkbox genelde metnin solunda bulunur.
      const offsets = [30, 26, 22];
      const clickY = box.y + Math.min(box.height * 0.5, 20);
      for (const offset of offsets) {
        const clickX = Math.max(10, box.x - offset);
        await page.mouse.click(clickX, clickY);
        await sleep(250);
      }

      console.log('  ✅ Metin-ankorlu koordinat ile doğrulama kutusu tıklama denendi.');
      await sleep(1200);
      return true;
    } catch (_) {
      // Sonraki metin adayı
    }
  }

  return false;
}

function checkScrapeErrors(html) {
  const h = String(html || '');
  const hl = h.toLowerCase();

  if (hl.includes('action required') && hl.includes('support@scrape.do')) {
    return 'ACTION_REQUIRED';
  }

  if (
    h.includes('This account has been banned') ||
    h.includes('You have used 100% of your ScrapeOps proxy credits')
  ) {
    return 'BANNED';
  }

  if (
    h.includes('ERR_NO_SUPPORTED_PROXIES') || 
    h.includes('Bu siteye ula\u015f\u0131lam\u0131yor') || 
    hl.includes('failed to get successful response from website') ||
    hl.includes('our browser was detected by target site') ||
    hl.includes('concurrency limit reached')
  ) {
    return 'PROXY_ERROR';
  }

  if (isChallengePage(h)) {
    return 'CLOUDFLARE';
  }

  if (h.includes('error-page-container')) {
    return 'BLOCK_SAHIBINDEN';
  }

  if (!h.includes('searchResultsItem') && h.length < 5000) {
    return 'INVALID';
  }

  return 'OK';
}

async function waitForChallengeSolve(maxWaitMs = CHALLENGE_WAIT_MS) {
  if (!page) {
    return { solved: false, html: '', url: '' };
  }

  const started = Date.now();
  let lastLogSec = -1;
  let lastInteractionTs = 0;
  let lastReloadTs = 0;
  let tloadingReloadCount = 0;
  let lastCheckboxTs = 0;
  let lastProgressTs = Date.now();
  let lastStateSig = '';
  let lastTLoadingPassiveLogTs = 0;
  let sawTLoadingVerificationLock = false;
  let tloadingNoTokenCycles = 0;
  let manualWindowUntil = 0;
  let lastManualWindowLogTs = 0;
  let continueOpenSince = 0;
  let lastPostLockContinueTs = 0;

  while (Date.now() - started < maxWaitMs) {
    await sleep(1500);

    if (!page || page.isClosed()) {
      return { solved: false, html: '', url: '' };
    }

    const currentUrl = page.url();
    let html = '';
    try {
      html = await page.content();
    } catch (_) {
      return { solved: false, html: '', url: currentUrl };
    }

    if (!isChallengePage(html, currentUrl)) {
      return { solved: true, html, url: currentUrl };
    }

    const now = Date.now();

    const stateSig = [
      currentUrl,
      isTLoadingPage(html, currentUrl) ? 'T' : 'N',
      hasHumanVerificationHint(html) ? 'H1' : 'H0',
      isRetryMessageVisible(html) ? 'R1' : 'R0',
      String(html.length),
    ].join('|');

    if (stateSig !== lastStateSig) {
      lastStateSig = stateSig;
      lastProgressTs = now;
    }

    const isTLoading = isTLoadingPage(html, currentUrl);

    if (now - lastInteractionTs >= CHALLENGE_CLICK_INTERVAL_MS) {
      if (isTLoading) {
        if (now < manualWindowUntil) {
          if (now - lastManualWindowLogTs >= 5000) {
            const remain = Math.max(0, Math.ceil((manualWindowUntil - now) / 1000));
            console.log(`  ⏸️ /cs/tloading: manuel doğrulama penceresi açık (${remain} sn).`);
            lastManualWindowLogTs = now;
          }

          lastInteractionTs = now;
          continue;
        }

        // /cs/tloading iki fazlıdır: önce Devam Et ile doğrulama sahnesini aç, sonra Turnstile tamamla.
        let tloadingStateBefore = await getTLoadingTurnstileState();
        let verificationStage = isTLoadingVerificationStage(tloadingStateBefore);

        if (
          !verificationStage &&
          tloadingStateBefore.continueDisabled === false
        ) {
          const primed = await tryTLoadingContinuePrimingInteraction(currentUrl, html);
          if (primed) {
            lastProgressTs = Date.now();
            await sleep(1400);
            tloadingStateBefore = await getTLoadingTurnstileState();
            verificationStage = isTLoadingVerificationStage(tloadingStateBefore);
          }
        }

        if (tloadingStateBefore.continueDisabled === true || tloadingStateBefore.hasTokenInput) {
          sawTLoadingVerificationLock = true;
        }

        const clickedCheckbox = verificationStage ? await tryCloudflareCheckboxInteraction() : false;
        const clickedWidgetCheckbox =
          verificationStage && !clickedCheckbox ? await tryTLoadingWidgetCheckboxInteraction(tloadingStateBefore) : false;
        const clickedTextAnchor =
          verificationStage && !(clickedCheckbox || clickedWidgetCheckbox) ? await tryTextHintCheckboxInteraction() : false;

        let clickedWidget = false;
        let clickedRelative = false;
        if (
          verificationStage &&
          !(clickedCheckbox || clickedWidgetCheckbox || clickedTextAnchor) &&
          tloadingStateBefore.hasWidget &&
          tloadingStateBefore.continueDisabled !== false
        ) {
          clickedWidget = await tryTLoadingTurnstileWidgetInteraction(tloadingStateBefore);
        }

        if (
          verificationStage &&
          !(clickedCheckbox || clickedWidgetCheckbox || clickedTextAnchor || clickedWidget) &&
          tloadingStateBefore.hasTurnstileWord &&
          tloadingStateBefore.continueDisabled !== false
        ) {
          clickedRelative = await tryTLoadingRelativeVerificationClick(tloadingStateBefore);
        }

        if (clickedWidget || clickedRelative || clickedCheckbox || clickedTextAnchor || clickedWidgetCheckbox) {
          lastCheckboxTs = Date.now();
          await sleep(CHECKBOX_SETTLE_MS);

          const tloadingStateAfter = await getTLoadingTurnstileState();
          const tokenAdvanced = (tloadingStateAfter.tokenLen || 0) > (tloadingStateBefore.tokenLen || 0);
          const continueUnlocked = tloadingStateAfter.continueDisabled === false;

          if (tokenAdvanced || continueUnlocked) {
            lastProgressTs = Date.now();
          }
        }

        try {
          html = await page.content();
        } catch (_) {
          return { solved: false, html: '', url: currentUrl };
        }

        if (!isChallengePage(html, page.url())) {
          return { solved: true, html, url: page.url() };
        }

        const tloadingStateNow = await getTLoadingTurnstileState();
        if (tloadingStateNow.continueDisabled === true || tloadingStateNow.hasTokenInput) {
          sawTLoadingVerificationLock = true;
        }

        if (sawTLoadingVerificationLock && tloadingStateNow.tokenLen < TURNSTILE_TOKEN_MIN_LEN) {
          tloadingNoTokenCycles += 1;
        } else {
          tloadingNoTokenCycles = 0;
        }

        if (sawTLoadingVerificationLock && tloadingNoTokenCycles >= 4) {
          manualWindowUntil = Date.now() + TLOADING_MANUAL_GRACE_MS;
          tloadingNoTokenCycles = 0;
          console.log('  ⏸️ Turnstile token oluşmadı; kısa manuel doğrulama penceresi açıldı.');
        }

        const tokenReady = tloadingStateNow.tokenLen >= TURNSTILE_TOKEN_MIN_LEN;
        const widgetActiveNow = isTLoadingWidgetActive(tloadingStateNow);
        const continueUiEnabled =
          tloadingStateNow.continueDisabled === false ||
          (await isDevamEtEnabled());

        const decisionNow = Date.now();
        if (sawTLoadingVerificationLock && continueUiEnabled && !widgetActiveNow) {
          if (continueOpenSince === 0) {
            continueOpenSince = decisionNow;
          }
        } else {
          continueOpenSince = 0;
        }

        const continueStableReady =
          continueOpenSince > 0 &&
          decisionNow - continueOpenSince >= TLOADING_CONTINUE_STABLE_MS;

        const devamEtEnabled = sawTLoadingVerificationLock
          ? continueUiEnabled && (tokenReady || continueStableReady)
          : continueUiEnabled;

        if (
          sawTLoadingVerificationLock &&
          devamEtEnabled &&
          decisionNow - lastPostLockContinueTs >= TLOADING_POSTLOCK_CLICK_COOLDOWN_MS
        ) {
          lastPostLockContinueTs = decisionNow;
          const clickedContinue = await tryTLoadingContinueInteraction(page.url(), html);
          if (clickedContinue) {
            lastProgressTs = Date.now();
            await sleep(1200);
          }
        } else if (!sawTLoadingVerificationLock && devamEtEnabled) {
          const primed = await tryTLoadingContinuePrimingInteraction(page.url(), html);
          if (primed) {
            lastProgressTs = Date.now();
            await sleep(900);
          }
        } else if (now - lastTLoadingPassiveLogTs >= 10000) {
          console.log(
            `  ℹ️ /cs/tloading: DevamEtDisabled=${tloadingStateNow.continueDisabled ? 1 : 0}, tokenLen=${tloadingStateNow.tokenLen}, stageLock=${sawTLoadingVerificationLock ? 1 : 0}, widget=${tloadingStateNow.hasWidget ? 1 : 0}, widgetActive=${widgetActiveNow ? 1 : 0}, contStableSec=${continueOpenSince > 0 ? Math.floor((decisionNow - continueOpenSince) / 1000) : 0}, noTokenCycles=${tloadingNoTokenCycles}.`,
          );
          lastTLoadingPassiveLogTs = now;
        }
      } else {
        const clickedCheckbox = await tryCloudflareCheckboxInteraction();
        const clickedTextAnchor = clickedCheckbox ? false : await tryTextHintCheckboxInteraction();
        const clickedButton = await tryChallengeInteraction();

        if (clickedCheckbox || clickedTextAnchor) {
          await sleep(CHECKBOX_SETTLE_MS);
          lastProgressTs = Date.now();
        }

        if (clickedButton) {
          await sleep(1200);
          lastProgressTs = Date.now();
        }
      }

      lastInteractionTs = now;

      try {
        html = await page.content();
      } catch (_) {
        return { solved: false, html: '', url: currentUrl };
      }
    }

    const postActionUrl = page.url();
    const postActionNow = Date.now();
    const stillTLoading = isTLoadingPage(html, postActionUrl);

    if (stillTLoading) {
      const allowReloadInTLoading = !sawTLoadingVerificationLock && postActionNow >= manualWindowUntil;
      const shouldReloadTLoading =
        allowReloadInTLoading &&
        tloadingReloadCount < TLOADING_MAX_RELOADS &&
        postActionNow - lastProgressTs >= TLOADING_STUCK_RELOAD_MS &&
        postActionNow - lastReloadTs >= CHALLENGE_RELOAD_INTERVAL_MS &&
        postActionNow - lastCheckboxTs >= CHECKBOX_SETTLE_MS + 1500;

      if (shouldReloadTLoading) {
        try {
          tloadingReloadCount += 1;
          console.log(
            `  🔄 /cs/tloading takıldı, kontrollü yenileme (${tloadingReloadCount}/${TLOADING_MAX_RELOADS}) yapılıyor.`,
          );
          await page.reload({ waitUntil: 'domcontentloaded', timeout: DEFAULT_NAV_TIMEOUT_MS });
          await sleep(1600);
          lastReloadTs = Date.now();
          lastProgressTs = Date.now();
        } catch (err) {
          console.log(`  ⚠️ /cs/tloading yenilenemedi: ${err.message}`);
        }
      }
    }

    if (!stillTLoading && isRetryMessageVisible(html) && postActionNow - lastReloadTs >= CHALLENGE_RELOAD_INTERVAL_MS) {
      try {
        console.log('  🔄 Challenge tekrar deneme mesajı görüldü, sayfa yenileniyor.');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: DEFAULT_NAV_TIMEOUT_MS });
        await sleep(1200);
        lastReloadTs = Date.now();
      } catch (err) {
        console.log(`  ⚠️ Challenge sayfası yenilenemedi: ${err.message}`);
      }
    }

    const leftSec = Math.ceil((maxWaitMs - (Date.now() - started)) / 1000);
    if (leftSec % 15 === 0 && leftSec !== lastLogSec) {
      console.log(`  ⏳ Challenge devam ediyor... kalan ${leftSec} sn`);
      lastLogSec = leftSec;
    }
  }

  let finalHtml = '';
  let finalUrl = '';
  try {
    finalHtml = page && !page.isClosed() ? await page.content() : '';
    finalUrl = page && !page.isClosed() ? page.url() : '';
  } catch (_) {
    // Sayfa kapanmış olabilir
  }

  return {
    solved: false,
    html: finalHtml,
    url: finalUrl,
  };
}

async function ensureBrowser() {
  if (page) {
    return true;
  }

  try {
    const isHeadless = (process.env.HEADLESS || 'false').toLowerCase() === 'true';

    const launchArgs = [
      '--ignore-certificate-errors',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-sandbox',
    ];
    const launchEnv = { ...process.env };

    if (!USE_SCRAPEDO_PROXY && !USE_WARP_PROXY) {
      // Sistem proxy'sini tamamen devre dışı bırak.
      launchArgs.push('--no-proxy-server', '--proxy-server=direct://', '--proxy-bypass-list=*');
      delete launchEnv.HTTP_PROXY;
      delete launchEnv.HTTPS_PROXY;
      delete launchEnv.ALL_PROXY;
      delete launchEnv.http_proxy;
      delete launchEnv.https_proxy;
      delete launchEnv.all_proxy;
    }

    const launchOptions = {
      headless: isHeadless,
      channel: 'chrome',
      args: launchArgs,
      env: launchEnv,
      slowMo: parseInt(process.env.PLAYWRIGHT_SLOWMO_MS || '50', 10),
    };

    if (USE_WARP_PROXY) {
      launchOptions.proxy = {
        server: 'socks5://127.0.0.1:40000'
      };
    } else if (USE_SCRAPEDO_PROXY) {
      launchOptions.proxy = {
        server: SCRAPEDO_PROXY_SERVER,
        username: SCRAPEDO_TOKEN,
        password: SCRAPEDO_PROXY_PARAMS,
      };
    }

    browser = await chromium.launch(launchOptions);

    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1366, height: 900 },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    page = await context.newPage();

    if (USE_WARP_PROXY) {
      console.log('  🌐 Playwright tarayıcı başlatıldı (WARP Proxy Mode - 127.0.0.1:40000).');
    } else if (USE_SCRAPEDO_PROXY) {
      console.log('  🌐 Playwright tarayıcı başlatıldı (Scrape.do Proxy Mode).');
    } else {
      console.log('  🌐 Playwright tarayıcı başlatıldı (Proxy kapalı, doğrudan bağlantı).');
    }
    console.log('  🧭 Canlı pencere açık olacak. Gerekirse challenge ekranında manuel doğrulayın.');
    return true;
  } catch (err) {
    console.log(`  ❌ Tarayıcı başlatılamadı: ${err.message}`);
    return false;
  }
}

async function maybeHandleChallenge() {
  if (!page) {
    return false;
  }

  const currentUrl = page.url();
  const html = await page.content();

  if (!isChallengePage(html, currentUrl)) {
    return true;
  }

  console.log('  🛡️ Challenge tespit edildi. "Devam Et" veya Cloudflare doğrulama kutusunu tamamlayın.');
  const waited = await waitForChallengeSolve(CHALLENGE_WAIT_MS);

  if (!waited.solved) {
    console.log('  ❌ Challenge zaman aşımı. Manuel doğrulama tamamlanmadı.');
    return false;
  }

  console.log('  ✅ Challenge geçildi.');
  return true;
}

async function fetchPage(targetUrl, label = '') {
  if (hardStopStatus === 'ACTION_REQUIRED') {
    return { html: null, status: 'ACTION_REQUIRED' };
  }

  if (stats.creditsUsed >= MAX_CREDITS_PER_RUN) {
    console.log(
      `  💀 BÜTÇE LİMİTİ AŞILDI (${stats.creditsUsed}/${MAX_CREDITS_PER_RUN} kredi) — Koşu durduruluyor.`,
    );
    return { html: null, status: 'BUDGET_EXHAUSTED' };
  }

  if (!(await ensureBrowser())) {
    stats.failedRequests++;
    return { html: null, status: 'FAILED' };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const cost = 1;
    const modeLabel = USE_WARP_PROXY ? 'Playwright + WARP Proxy' : (USE_SCRAPEDO_PROXY ? 'Playwright + Scrape.do Proxy' : 'Playwright Direct');
    console.log(`  🌐 -> ${modeLabel} [${cost}cr] (${label}) - Deneme ${attempt}`);
    stats.totalRequests++;

    try {
      let html = '';
      let respStatus = 200;

      // 1. Önce Hızlı Arkaplan İsteği (XHR Fetch) - Sayfaya girmeden
      try {
        const result = await page.evaluate(async (url) => {
          const res = await fetch(url);
          return { status: res.status, html: await res.text() };
        }, targetUrl);

        respStatus = result.status;
        html = result.html;
      } catch (e) {
        html = '';
        respStatus = 0;
      }

      // 2. Eğer engellendiyse veya challenge geldiyse, GUI ile görerek gir (Fallback)
      if (respStatus === 403 || isChallengePage(html, targetUrl) || !html) {
        console.log(`  🔄 Hızlı istek engellendi (HTTP ${respStatus}). Tarayıcı üzerinden giriliyor...`);
        const response = await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: DEFAULT_NAV_TIMEOUT_MS,
        });

        await sleep(1200);

        const challengeOk = await maybeHandleChallenge();
        if (!challengeOk) {
          await sleep(2000);
          continue;
        }

        html = await page.content();
        respStatus = response ? response.status() : 200;
      }

      const status = checkScrapeErrors(html);

      if (status === 'ACTION_REQUIRED') {
        hardStopStatus = 'ACTION_REQUIRED';
        console.log('  💀 Scrape.do hesabında bu hedef domain için erişim kısıtı var. support@scrape.do ile whitelist talep edin.');
        return { html: null, status: 'ACTION_REQUIRED' };
      }

      if (respStatus !== 200 && respStatus !== 404 && respStatus !== 403) {
        const preview = String(html || '').replace(/\s+/g, ' ').substring(0, 180);
        console.log(`  ⚠️ HTTP ${respStatus} (deneme ${attempt}) engellendi veya sunucu hatası. Önizleme: ${preview}`);
        await sleep(2000);
        continue;
      }

      if (status === 'BANNED') {
        console.log('  💀 Proxy banned veya kredi bitti olabilir.');
        return { html: null, status: 'BANNED' };
      }

      if (status === 'PROXY_ERROR') {
        console.log('  ❌ Proxy doğrulama/biçim sorunu: ERR_NO_SUPPORTED_PROXIES');
        await sleep(2000);
        continue;
      }

      stats.creditsUsed += cost;

      if (status === 'CLOUDFLARE' || status === 'INVALID' || status === 'BLOCK_SAHIBINDEN') {
        console.log(`  ⚠️ İçerik doğrulanamadı (${status}) - deneme ${attempt}`);
        await sleep(2000);
        continue;
      }

      stats.successfulRequests++;
      stats.pagesLoaded++;
      return { html, status: 'OK' };
    } catch (err) {
      console.log(`  ❌ Uygulama içi hata: ${err.message}`);
      await sleep(2000);
    }
  }

  stats.failedRequests++;
  return { html: null, status: 'FAILED' };
}

export function buildSahibindenUrl(offset, priceMin, priceMax) {
  const url = new URL(BASE_URL);
  url.searchParams.set('pagingOffset', String(offset));
  url.searchParams.set('pagingSize', String(ITEMS_PER_PAGE));
  url.searchParams.set('sorting', 'date_desc');
  if (priceMin != null) url.searchParams.set('price_min', String(priceMin));
  if (priceMax != null) url.searchParams.set('price_max', String(priceMax));
  return url.toString();
}

export async function scrapeSegment(priceMin, priceMax) {
  const label = `${priceMin.toLocaleString('tr')}-${priceMax.toLocaleString('tr')} TL`;
  console.log(`\n  📦 Segment: ${label} (Mevcut Kredi: ${stats.creditsUsed}/${MAX_CREDITS_PER_RUN})`);

  const firstUrl = buildSahibindenUrl(0, priceMin, priceMax);
  const { html: firstHtml, status } = await fetchPage(firstUrl, `${label} (s:1)`);

  if (!firstHtml || status === 'BANNED' || status === 'BUDGET_EXHAUSTED' || status === 'ACTION_REQUIRED') {
    return { htmlPages: [], totalFound: 0, pages: 0, status };
  }

  const htmlPages = [firstHtml];

  let totalCount = 0;
  const totalMatch = firstHtml.match(/([\d.]+)\s*ilan/i);
  if (totalMatch) {
    totalCount = parseInt(totalMatch[1].replace(/\./g, ''), 10);
  }

  const totalPages = Math.min(Math.ceil(totalCount / ITEMS_PER_PAGE), MAX_PAGES_PER_SEGMENT);
  console.log(`  📊 ${label}: Toplam ${totalCount.toLocaleString('tr')} ilan, ${totalPages} sayfa.`);

  for (let pageIndex = 1; pageIndex < totalPages; pageIndex++) {
    await sleep(REQUEST_DELAY_MS);
    const offset = pageIndex * ITEMS_PER_PAGE;
    const url = buildSahibindenUrl(offset, priceMin, priceMax);
    const { html, status: pageStatus } = await fetchPage(url, `${label} (s:${pageIndex + 1})`);

    if (pageStatus === 'BANNED' || pageStatus === 'BUDGET_EXHAUSTED' || pageStatus === 'ACTION_REQUIRED') {
      return { htmlPages, totalFound: totalCount, pages: htmlPages.length, status: pageStatus };
    }

    if (html) htmlPages.push(html);
  }

  console.log(`  ✅ Segment bitti. Toplam çekilen sayfa: ${htmlPages.length}`);
  return { htmlPages, totalFound: totalCount, pages: htmlPages.length, status: 'OK' };
}

export async function initSession() {
  const ok = await ensureBrowser();
  if (!ok) {
    return null;
  }

  try {
    const warmupUrl = buildSahibindenUrl(0, 0, 2000);
    await page.goto(warmupUrl, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_NAV_TIMEOUT_MS,
    });

    const initHtml = await page.content();
    if (initHtml.toLowerCase().includes('failed to get successful response from website')) {
      console.log('  ❌ Start aşamasında ScrapeOps Proxy Hatası! Sunucu engellendi.');
      return null;
    }

    const challengeOk = await maybeHandleChallenge();
    if (!challengeOk) {
      return null;
    }

    return 'OK';
  } catch (err) {
    console.log(`  ❌ Session init hatası: ${err.message}`);
    return null;
  }
}

export async function closeBrowser() {
  try {
    if (page) {
      await page.close();
      page = null;
    }
    if (context) {
      await context.close();
      context = null;
    }
    if (browser) {
      await browser.close();
      browser = null;
    }
  } catch (err) {
    console.log(`  ⚠️ Tarayıcı kapanırken uyarı: ${err.message}`);
  }
}

export default {
  initSession,
  scrapeSegment,
  getStats,
  closeBrowser,
};
