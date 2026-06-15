const { firefox } = require('playwright');
const { NewBrowser, launchOptions } = require('camoufox');
const { readFileSync } = require('fs');

(async () => {
  const authRaw = readFileSync('login-capture/auth.json', 'utf8');
  const auth = JSON.parse(authRaw);
  console.log('Loaded auth.json: ' + auth.cookies.length + ' cookies');

  const opts = await launchOptions({
    headless: false,
    locale: 'tr-TR',
    disable_coop: true,
    humanize: true,
    window: { width: 1366, height: 900 },
    i_know_what_im_doing: true,
  });

  const browser = await NewBrowser(firefox, false, opts);
  const context = await browser.newContext();

  if (auth.cookies.length > 0) {
    await context.addCookies(auth.cookies);
    console.log('Cookies added to context');
  }

  const page = await context.newPage();

  console.log('\n--- Test 1: banaozel.sahibinden.com ---');
  await page.goto('https://banaozel.sahibinden.com/', { waitUntil: 'networkidle', timeout: 60000 });
  console.log('URL:', page.url());
  console.log('Title:', await page.title());

  const html = await page.content();
  if (html.includes('giris yap') || html.includes('Giriş Yap') || page.url().includes('giris')) {
    console.log('❌ COOKIES GECERSIZ - Login sayfasina yonlendirildi!');
  } else {
    console.log('✅ COOKIES GECERLI - Login kalindi!');
  }

  console.log('\n--- Test 2: REST API ---');
  const resp = await page.evaluate(async () => {
    const r = await fetch('https://banaozel.sahibinden.com/sahibinden-ral/rest/my/info', {
      credentials: 'include',
    });
    return { status: r.status, ok: r.ok };
  });
  console.log('REST /my/info:', resp.status, resp.ok ? '✅' : '❌');

  const cookies = await context.cookies();
  const sessionCookies = cookies.filter(c =>
    ['csid', 'cwt', 'st', 'csss', 'csls', 'xsrf-token', 'shuid', 'ulfuid'].includes(c.name)
  );
  console.log('\n--- Session Cookies ---');
  for (const c of sessionCookies) {
    const exp = c.expires ? new Date(c.expires * 1000).toISOString() : 'Session';
    console.log(`  ${c.name}=${c.value.substring(0, 30)}... expires=${exp}`);
  }

  await page.screenshot({ path: 'login-capture/session-test.png', fullPage: false });
  console.log('\nScreenshot: login-capture/session-test.png');

  await browser.close();
  console.log('Done.');
})();
