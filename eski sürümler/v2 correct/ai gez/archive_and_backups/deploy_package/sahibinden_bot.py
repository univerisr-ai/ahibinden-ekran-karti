"""
Sahibinden Cookie Helper v2 - GCP Sunucu Optimizasyonlu

SeleniumBase UC (Undetected Chrome) modu kullanarak Cloudflare bypass.
DrissionPage'e gore sunucu ortaminda cok daha basarili.

Kullanim:
    python sahibinden_bot_v2.py --refresh-only
    python sahibinden_bot_v2.py --once --headless
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
import random
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
import requests

load_dotenv()

# Windows terminal UTF-8 desteği
if sys.stdout and getattr(sys.stdout, "encoding", None) and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ==========================================
# AYARLAR
# ==========================================
PROJECT_ROOT = Path(__file__).resolve().parent
SAHIBINDEN_URL = os.getenv("SAHIBINDEN_URL", "https://www.sahibinden.com/ekran-karti-masaustu")
CURL_PATH = PROJECT_ROOT / "curl_request.sh"
SCRAPER_PATH = PROJECT_ROOT / "bulk_scraper.py"
CHROME_PROFILE_DIR = Path(os.getenv("CHROME_PROFILE_DIR", str(PROJECT_ROOT / ".chrome_profile")))
DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"

# Login bilgileri
SAHIBINDEN_EMAIL = os.getenv("SAHIBINDEN_EMAIL", "").strip()
SAHIBINDEN_PASS = os.getenv("SAHIBINDEN_PASS", "").strip()

# Gerekli cookieler - TUMU olmali
REQUIRED_COOKIES = ["cf_clearance", "st", "csid", "csss"]
CRITICAL_COOKIE_COUNT = 4  # En az 4 kritik cookie

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")


def log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def _send_telegram_message(message: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": message}
    try:
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code != 200:
            log(f"[-] Telegram mesaji gonderilemedi. Hata: {response.text}")
    except Exception as e:
        log(f"[-] Telegram gonderim hatasi: {e}")


# ==========================================
# SeleniumBase UC MODU (Primary)
# ==========================================

def _get_cookies_seleniumbase(
    headless: bool = True,
    use_xvfb: bool = True,
    max_wait: int = 120
) -> tuple[Optional[str], Optional[str]]:
    """
    SeleniumBase UC (Undetected Chrome) ile cookie al.
    Bu yontem sunucu ortaminda Cloudflare'i en iyi bypass eden yontemdir.
    """
    try:
        from seleniumbase import Driver
    except ImportError:
        log("[!] SeleniumBase kurulu degil, denenmiyor.")
        return None, None

    log(f"[*] SeleniumBase UC modu baslatiliyor (headless={headless})...")
    driver = None

    try:
        # UC modu = Undetected Chrome
        # headless2 = daha gelismis headless modu (CF bypass icin daha iyi)
        driver = Driver(
            uc=True,
            headless=headless,
            headless2=headless,  # headless2=True daha iyi CF bypass saglar
        )

        log("[*] Sahibinden'e gidiliyor...")
        driver.get(SAHIBINDEN_URL)

        # Cloudflare challenge bekleme
        log("[*] Cloudflare challenge bekleniyor (max 90s)...")
        start_time = time.time()
        check_interval = 2

        while time.time() - start_time < max_wait:
            html = driver.page_source
            current_url = driver.current_url

            # Cloudflare challenge tespiti
            has_cf_challenge = "just a moment" in html.lower() or "cf-chl" in html.lower() or "challenge-platform" in html.lower()
            has_listings = "searchresultsitem" in html.lower() or "classifiedtitle" in html.lower()

            # Cookie'leri kontrol et
            cookies = driver.get_cookies()
            cookie_names = {c.get("name", "").lower() for c in cookies}

            cf_ok = "cf_clearance" in cookie_names
            st_ok = "st" in cookie_names
            csid_ok = "csid" in cookie_names
            csss_ok = "csss" in cookie_names

            critical_count = sum([cf_ok, st_ok, csid_ok, csss_ok])

            elapsed = int(time.time() - start_time)

            # Log her 10 saniyede bir
            if elapsed % 10 == 0 or not hasattr(_get_cookies_seleniumbase, '_last_log') or elapsed - getattr(_get_cookies_seleniumbase, '_last_log', 0) >= 10:
                log(f"  [{elapsed}s] CF={cf_ok}, ST={st_ok}, CSID={csid_ok}, CSSS={csss_ok} | Challenge={has_cf_challenge}, Listings={has_listings}")
                _get_cookies_seleniumbase._last_log = elapsed

            # Basari durumu: Tum kritik cookieler var ve ilan icerigi gorunuyor
            if critical_count >= CRITICAL_COOKIE_COUNT and has_listings:
                log(f"[+] Tum kritik cookieler alindi! ({critical_count}/4)")
                break

            # Yeterli cookie var ama challenge hala var, biraz daha bekle
            if critical_count >= 3 and not has_cf_challenge:
                log(f"[*] Yeterli cookie var, sayfa yukleniyor...")
                time.sleep(3)
                break

            # Login sayfasina yonlendirme
            if "login" in current_url.lower() or "secure.sahibinden.com" in current_url.lower():
                log("[!] Login sayfasina yonlendirildi.")
                if SAHIBINDEN_EMAIL and SAHIBINDEN_PASS:
                    if _handle_login_seleniumbase(driver):
                        log("[+] Login basarili, devam ediliyor...")
                        time.sleep(5)
                        continue
                    else:
                        log("[-] Login basarisiz!")
                        break
                else:
                    log("[-] Login gerekli ama bilgiler yok!")
                    break

            time.sleep(check_interval)

        # Son kontrol
        final_html = driver.page_source
        final_cookies = driver.get_cookies()

        # User Agent al
        try:
            ua = driver.execute_script("return navigator.userAgent;")
        except:
            ua = DEFAULT_UA

        # Cookie string olustur
        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in final_cookies if c.get('value'))

        # Validasyon
        cookie_names = {c.get("name", "").lower() for c in final_cookies}
        cf_ok = "cf_clearance" in cookie_names
        st_ok = "st" in cookie_names

        if cf_ok and st_ok:
            log(f"[+] Basarili! {len(final_cookies)} cookie, cf_clearance={cf_ok}, st={st_ok}")
            return cookie_str, ua
        elif cf_ok:
            log(f"[!] Kismi basari: cf_clearance var ama st yok. Denenecek.")
            return cookie_str, ua
        else:
            log(f"[-] cf_clearance bulunamadi!")
            return None, None

    except Exception as e:
        log(f"[-] SeleniumBase hatasi: {e}")
        import traceback
        traceback.print_exc()
        return None, None

    finally:
        if driver:
            try:
                driver.quit()
            except:
                pass
            log("[*] SeleniumBase tarayici kapatildi.")


def _handle_login_seleniumbase(driver) -> bool:
    """SeleniumBase ile login formunu doldur."""
    try:
        log("[*] Login formu dolduruluyor...")

        # Turkey radio button
        try:
            turkey_radio = driver.find_element("css selector", "#iAmInTurkeyRadioInput")
            if turkey_radio and turkey_radio.is_displayed():
                turkey_radio.click()
                log("[*] 'I am in Turkey' secildi")

                # Form alanlarini doldur
                driver.execute_script(f"""
                    document.getElementById('informUsNameInput').value = 'Kullanici';
                    document.getElementById('informUsSurnameInput').value = 'Sahibinden';
                    document.getElementById('informUsEmailInput').value = '{SAHIBINDEN_EMAIL}';
                """)

                submit_btn = driver.find_element("css selector", "#submitLoginForceInform")
                if submit_btn:
                    submit_btn.click()

                time.sleep(8)
                if "login" not in driver.current_url.lower():
                    return True
        except:
            pass

        # Normal login
        try:
            email_field = driver.find_element("css selector", "#username")
            pass_field = driver.find_element("css selector", "#password")

            if email_field and pass_field:
                email_field.clear()
                email_field.send_keys(SAHIBINDEN_EMAIL)
                pass_field.clear()
                pass_field.send_keys(SAHIBINDEN_PASS)

                login_btn = driver.find_element("css selector", "#userLoginSubmitButton, #loginSubmitButton, button[type='submit']")
                if login_btn:
                    login_btn.click()

                time.sleep(10)
                return "login" not in driver.current_url.lower()
        except Exception as e:
            log(f"[!] Normal login hatasi: {e}")

        return False

    except Exception as e:
        log(f"[-] Login hatasi: {e}")
        return False


# ==========================================
# DrissionPage FALLBACK
# ==========================================

def _get_cookies_drissionpage(
    headless: bool = True,
    max_wait: int = 90
) -> tuple[Optional[str], Optional[str]]:
    """DrissionPage CDP ile cookie al (Fallback)."""
    try:
        from DrissionPage import Chromium, ChromiumOptions
    except ImportError:
        log("[!] DrissionPage kurulu degil.")
        return None, None

    log(f"[*] DrissionPage CDP modu baslatiliyor (headless={headless})...")
    browser = None

    try:
        co = ChromiumOptions()
        if headless:
            co.headless(True)
        co.set_argument("--no-sandbox")
        co.set_argument("--disable-gpu")
        co.set_argument("--disable-dev-shm-usage")
        co.set_argument("--window-size=1920,1080")
        co.set_argument("--disable-blink-features=AutomationControlled")
        co.set_user_agent(DEFAULT_UA)

        browser = Chromium(co)
        tab = browser.latest_tab

        log("[*] Sahibinden'e gidiliyor...")
        tab.get(SAHIBINDEN_URL)
        time.sleep(5)

        start_time = time.time()
        while time.time() - start_time < max_wait:
            html = tab.html
            cookies = tab.cookies()
            cookie_names = {c.get("name", "").lower() for c in cookies}

            cf_ok = "cf_clearance" in cookie_names
            st_ok = "st" in cookie_names

            elapsed = int(time.time() - start_time)

            if elapsed % 10 == 0:
                log(f"  [{elapsed}s] cf_clearance={cf_ok}, st={st_ok}, cookies={len(cookies)}")

            if cf_ok and st_ok:
                log("[+] DrissionPage basarili!")
                break

            time.sleep(2)

        final_cookies = tab.cookies()
        try:
            ua = tab.run_js("return navigator.userAgent;")
        except:
            ua = DEFAULT_UA

        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in final_cookies if c.get('value'))

        cookie_names = {c.get("name", "").lower() for c in final_cookies}
        if "cf_clearance" in cookie_names:
            return cookie_str, ua

        return None, None

    except Exception as e:
        log(f"[-] DrissionPage hatasi: {e}")
        return None, None

    finally:
        if browser:
            try:
                browser.quit()
            except:
                pass


# ==========================================
# ANA COOKIE ALMA FONKSIYONU
# ==========================================

def get_cookie_and_ua(
    headless: bool = True,
    use_xvfb: bool = True,
    max_attempts: int = 3
) -> tuple[Optional[str], Optional[str]]:
    """
    Kademeli cookie alma stratejisi:
    1. SeleniumBase UC modu (en iyi CF bypass)
    2. DrissionPage fallback
    3. Her yontemde multiple deneme
    """
    strategies = [
        ("SeleniumBase UC", lambda: _get_cookies_seleniumbase(headless=headless, use_xvfb=use_xvfb)),
        ("DrissionPage CDP", lambda: _get_cookies_drissionpage(headless=headless)),
    ]

    for attempt in range(max_attempts):
        log(f"\n=== Cookie Deneme {attempt + 1}/{max_attempts} ===")

        for name, strategy_fn in strategies:
            log(f"\n[*] Strateji: {name}")
            cookie, ua = strategy_fn()

            if cookie and len(cookie) > 100:  # Minimum cookie uzunlugu
                log(f"[+] {name} basarili!")
                return cookie, ua
            else:
                log(f"[-] {name} basarisiz.")

        if attempt < max_attempts - 1:
            wait = 5 + attempt * 3
            log(f"[*] {wait}s bekleniyor, tekrar denenecek...")
            time.sleep(wait)
            _kill_chrome_processes()

    log("[-] Tum stratejiler basarisiz oldu.")
    return None, None


def _kill_chrome_processes():
    """Kalan Chrome processlerini temizle."""
    try:
        if os.name == "posix":
            subprocess.run(["pkill", "-f", "chrome"], capture_output=True, timeout=5)
            subprocess.run(["pkill", "-f", "chromedriver"], capture_output=True, timeout=5)
    except:
        pass


# ==========================================
# CURL DOSYASI YONETIMI
# ==========================================

def _extract_chrome_major(ua: str) -> str:
    match = re.search(r"Chrome/(\d+)", ua)
    return match.group(1) if match else "145"


def _sec_ch_platform(ua: str) -> str:
    ua_lower = ua.lower()
    if "windows" in ua_lower:
        return "Windows"
    if "linux" in ua_lower:
        return "Linux"
    if "mac os x" in ua_lower:
        return "macOS"
    return "Windows"


def _shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def save_curl_script(cookie: str, ua: str) -> None:
    """curl_request.sh dosyasini olustur."""
    chrome_major = _extract_chrome_major(ua)
    platform = _sec_ch_platform(ua)

    content = f"""#!/bin/bash
# Sahibinden Cookie - {time.strftime('%Y-%m-%d %H:%M:%S')}

curl {_shell_quote(SAHIBINDEN_URL)} \\
  -H {_shell_quote('Upgrade-Insecure-Requests: 1')} \\
  -H {_shell_quote(f'User-Agent: {ua}')} \\
  -H {_shell_quote(f'sec-ch-ua: "Not:A-Brand";v="99", "Google Chrome";v="{chrome_major}", "Chromium";v="{chrome_major}"')} \\
  -H {_shell_quote('sec-ch-ua-arch: "x86"')} \\
  -H {_shell_quote('sec-ch-ua-bitness: "64"')} \\
  -H {_shell_quote('sec-ch-ua-mobile: ?0')} \\
  -H {_shell_quote('sec-ch-ua-model: ""')} \\
  -H {_shell_quote(f'sec-ch-ua-platform: "{platform}"')} \\
  -H {_shell_quote(f'Cookie: {cookie}')} \\
  --compressed
"""

    CURL_PATH.write_text(content, encoding="utf-8")
    if os.name == "posix":
        os.chmod(CURL_PATH, 0o600)

    log(f"[+] {CURL_PATH.name} guncellendi.")
    _send_telegram_message("Sahibinden cookie'leri basariyla yenilendi!")


# ==========================================
# ANA ISLEMLER
# ==========================================

def refresh_cookie(headless: bool = True) -> bool:
    """Cookie yenile ve curl dosyasini guncelle."""
    cookie, ua = get_cookie_and_ua(headless=headless)

    if not cookie:
        log("[-] Cookie alinamadi!")
        return False

    if not ua:
        ua = DEFAULT_UA

    save_curl_script(cookie, ua)
    return True


def run_scraper() -> int:
    """bulk_scraper.py'yi calistir."""
    if not SCRAPER_PATH.exists():
        log("[!] bulk_scraper.py bulunamadi.")
        return 0

    log("[*] Bulk scraper calistiriliyor...")
    result = subprocess.run([sys.executable, str(SCRAPER_PATH)], cwd=str(PROJECT_ROOT))
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description="Sahibinden Cookie Helper v2")
    parser.add_argument("--refresh-only", action="store_true", help="Sadece cookie yenile")
    parser.add_argument("--run-scraper", action="store_true", help="Scraper'i calistir")
    parser.add_argument("--headless", action="store_true", default=True, help="Headless mod")
    parser.add_argument("--no-headless", action="store_true", help="Headless modu kapat")
    parser.add_argument("--xvfb", action="store_true", help="Xvfb kullan (sunucu icin)")

    args = parser.parse_args()

    headless = not args.no_headless

    # Xvfb kontrolu
    if args.xvfb and os.name == "posix":
        xvfb_check = subprocess.run(["which", "xvfb-run"], capture_output=True)
        if xvfb_check.returncode != 0:
            log("[!] xvfb-run bulunamadi. 'sudo apt install xvfb' ile kurun.")

    try:
        ok = refresh_cookie(headless=headless)
        if not ok:
            raise SystemExit(1)

        if args.run_scraper:
            code = run_scraper()
            if code != 0:
                raise SystemExit(code)

        log("[+] Tamamlandi!")

    except SystemExit:
        raise
    except Exception as e:
        log(f"[-] Hata: {e}")
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("\n[!] Iptal edildi.")
