"""
DrissionPage - cookie al + sayfa tam yuklenene kadar bekle
"""
import time
import re

SAHIBINDEN_URL = "https://www.sahibinden.com/ekran-karti-masaustu"


def get_cookies_and_verify():
    from DrissionPage import Chromium, ChromiumOptions
    
    co = ChromiumOptions()
    co.headless(True)
    co.set_argument("--no-sandbox")
    co.set_argument("--disable-gpu")
    co.set_argument("--disable-dev-shm-usage")
    co.set_argument("--window-size=1920,1080")
    co.set_argument("--disable-blink-features=AutomationControlled")
    
    browser = None
    try:
        browser = Chromium(co)
        tab = browser.latest_tab
        
        print("[*] Sahibinden'e gidiliyor...")
        tab.get(SAHIBINDEN_URL)
        
        # Sayfanin tam yuklenmesini bekle (max 90 saniye)
        print("[*] Sayfa tam yuklenene kadar bekleniyor...")
        for i in range(45):
            time.sleep(2)
            html = tab.html
            title = tab.title
            
            has_cf = "Just a moment" in html or "challenge-platform" in html
            has_listing = "searchResultsRowClass" in html or "classifiedTitle" in html
            
            elapsed = (i + 1) * 2
            
            if has_listing:
                print(f"[+] [{elapsed}s] Ilan listesi yuklendi!")
                break
            elif has_cf:
                print(f"  [{elapsed}s] Cloudflare challenge aktif... (title: {title})")
            else:
                print(f"  [{elapsed}s] Sayfa yukleniyor... (title: {title})")
                # Cloudflare gecildi ama sayfa henuz yuklenmedi, biraz daha bekle
                if i > 5 and not has_cf:
                    # Belki yonlendirme oldu
                    current_url = tab.url
                    print(f"  URL: {current_url}")
        
        # Son kontrol
        time.sleep(3)
        html = tab.html
        has_listing = "searchResultsRowClass" in html or "classifiedTitle" in html
        
        # Cookie ve UA al
        cookies = tab.cookies()
        ua = tab.run_js("return navigator.userAgent;")
        
        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
        
        print(f"\n[+] {len(cookies)} cookie alindi")
        for c in cookies:
            print(f"    {c['name']} = {c['value'][:60]}...")
        
        print(f"[+] Ilan listesi gorunuyor: {has_listing}")
        print(f"[+] Sayfa URL: {tab.url}")
        print(f"[+] Sayfa title: {tab.title}")
        print(f"[+] Sayfa boyutu: {len(html)} byte")
        
        # Ilan sayisi bul
        count_match = re.search(r'resultCount.*?(\d[\d.]*)', html)
        if count_match:
            print(f"[+] Toplam ilan: {count_match.group(1)}")
        
        if has_listing or len(cookies) >= 2:
            # curl_request.sh yaz
            with open("curl_request.sh", "w", encoding="utf-8") as f:
                f.write(f"""curl 'https://www.sahibinden.com/ekran-karti-masaustu' \\
  -H 'Cookie: {cookie_str}' \\
  -H 'User-Agent: {ua}'
""")
            print("[+] curl_request.sh guncellendi!")
            return cookie_str, ua, True
        
        return None, None, False
        
    except Exception as e:
        print(f"[-] Hata: {e}")
        import traceback
        traceback.print_exc()
        return None, None, False
    finally:
        if browser:
            try:
                browser.quit()
            except:
                pass


if __name__ == "__main__":
    print("DrissionPage - Cookie + Tam Sayfa Yukleme Testi\n")
    cookie_str, ua, success = get_cookies_and_verify()
    
    if success and cookie_str:
        print(f"\n{'='*50}")
        print("BASARILI! Cookie alindi.")
        print("Simdi bulk_scraper'i calistir:")
        print("  python bulk_scraper.py")
        print(f"{'='*50}")
        
        # bulk_scraper testi
        print("\n[*] bulk_scraper testi baslatiliyor...")
        import subprocess
        import sys
        result = subprocess.run(
            [sys.executable, "bulk_scraper.py"],
            capture_output=False,
            timeout=300,
        )
    else:
        print("\nBASARISIZ")
