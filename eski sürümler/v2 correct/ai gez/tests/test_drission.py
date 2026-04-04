"""
DrissionPage ile Cloudflare bypass testi.
DrissionPage, CDP (Chrome DevTools Protocol) uzerinden dogrudan Chrome'u kontrol eder.
Selenium/WebDriver kullanmaz, bu yuzden Cloudflare'in WebDriver tespitini atlatabilir.
"""
import time

SAHIBINDEN_URL = "https://www.sahibinden.com/ekran-karti-masaustu"


def test_drission():
    print("=" * 50)
    print("TEST: DrissionPage CDP modu")
    print("=" * 50)
    
    from DrissionPage import Chromium, ChromiumOptions
    
    # Chrome ayarlari
    co = ChromiumOptions()
    co.headless(True)  # Sunucuda headless calisacak
    co.set_argument("--no-sandbox")
    co.set_argument("--disable-gpu")
    co.set_argument("--disable-dev-shm-usage")
    co.set_argument("--window-size=1920,1080")
    
    # Anti-detection
    co.set_argument("--disable-blink-features=AutomationControlled")
    
    browser = None
    try:
        browser = Chromium(co)
        tab = browser.latest_tab
        
        print("  [1] Sahibinden'e gidiliyor...")
        tab.get(SAHIBINDEN_URL)
        time.sleep(5)
        
        # Cloudflare kontrolu
        html = tab.html
        has_cf = "Just a moment" in html or "challenge-platform" in html
        has_listing = "searchResultsRowClass" in html or "classifiedTitle" in html
        
        print(f"  Cloudflare challenge: {has_cf}")
        print(f"  Ilan icerigi: {has_listing}")
        
        if has_cf:
            print("  [2] Cloudflare tespit edildi, bekleniyor...")
            # 15 saniye bekle - DrissionPage JS challenge'i otomatik cozer
            for i in range(15):
                time.sleep(2)
                html = tab.html
                has_cf = "Just a moment" in html or "challenge-platform" in html
                has_listing = "searchResultsRowClass" in html or "classifiedTitle" in html
                
                if has_listing and not has_cf:
                    print(f"  [{i*2}s] Cloudflare gecildi!")
                    break
                print(f"  [{i*2}s] Halen bekleniyor... CF={has_cf}")
        
        # Cookie'leri al
        cookies = tab.cookies()
        print(f"\n  Cookie sayisi: {len(cookies)}")
        
        cf_clearance = None
        for cookie in cookies:
            name = cookie.get("name", "")
            value = cookie.get("value", "")
            if name == "cf_clearance":
                cf_clearance = value
            print(f"    {name} = {value[:60]}...")
        
        if cf_clearance:
            print("\n  >>> CF_CLEARANCE ALINDI!")
            cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
            print(f"  Cookie string: {cookie_str[:200]}...")
            return cookie_str
        
        # Ilan icerigi var mi son kontrol
        html = tab.html
        if "searchResultsRowClass" in html or "classifiedTitle" in html:
            print("\n  >>> SAYFA YUKLENDI! (cf_clearance olmasa bile cookie'ler alinabilir)")
            cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
            return cookie_str
        
        print("\n  >>> BASARISIZ")
        print(f"  Sayfa title: {tab.title}")
        return None
        
    except Exception as e:
        print(f"  HATA: {e}")
        import traceback
        traceback.print_exc()
        return None
    finally:
        if browser:
            try:
                browser.quit()
            except:
                pass
            print("  Tarayici kapatildi.")


if __name__ == "__main__":
    result = test_drission()
    if result:
        print(f"\nSONUC: Cookie alindi! ({len(result)} karakter)")
    else:
        print("\nSONUC: Basarisiz.")
