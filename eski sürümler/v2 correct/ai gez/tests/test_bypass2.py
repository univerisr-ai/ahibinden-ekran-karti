"""
Cloudflare bypass test - cloudscraper detayli analiz + DrissionPage testi
"""

SAHIBINDEN_URL = "https://www.sahibinden.com/ekran-karti-masaustu"


def test_cloudscraper_detailed():
    """cloudscraper detayli - cookie'leri analiz et"""
    print("=" * 50)
    print("TEST: cloudscraper detayli analiz")
    print("=" * 50)
    try:
        import cloudscraper
        
        scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True},
            delay=10,
        )
        resp = scraper.get(SAHIBINDEN_URL, timeout=60)
        
        print(f"  Status: {resp.status_code}")
        print(f"  URL: {resp.url}")
        print(f"  Cookie sayisi: {len(resp.cookies)}")
        
        for name, value in resp.cookies.items():
            print(f"    {name} = {value[:80]}...")
        
        # cf_clearance var mi?
        has_cf_clearance = "cf_clearance" in resp.cookies
        print(f"\n  cf_clearance cookie var mi: {has_cf_clearance}")
        
        # Sayfa icerigi analizi
        text = resp.text
        checks = {
            "searchResultsRowClass": "searchResultsRowClass" in text,
            "classifiedTitle": "classifiedTitle" in text,
            "resultCount": "resultCount" in text,
            "listing-item": "listing-item" in text,
            "Just a moment": "Just a moment" in text,
            "challenge-platform": "challenge-platform" in text,
            "turnstile": "turnstile" in text.lower(),
            "cf-browser-verification": "cf-browser-verification" in text,
        }
        
        print("\n  Sayfa icerigi kontrolleri:")
        for key, val in checks.items():
            print(f"    {key}: {val}")
            
        print(f"\n  Sayfa boyutu: {len(text)} byte")
        
        # Eger ilan icerigi varsa cookie'yi test et
        if has_cf_clearance:
            print("\n  >>> CF_CLEARANCE ALINDI! Bu cookie ile bulk_scraper calisabilir!")
            return "; ".join(f"{k}={v}" for k, v in resp.cookies.items())
        
        return None
    except Exception as e:
        print(f"  HATA: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_curl_cffi_session_flow():
    """curl_cffi ile once ana sayfaya git sonra hedef sayfaya"""
    print("\n" + "=" * 50)
    print("TEST: curl_cffi session flow (ana sayfa -> hedef)")
    print("=" * 50)
    try:
        from curl_cffi import requests as cffi_req
        import time
        
        session = cffi_req.Session(impersonate="chrome131")
        
        # 1) Once ana sayfaya git
        print("  [1] Ana sayfaya gidiliyor...")
        resp1 = session.get("https://www.sahibinden.com/", timeout=30)
        print(f"  Status: {resp1.status_code}, Cookies: {len(resp1.cookies)}")
        
        time.sleep(3)
        
        # 2) Hedef sayfaya git
        print("  [2] Hedef sayfaya gidiliyor...")
        resp2 = session.get(SAHIBINDEN_URL, timeout=30)
        print(f"  Status: {resp2.status_code}, Cookies: {len(resp2.cookies)}")
        
        has_listing = "searchResultsRowClass" in resp2.text or "classifiedTitle" in resp2.text
        has_cf = "Just a moment" in resp2.text
        
        print(f"  Ilan icerigi: {has_listing}")
        print(f"  Cloudflare: {has_cf}")
        
        if has_listing and not has_cf:
            print("  >>> BASARILI!")
            all_cookies = {**resp1.cookies, **resp2.cookies}
            return "; ".join(f"{k}={v}" for k, v in all_cookies.items())
        
        return None
    except Exception as e:
        print(f"  HATA: {e}")
        return None


if __name__ == "__main__":
    test_cloudscraper_detailed()
    test_curl_cffi_session_flow()
