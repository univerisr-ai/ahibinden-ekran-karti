import sys
import json
import time
from DrissionPage import ChromiumOptions, ChromiumPage

def emit(payload):
    # Keep transport ASCII-safe to avoid Windows code page write errors.
    sys.stdout.write(json.dumps(payload, ensure_ascii=True))
    sys.stdout.flush()

def fetch_page(target_url, proxy_url):
    page = None
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')

        co = ChromiumOptions()
        
        # Scrape.do proxy format: http://TOKEN@proxy.scrape.do:8080
        if proxy_url and proxy_url.strip() != 'None':
            proxy = proxy_url.replace('http://', '').replace('https://', '').strip().rstrip('/')
            co.set_proxy(f'{proxy}')
        
        page = ChromiumPage(co)
        page.set.window.max()
        
        page.get(target_url)
        time.sleep(5)

        html = page.html or ''
        if 'cloudflare' in html.lower() or 'just a moment' in html.lower():
             time.sleep(10)
             html = page.html or ''
             
        status_code = 200
        if 'Please Wait... | Cloudflare' in html:
             status_code = 403

        emit({
            'status': status_code,
            'html': html,
            'error': ''
        })

    except Exception as e:
        emit({
            'status': 0,
            'error': str(e),
            'html': ''
        })
    
    finally:
        if page:
            try:
                page.quit()
            except Exception:
                pass

if __name__ == '__main__':
    if len(sys.argv) < 2:
         emit({'status': 0, 'error': 'Missing arguments', 'html': ''})
         sys.exit(1)

    target_url = sys.argv[1]
    proxy_url = sys.argv[2] if len(sys.argv) > 2 else None
    
    fetch_page(target_url, proxy_url)
