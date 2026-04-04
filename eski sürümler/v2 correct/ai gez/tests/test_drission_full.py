"""
DrissionPage ile cookie al + bulk_scraper ile ilan cek - tam entegrasyon testi
"""
import time
import json

SAHIBINDEN_URL = "https://www.sahibinden.com/ekran-karti-masaustu"


def get_cookies_drission(headless=True):
    """DrissionPage CDP ile cookie al"""
    from DrissionPage import Chromium, ChromiumOptions
    
    co = ChromiumOptions()
    if headless:
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
        time.sleep(3)
        
        # Cloudflare gecene kadar bekle (max 60 saniye)
        for i in range(30):
            html = tab.html
            has_cf = "Just a moment" in html or "challenge-platform" in html
            has_listing = "searchResultsRowClass" in html or "classifiedTitle" in html
            
            if has_listing:
                print(f"[+] Sayfa yuklendi! ({i*2}s)")
                break
            
            if not has_cf:
                print(f"[+] Cloudflare gecildi! ({i*2}s)")
                break
                
            time.sleep(2)
        
        # Cookie'leri al
        cookies = tab.cookies()
        ua = tab.run_js("return navigator.userAgent;")
        
        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
        
        cf_clearance = any(c["name"] == "cf_clearance" for c in cookies)
        print(f"[+] {len(cookies)} cookie alindi (cf_clearance: {cf_clearance})")
        
        return cookie_str, ua
        
    except Exception as e:
        print(f"[-] Hata: {e}")
        return None, None
    finally:
        if browser:
            try:
                browser.quit()
            except:
                pass


def test_cookie_validity(cookie_str, ua):
    """Cookie'nin gercekten calisip calismadigini test et"""
    from curl_cffi import requests as cffi_req
    
    print("\n[*] Cookie gecerliligi test ediliyor...")
    
    session = cffi_req.Session(impersonate="chrome131")
    headers = {
        "Cookie": cookie_str,
        "User-Agent": ua,
    }
    
    resp = session.get(
        "https://www.sahibinden.com/ekran-karti-masaustu?pagingOffset=0&pagingSize=50",
        headers=headers,
        timeout=25,
    )
    
    print(f"  Status: {resp.status_code}")
    
    if resp.status_code == 200:
        has_listing = "searchResultsRowClass" in resp.text or "classifiedTitle" in resp.text
        has_cf = "Just a moment" in resp.text
        print(f"  Ilan icerigi: {has_listing}")
        print(f"  Cloudflare: {has_cf}")
        
        if has_listing and not has_cf:
            print("[+] Cookie GECERLI! bulk_scraper calisabilir!")
            return True
    
    print("[-] Cookie gecersiz veya Cloudflare halen aktif")
    return False


if __name__ == "__main__":
    print("DrissionPage Tam Entegrasyon Testi\n")
    
    cookie_str, ua = get_cookies_drission(headless=True)
    
    if cookie_str:
        valid = test_cookie_validity(cookie_str, ua)
        
        if valid:
            # curl_request.sh dosyasini guncelle (bulk_scraper icin)
            print("\n[*] curl_request.sh guncelleniyor...")
            with open("curl_request.sh", "w", encoding="utf-8") as f:
                f.write(f"""curl 'https://www.sahibinden.com/ekran-karti-masaustu' \\
  -H 'Cookie: {cookie_str}' \\
  -H 'User-Agent: {ua}'
""")
            print("[+] curl_request.sh guncellendi!")
            print("\n[*] Simdi bulk_scraper calistir: python bulk_scraper.py")
    else:
        print("\n[-] Cookie alinamadi!")
