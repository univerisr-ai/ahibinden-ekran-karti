"""
Cloudflare bypass test - Chrome olmadan cookie alma denemeleri
"""
import sys

SAHIBINDEN_URL = "https://www.sahibinden.com/ekran-karti-masaustu"

def test_curl_cffi():
    """curl_cffi ile Chrome TLS fingerprint taklidi"""
    print("=" * 50)
    print("TEST 1: curl_cffi impersonate")
    print("=" * 50)
    try:
        from curl_cffi import requests as cffi_req
        
        # Chrome 131 fingerprint'ini taklit et
        session = cffi_req.Session(impersonate="chrome131")
        resp = session.get(SAHIBINDEN_URL, timeout=30)
        
        print(f"  Status: {resp.status_code}")
        print(f"  Cookie sayisi: {len(resp.cookies)}")
        
        if resp.cookies:
            cookie_str = "; ".join(f"{k}={v}" for k, v in resp.cookies.items())
            print(f"  Cookies: {cookie_str[:200]}...")
        
        has_listing = "searchResultsRowClass" in resp.text or "classified" in resp.text.lower()
        has_cf = "challenge" in resp.text.lower() or "just a moment" in resp.text.lower()
        
        print(f"  Ilan icerigi var mi: {has_listing}")
        print(f"  Cloudflare challenge mi: {has_cf}")
        print(f"  Sayfa boyutu: {len(resp.text)} byte")
        
        if has_listing and not has_cf:
            print("  >>> BASARILI! Cookie ve ilan icerigi alindi!")
            return cookie_str, resp.headers.get("user-agent", "")
        else:
            print("  >>> BASARISIZ - Cloudflare gecilmedi")
            return None, None
    except Exception as e:
        print(f"  HATA: {e}")
        return None, None


def test_cloudscraper():
    """cloudscraper ile JS challenge bypass"""
    print("\n" + "=" * 50)
    print("TEST 2: cloudscraper")
    print("=" * 50)
    try:
        import cloudscraper
        
        scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "desktop": True}
        )
        resp = scraper.get(SAHIBINDEN_URL, timeout=30)
        
        print(f"  Status: {resp.status_code}")
        print(f"  Cookie sayisi: {len(resp.cookies)}")
        
        if resp.cookies:
            cookie_str = "; ".join(f"{k}={v}" for k, v in resp.cookies.items())
            print(f"  Cookies: {cookie_str[:200]}...")
        
        has_listing = "searchResultsRowClass" in resp.text or "classified" in resp.text.lower()
        has_cf = "challenge" in resp.text.lower() or "just a moment" in resp.text.lower()
        
        print(f"  Ilan icerigi var mi: {has_listing}")
        print(f"  Cloudflare challenge mi: {has_cf}")
        
        if has_listing and not has_cf:
            print("  >>> BASARILI!")
            return cookie_str
        else:
            print("  >>> BASARISIZ")
            return None
    except Exception as e:
        print(f"  HATA: {e}")
        return None


def test_curl_cffi_with_headers():
    """curl_cffi ile tam browser header seti"""
    print("\n" + "=" * 50)
    print("TEST 3: curl_cffi + tam browser headers")
    print("=" * 50)
    try:
        from curl_cffi import requests as cffi_req
        
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "max-age=0",
            "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        }
        
        session = cffi_req.Session(impersonate="chrome131")
        resp = session.get(SAHIBINDEN_URL, headers=headers, timeout=30)
        
        print(f"  Status: {resp.status_code}")
        print(f"  Cookie sayisi: {len(resp.cookies)}")
        
        if resp.cookies:
            cookie_str = "; ".join(f"{k}={v}" for k, v in resp.cookies.items())
            print(f"  Cookies: {cookie_str[:200]}...")
        else:
            cookie_str = ""
        
        has_listing = "searchResultsRowClass" in resp.text or "classified" in resp.text.lower()
        has_cf = "challenge" in resp.text.lower() or "just a moment" in resp.text.lower()
        
        print(f"  Ilan icerigi var mi: {has_listing}")
        print(f"  Cloudflare challenge mi: {has_cf}")
        
        # Response header'larinda set-cookie var mi?
        set_cookies = [v for k, v in resp.headers.items() if k.lower() == "set-cookie"]
        if set_cookies:
            print(f"  Set-Cookie header sayisi: {len(set_cookies)}")
        
        if has_listing and not has_cf:
            print("  >>> BASARILI!")
            return cookie_str
        else:
            print("  >>> BASARISIZ")
            # Sayfanin ilk 500 karakterini goster
            print(f"  Sayfa basi: {resp.text[:500]}")
            return None
    except Exception as e:
        print(f"  HATA: {e}")
        return None


if __name__ == "__main__":
    print("Cloudflare Bypass Test - Chrome olmadan cookie alma\n")
    
    test_curl_cffi()
    test_cloudscraper()
    test_curl_cffi_with_headers()
