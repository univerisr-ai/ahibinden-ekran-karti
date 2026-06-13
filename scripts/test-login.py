"""Quick test: navigate to sahibinden.com/giris with Camoufox"""
import asyncio, sys
from camoufox import Camoufox

async def main():
    async with Camoufox(
        headless=True,
        locale='tr-TR',
        window=(1920, 1080),
        humanize=True,
        disable_coop=True,
    ) as browser:
        page = await browser.new_page()
        await page.goto('https://www.sahibinden.com/giris', timeout=30000)
        await page.wait_for_timeout(3000)
        title = await page.title()
        url = page.url
        print(f'Title: {title}')
        print(f'URL: {url}')
        if 'challenge' in url or 'captcha' in url or 'error' in url:
            print('RESULT: BLOCKED')
        elif 'giris' in url or 'login' in url:
            print('RESULT: LOGIN_PAGE_REACHED')
        else:
            print(f'RESULT: OTHER - {url}')
        await page.screenshot(path='test-sahibinden-giris.png', full_page=True)

if __name__ == '__main__':
    asyncio.run(main())
