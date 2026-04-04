"""Sahibinden cookie helper — DrissionPage CDP tabanlı.

DrissionPage, Chrome'u CDP (Chrome DevTools Protocol) üzerinden kontrol eder.
Selenium/WebDriver kullanmadığı için Cloudflare'ın bot tespitini atlatabiliyor.

Cookie + User-Agent toplar, curl_request.sh dosyasını günceller ve
istenirse scrape/api sunucusunu tetikler.
"""
from __future__ import annotations

import argparse
import os
import random
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

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
API_SERVER_PATH = PROJECT_ROOT / "backend" / "api_server.py"
CHROME_PROFILE_DIR = Path(os.getenv("CHROME_PROFILE_DIR", str(PROJECT_ROOT / ".chrome_profile")))
DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
PROXY_URL = os.getenv("PROXY_URL", "").strip()
MAX_COOKIE_ATTEMPTS = int(os.getenv("MAX_COOKIE_ATTEMPTS", "3"))

# Sahibinden login bilgileri (yurt disi IP ile erisimde gerekli)
SAHIBINDEN_EMAIL = os.getenv("SAHIBINDEN_EMAIL", "").strip()
SAHIBINDEN_PASS = os.getenv("SAHIBINDEN_PASS", "").strip()

LISTING_MARKERS = ("searchresultsitem", "searchresultstable", "searchresultspage", "classifiedtitle")
REQUIRED_COOKIE_NAMES = ("cf_clearance", "st", "csid", "csss")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")


def _send_telegram_message(message: str) -> None:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": message}
    try:
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code != 200:
            print(f"[-] Telegram mesaji gonderilemedi. Hata: {response.text}")
    except Exception as e:
        print(f"[-] Telegram gonderim hatasi: {e}")


# ==========================================
# DrissionPage TABANLI TARAYICI
# ==========================================

def _build_chromium_options(headless: bool = True):
    """DrissionPage ChromiumOptions olusturur."""
    from DrissionPage import ChromiumOptions

    co = ChromiumOptions()
    if headless:
        co.headless(True)
    co.set_argument("--no-sandbox")
    co.set_argument("--disable-gpu")
    co.set_argument("--disable-dev-shm-usage")
    co.set_argument("--window-size=1920,1080")
    co.set_argument("--disable-blink-features=AutomationControlled")
    co.set_user_agent(DEFAULT_UA)

    # Not: Cookie alma icin proxy KULLANILMIYOR.
    # DrissionPage CDP modu Cloudflare'i proxy'siz geciyor.
    # WARP/proxy sadece bulk_scraper.py'de ilan cekerken kullanilir.

    return co


def _page_has_listings(html: str) -> bool:
    """Sayfada ilan listesi var mi?"""
    body = html.lower()
    return any(marker in body for marker in LISTING_MARKERS)


def _looks_like_cloudflare(html: str) -> bool:
    body = html.lower()
    return "just a moment" in body or "challenge-platform" in body


def _looks_like_error_page(html: str) -> bool:
    return "error-page-container" in html


def _looks_like_login(url: str) -> bool:
    return "login" in url


def _cookies_are_usable(cookies: list[dict]) -> bool:
    names = {c.get("name", "") for c in cookies}
    return any(name in names for name in REQUIRED_COOKIE_NAMES)


def _handle_login(tab: Any) -> bool:
    """Sahibinden login sayfasindaysa giris yapar."""
    if not SAHIBINDEN_EMAIL or not SAHIBINDEN_PASS:
        print("[-] Login gerekli ama SAHIBINDEN_EMAIL/SAHIBINDEN_PASS ayarlanmamis!")
        print("    .env dosyasina SAHIBINDEN_EMAIL ve SAHIBINDEN_PASS ekleyin.")
        return False

    print("[*] Login sayfasi tespit edildi, giris yapiliyor...")

    # Oncelikle "I am in Turkey" formunu dene
    try:
        result = tab.run_js("""
            var radio = document.querySelector('#iAmInTurkeyRadioInput');
            return radio ? 'found' : 'not_found';
        """)
        if result == "found":
            print("[*] 'I am in Turkey' formu bulundu, deneniyor...")
            tab.run_js(f"""
                var radio = document.querySelector('#iAmInTurkeyRadioInput');
                if (radio) {{ radio.checked = true; radio.click(); radio.dispatchEvent(new Event('change', {{bubbles:true}})); }}
                
                function setVal(id, val) {{
                    var el = document.getElementById(id);
                    if (el) {{
                        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        setter.call(el, val);
                        el.dispatchEvent(new Event('input', {{bubbles:true}}));
                        el.dispatchEvent(new Event('change', {{bubbles:true}}));
                    }}
                }}
                setVal('informUsNameInput', 'Kullanici');
                setVal('informUsSurnameInput', 'Sahibinden');
                setVal('informUsEmailInput', '{SAHIBINDEN_EMAIL}');
                
                var btn = document.querySelector('#submitLoginForceInform');
                if (btn) {{ btn.disabled = false; btn.click(); }}
            """)
            time.sleep(8)

            if not _looks_like_login(tab.url):
                print("[+] 'I am in Turkey' formu kabul edildi!")
                return True
            print("[!] 'I am in Turkey' formu islemedi, login deneniyor...")
    except Exception as e:
        print(f"[!] Turkey formu hatasi: {e}")

    # Normal email/password login
    print("[*] Email/sifre ile giris deneniyor...")
    try:
        tab.run_js(f"""
            function setNativeValue(element, value) {{
                var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(element, value);
                element.dispatchEvent(new Event('input', {{ bubbles: true }}));
                element.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }}
            var email = document.querySelector('#username');
            var pass = document.querySelector('#password');
            if (email) setNativeValue(email, '{SAHIBINDEN_EMAIL}');
            if (pass) setNativeValue(pass, '{SAHIBINDEN_PASS}');
        """)
        time.sleep(2)

        # Login butonuna tikla
        tab.run_js("""
            var btn = document.querySelector('#userLoginSubmitButton') 
                   || document.querySelector('#loginSubmitButton')
                   || document.querySelector('button[type=submit]');
            if (btn) { btn.disabled = false; btn.click(); }
        """)
        time.sleep(15)

        if not _looks_like_login(tab.url):
            print("[+] Login basarili!")
            return True

        # Hata mesajini kontrol et
        err = tab.run_js("""
            var el = document.querySelector('.error-message, .alert-danger, [class*=error]');
            return el ? el.textContent.trim() : '';
        """)
        if err:
            print(f"[-] Login hatasi: {err}")
        else:
            print("[-] Login basarisiz (muhtemelen CAPTCHA)")
        return False

    except Exception as e:
        print(f"[-] Login hatasi: {e}")
        return False


def get_cookie_and_ua_attempt(headless: bool = True) -> tuple[str | None, str | None]:
    """DrissionPage CDP ile cookie + UA al."""
    from DrissionPage import Chromium

    print(f"[*] Chrome aciliyor (DrissionPage, headless={headless})...")
    browser = None
    try:
        co = _build_chromium_options(headless=headless)
        browser = Chromium(co)
        tab = browser.latest_tab

        # 1) Sahibinden'e git
        print("[*] Sahibinden'e gidiliyor...")
        tab.get(SAHIBINDEN_URL)
        # Sayfa yuklenip cookie'lerin oturmasi icin minimum bekleme
        time.sleep(10)

        # 2) Cloudflare + sayfa tam yukleme bekleme (max 90s)
        print("[*] Cloudflare kontrolu ve sayfa yuklemesi bekleniyor...")
        login_handled = False
        for i in range(45):
            time.sleep(2)
            html = tab.html
            url = tab.url

            if _page_has_listings(html):
                print(f"[+] Ilan listesi yuklendi! ({(i+1)*2}s)")
                break

            if _looks_like_login(url) and not login_handled:
                print(f"[*] Login sayfasina yonlendirildi ({(i+1)*2}s)")
                login_handled = True
                if _handle_login(tab):
                    # Login sonrasi hedef sayfaya git
                    tab.get(SAHIBINDEN_URL)
                    time.sleep(5)
                    continue
                else:
                    break

            if _looks_like_error_page(html):
                print(f"[-] Sahibinden hata sayfasi ({(i+1)*2}s) — IP engellenmis olabilir")
                return None, None

            if not _looks_like_cloudflare(html) and not _looks_like_login(url):
                # CF gecildi, sayfa yukleniyor, cookie'lerin oturmasini bekle
                cookies_now = tab.cookies()
                cookie_names = {c.get("name", "") for c in cookies_now}
                has_critical = any(n in cookie_names for n in ("st", "csid", "csss"))
                if has_critical or len(cookies_now) >= 20:
                    print(f"[+] Kritik cookie'ler oturdu ({len(cookies_now)} cookie, {(i+1)*2}s)")
                    break
                if i % 5 == 4:
                    print(f"  [{(i+1)*2}s] {len(cookies_now)} cookie, kritik bekleniyor...")

        # Sayfa tam yuklensin diye ekstra bekle
        time.sleep(random.uniform(3, 6))

        # 3) Son durum kontrolu
        html = tab.html
        url = tab.url

        if _looks_like_login(url):
            print("[-] Halen login sayfasinda, cookie alinamadi.")
            return None, None

        if _looks_like_error_page(html):
            print("[-] Sahibinden hata sayfasi, cookie alinamadi.")
            return None, None

        # 4) Cookie'leri al
        cookies = tab.cookies()
        ua = tab.run_js("return navigator.userAgent;")

        if not cookies:
            print("[-] Hic cookie alinamadi.")
            return None, None

        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)

        has_listings = _page_has_listings(html)
        cookie_usable = _cookies_are_usable(cookies)

        print(f"[+] {len(cookies)} cerez alindi (listings={has_listings}, usable={cookie_usable})")

        if has_listings or cookie_usable:
            return cookie_str, ua

        # Eger cookie var ama ilan yok ise yine de dondur (belki bulk_scraper calisir)
        if len(cookies) >= 5:
            print("[*] Yeterli cookie var, denemek icin dondurulecek.")
            return cookie_str, ua

        print("[-] Yeterli cookie veya ilan icerigi bulunamadi.")
        return None, None

    except Exception as exc:
        print(f"[-] DrissionPage hatasi: {exc}")
        return None, None

    finally:
        if browser:
            try:
                browser.quit()
            except Exception:
                pass
            print("[*] Tarayici kapatildi.")


def get_cookie_and_ua(headless: bool = True) -> tuple[str | None, str | None]:
    """Kademeli deneme stratejisi ile cookie al.
    
    1) headless=True (hızlı, sunucu uyumlu)
    2) headless=False (xvfb varsa GUI gibi çalışır)
    """
    attempts = [
        ("1. Deneme: headless=True (CDP)", True),
        ("2. Deneme: headless=False (CDP GUI)", False),
    ]

    for i, (label, hl) in enumerate(attempts[:MAX_COOKIE_ATTEMPTS]):
        print(f"[*] {label}...")
        cookie, ua = get_cookie_and_ua_attempt(headless=hl)
        if cookie:
            return cookie, ua

        if i < len(attempts) - 1:
            # Chrome process'lerini temizle
            if os.name == "posix":
                os.system("pkill -f 'chrome.*DrissionPage' 2>/dev/null || true")
            wait = 3 + i * 2
            print(f"[*] {wait}s bekleniyor, sonraki deneme hazirlanacak...")
            time.sleep(wait)

    print("[-] Tum denemeler basarisiz oldu.")
    return None, None


# ==========================================
# YARDIMCI FONKSIYONLAR
# ==========================================

def _extract_chrome_major(ua: str) -> str | None:
    match = re.search(r"Chrome/(\d+)", ua)
    return match.group(1) if match else None


def _sec_ch_platform(ua: str) -> str:
    ua_lower = ua.lower()
    if "windows" in ua_lower:
        return "Windows"
    if "linux" in ua_lower:
        return "Linux"
    if "mac os x" in ua_lower or "macintosh" in ua_lower:
        return "macOS"
    return "Windows"


def _shell_single_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def save_curl(cookie: str, ua: str) -> None:
    """curl_request.sh dosyasini gunceller."""
    chrome_major = _extract_chrome_major(ua) or "145"
    platform = _sec_ch_platform(ua)
    content = f"""#!/bin/bash
# Sahibinden.com - otomatik olusturuldu

curl {_shell_single_quote(SAHIBINDEN_URL)} \\
  -H {_shell_single_quote('Upgrade-Insecure-Requests: 1')} \\
  -H {_shell_single_quote(f'User-Agent: {ua}')} \\
  -H {_shell_single_quote(f'sec-ch-ua: "Not:A-Brand";v="99", "Google Chrome";v="{chrome_major}", "Chromium";v="{chrome_major}"')} \\
  -H {_shell_single_quote('sec-ch-ua-arch: "x86"')} \\
  -H {_shell_single_quote('sec-ch-ua-bitness: "64"')} \\
  -H {_shell_single_quote('sec-ch-ua-mobile: ?0')} \\
  -H {_shell_single_quote('sec-ch-ua-model: ""')} \\
  -H {_shell_single_quote(f'sec-ch-ua-platform: "{platform}"')} \\
  -H {_shell_single_quote(f'Cookie: {cookie}')} \\
  --compressed
"""
    CURL_PATH.write_text(content, encoding="utf-8")
    if os.name == "posix":
        os.chmod(CURL_PATH, 0o600)
    print(f"[+] {CURL_PATH.name} guncellendi.")
    # Telegram'a cookie ve User-Agent bilgisini gonder
    msg = (
        "✅ Yeni Sahibinden cookie'leri başariyla alindi!\n\n"
        f"🍪 **Cookie:** `{cookie}`\n\n"
        f"🕵️ **User-Agent:** `{ua}`\n\n"
        "🚀 Sistem güncellendi. İstek atilabilir duruma geldi."
    )
    _send_telegram_message(msg)


def refresh_cookie(headless: bool = True) -> bool:
    """Cookie + UA yeniler, curl_request.sh yazar."""
    cookie, ua = get_cookie_and_ua(headless=headless)
    if not cookie:
        print("[-] Cookie alinamadi!")
        return False

    if not ua:
        ua = DEFAULT_UA

    save_curl(cookie, ua)
    return True


def run_scraper() -> int:
    """bulk_scraper.py'yi calistirir."""
    if not SCRAPER_PATH.exists():
        print("[!] bulk_scraper.py bulunamadi, toplu cekim atlandi.")
        return 0

    print("[*] Toplu ilan cekimi baslatiliyor...")
    result = subprocess.run([sys.executable, str(SCRAPER_PATH)], cwd=str(PROJECT_ROOT))
    if result.returncode != 0:
        print("[-] Toplu cekim basarisiz oldu!")
    return result.returncode


def start_server(host: str = "127.0.0.1", port: int = 8000) -> None:
    """API sunucusunu arka planda baslatir."""
    if not API_SERVER_PATH.exists():
        print("[-] backend/api_server.py bulunamadi!")
        return

    print(f"[*] Sunucu baslatiliyor: http://{host}:{port}/")
    args = [sys.executable, str(API_SERVER_PATH), "--host", host, "--port", str(port), "--skip-cookie-check"]
    if os.name == "nt":
        subprocess.Popen(args, creationflags=subprocess.CREATE_NEW_CONSOLE, cwd=str(PROJECT_ROOT))
    else:
        subprocess.Popen(args, cwd=str(PROJECT_ROOT))


# ==========================================
# ANA FONKSIYON
# ==========================================

def main() -> None:
    parser = argparse.ArgumentParser(description="Sahibinden cookie/scrape yardimcisi (DrissionPage)")
    parser.add_argument("--headless", action="store_true", default=True, help="Cookie alirken Chrome'u headless modda calistir")
    parser.add_argument("--no-headless", action="store_true", help="Headless modu kapati")
    parser.add_argument("--refresh-only", action="store_true", help="Sadece cookie yenile")
    parser.add_argument("--run-scraper", action="store_true", help="Cookie yenilemeden sonra bulk_scraper.py calistir")
    parser.add_argument("--start-server", action="store_true", help="Cookie yenilemeden sonra API sunucusunu baslat")
    parser.add_argument("--host", default="127.0.0.1", help="API sunucu host")
    parser.add_argument("--port", type=int, default=8000, help="API sunucu port")
    parser.add_argument("--xvfb", action="store_true", help="(uyumluluk icin korundu, DrissionPage ile gereksiz)")
    args = parser.parse_args()

    headless = not args.no_headless

    if args.refresh_only:
        do_scraper = False
        do_server = False
    elif args.run_scraper or args.start_server:
        do_scraper = args.run_scraper
        do_server = args.start_server
    else:
        do_scraper = True
        do_server = True

    try:
        ok = refresh_cookie(headless=headless)
        if not ok:
            raise SystemExit(1)

        if do_scraper:
            code = run_scraper()
            if code != 0:
                raise SystemExit(code)

        if do_server:
            start_server(host=args.host, port=args.port)

        print("[+] Tamamlandi!")
    except SystemExit:
        raise
    except Exception as exc:
        print(f"[-] Beklenmeyen hata: {exc}")
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[!] Iptal edildi.")
