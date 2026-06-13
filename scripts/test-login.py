"""Quick test: navigate to sahibinden.com/giris with Camoufox"""
from camoufox import Camoufox

with Camoufox(
    headless=True,
    locale='tr-TR',
    window=(1920, 1080),
    humanize=True,
    disable_coop=True,
) as browser:
    page = browser.new_page()
    page.goto('https://www.sahibinden.com/giris', timeout=30000)
    page.wait_for_timeout(3000)
    title = page.title()
    url = page.url
    print(f'Title: {title}')
    print(f'URL: {url}')
    if 'challenge' in url or 'captcha' in url or 'error' in url:
        print('RESULT: BLOCKED')
    elif 'giris' in url or 'login' in url:
        print('RESULT: LOGIN_PAGE_REACHED')
    else:
        print(f'RESULT: OTHER - {url}')
    page.screenshot(path='test-sahibinden-giris.png', full_page=True)
