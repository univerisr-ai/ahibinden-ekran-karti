"""
GCP Sunucu Cookie Test Scripti

Bu script sunucuda dogrudan calistirilarak cookie alma isleminin
calisip calismadigi test edilebilir.

Kullanim:
    cd /opt/ai-gez
    source .venv/bin/activate
    python test_server_cookie.py

    # veya xvfb ile:
    xvfb-run -a python test_server_cookie.py
"""
import time
import sys

def test_seleniumbase():
    """SeleniumBase UC modu ile test."""
    print("=" * 60)
    print("TEST 1: SeleniumBase UC Modu")
    print("=" * 60)

    try:
        from seleniumbase import Driver
    except ImportError:
        print("[-] SeleniumBase kurulu degil!")
        print("    Kurulum: pip install seleniumbase")
        return False

    driver = None
    try:
        print("[*] Driver baslatiliyor (uc=True, headless=True)...")
        driver = Driver(uc=True, headless=True, headless2=True)

        url = "https://www.sahibinden.com/ekran-karti-masaustu"
        print(f"[*] {url} aciliyor...")
        driver.get(url)

        print("[*] Cloudflare bekleniyor (max 60s)...")
        time.sleep(5)

        for i in range(30):
            html = driver.page_source.lower()
            current_url = driver.current_url

            has_cf = "just a moment" in html or "cf-chl" in html or "challenge-platform" in html
            has_listings = "searchresultsitem" in html or "classifiedtitle" in html
            has_login = "login" in current_url.lower()

            # Cookie'leri kontrol et
            cookies = driver.get_cookies()
            cookie_names = {c.get("name", "").lower() for c in cookies}

            cf_ok = "cf_clearance" in cookie_names
            st_ok = "st" in cookie_names
            csid_ok = "csid" in cookie_names
            csss_ok = "csss" in cookie_names

            print(f"  [{i*2}s] cf={cf_ok}, st={st_ok}, csid={csid_ok}, csss={csss_ok} | CF={has_cf}, Listings={has_listings}, Login={has_login}")

            # Basari kriteri
            if cf_ok and st_ok and has_listings:
                print("\n[+] BASARILI! Tum kritik cookieler alindi.")
                print(f"[+] Toplam {len(cookies)} cookie")

                # Cookie'leri goster
                print("\n  Cookie Listesi:")
                for c in cookies:
                    name = c.get('name', '')
                    value = c.get('value', '')[:50]
                    print(f"    {name}={value}...")

                # UA al
                ua = driver.execute_script("return navigator.userAgent;")
                print(f"\n  User-Agent: {ua[:80]}...")

                return True

            # Login sayfasi - bu da bir tur basari (IP temiz)
            if has_login:
                print("\n[!] Login sayfasina yonlendirildi - IP temiz ama login gerekli")
                return False

            time.sleep(2)

        print("\n[-] Zaman asimi - cookieler alinamadi")
        return False

    except Exception as e:
        print(f"\n[-] Hata: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        if driver:
            try:
                driver.quit()
            except:
                pass
            print("\n[*] Driver kapatildi.")


def test_drissionpage():
    """DrissionPage ile test (Fallback)."""
    print("\n" + "=" * 60)
    print("TEST 2: DrissionPage CDP Modu")
    print("=" * 60)

    try:
        from DrissionPage import Chromium, ChromiumOptions
    except ImportError:
        print("[-] DrissionPage kurulu degil!")
        return False

    browser = None
    try:
        print("[*] Chromium baslatiliyor...")
        co = ChromiumOptions()
        co.headless(True)
        co.set_argument("--no-sandbox")
        co.set_argument("--disable-gpu")
        co.set_argument("--disable-dev-shm-usage")
        co.set_argument("--disable-blink-features=AutomationControlled")

        browser = Chromium(co)
        tab = browser.latest_tab

        url = "https://www.sahibinden.com/ekran-karti-masaustu"
        print(f"[*] {url} aciliyor...")
        tab.get(url)
        time.sleep(5)

        print("[*] Cloudflare bekleniyor (max 60s)...")
        for i in range(30):
            html = tab.html.lower()
            cookies = tab.cookies()
            cookie_names = {c.get("name", "").lower() for c in cookies}

            cf_ok = "cf_clearance" in cookie_names
            st_ok = "st" in cookie_names

            print(f"  [{i*2}s] cf_clearance={cf_ok}, st={st_ok}, total_cookies={len(cookies)}")

            if cf_ok and st_ok:
                print("\n[+] BASARILI!")
                return True

            time.sleep(2)

        print("\n[-] Zaman asimi")
        return False

    except Exception as e:
        print(f"\n[-] Hata: {e}")
        return False

    finally:
        if browser:
            try:
                browser.quit()
            except:
                pass


def main():
    print("\n" + "=" * 60)
    print("SAHIBINDEN COOKIE TEST - GCP SUNUCU")
    print("=" * 60)
    print(f"Python: {sys.version}")
    print(f"Platform: {sys.platform}")
    print("")

    # Test 1: SeleniumBase
    sb_ok = test_seleniumbase()

    if sb_ok:
        print("\n" + "=" * 60)
        print("SONUC: SeleniumBase calisiyor! Yeni bot kullanilabilir.")
        print("=" * 60)
        return 0

    # Test 2: DrissionPage fallback
    print("\n[!] SeleniumBase basarisiz, DrissionPage deneniyor...")
    dp_ok = test_drissionpage()

    if dp_ok:
        print("\n" + "=" * 60)
        print("SONUC: DrissionPage calisiyor! Mevcut bot kullanilabilir.")
        print("=" * 60)
        return 0

    print("\n" + "=" * 60)
    print("SONUC: Her iki yontem de basarisiz!")
    print("=" * 60)
    print("\nOneriler:")
    print("1. IP adresiniz Cloudflare tarafindan engellenmis olabilir.")
    print("2. WARP/proxy kullanmayi deneyin.")
    print("3. Baska bir sunucu uzerinde deneyin.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
