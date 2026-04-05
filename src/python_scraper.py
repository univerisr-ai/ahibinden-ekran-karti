import sys
import json
import base64
import time
from pyvirtualdisplay import Display
from DrissionPage import ChromiumOptions, ChromiumPage

def fetch_page(target_url, proxy_url):
    # Sanal ekran başlat (Xvfb)
    display = Display(visible=0, size=(1920, 1080))
    display.start()
    
    try:
        co = ChromiumOptions()
        
        # Cloudflare'i rahat geçmek için özellikler
        co.set_argument('--no-sandbox')
        co.set_argument('--disable-gpu')
        co.set_argument('--disable-dev-shm-usage')
        # Bu satır chromium'da headless FLAG'ini kaldiriyor ki site gercek bir ekran var sansin
        # xvfb kullandigimiz icin gercek headlessa ihtiyacimiz yok
        co.set_user_agent(user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
        
        if proxy_url and proxy_url.strip() != 'None':
            # Örn: proxyUrl: http://scrapeops:API_KEY@proxy.scrapeops.io:5353
            proxy = proxy_url.replace('http://', '').replace('/', '')
            co.set_proxy(f'{proxy}')
            
        page = ChromiumPage(co)
        page.set.window.max()
        
        page.get(target_url)
        time.sleep(5)  # Sayfanin ve Cloudflare'in yuklenmesini bekle
        
        # Eger hala cloudflare JS challenge ekranindaysa extra bekle
        html = page.html
        if 'cloudflare' in html.lower() or 'just a moment' in html.lower():
             time.sleep(10)
             html = page.html
             
        # Ekran görüntüsü al kanıt olarak
        try:
             page.get_screenshot(path='cf_proof.png', full_page=True)
             with open('cf_proof.png', 'rb') as f:
                 b64_screenshot = base64.b64encode(f.read()).decode('utf-8')
        except:
             b64_screenshot = ''
             
        status_code = 200
        # 403 / 500 donuste genelde cloudflare block olmustur, baska isaret edebiliriz
        if 'Please Wait... | Cloudflare' in html:
             status_code = 403
             
        page.quit()

        payload = {
            'status': status_code,
            'html': html,
            'screenshot': b64_screenshot,
            'error': ''
        }
        
    except Exception as e:
        payload = {
            'status': 0,
            'error': str(e),
            'html': '',
            'screenshot': ''
        }
    finally:
         display.stop()

    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.stdout.write(json.dumps({'status': 0, 'error': 'Missing arguments'}))
        sys.exit(1)

    target_url = sys.argv[1]
    proxy_url = sys.argv[2] if len(sys.argv) > 2 else None

    fetch_page(target_url, proxy_url)
