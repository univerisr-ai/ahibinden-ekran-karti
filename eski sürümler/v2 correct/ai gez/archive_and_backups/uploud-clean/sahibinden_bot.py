"""Sahibinden cookie helper.

Cookie + User-Agent toplar, curl_request.sh dosyasini gunceller ve
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
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit  # bulk_scraper uyumu

from dotenv import load_dotenv
import requests

try:
    from pyvirtualdisplay import Display
except ImportError:
    Display = None  # type: ignore[assignment,misc]

load_dotenv()

from selenium.webdriver.common.by import By

# Windows terminal UTF-8 destegi
if sys.stdout and getattr(sys.stdout, "encoding", None) and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")


# ==========================================
# AYARLAR
# ==========================================
PROJECT_ROOT = Path(__file__).resolve().parent
SAHIBINDEN_URL = os.getenv("SAHIBINDEN_URL", "https://www.sahibinden.com/ekran-karti-masaustu")
CURL_PATH = PROJECT_ROOT / "curl_request.sh"
SCRAPER_PATH = PROJECT_ROOT / "bulk_scraper.py"
API_SERVER_PATH = PROJECT_ROOT / "backend" / "api_server.py"
CHROME_PROFILE_DIR = Path(os.getenv("CHROME_PROFILE_DIR", str(PROJECT_ROOT / ".chrome_profile")))
CHROME_VERSION_MAIN = os.getenv("CHROME_VERSION_MAIN")
DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36"
PROXY_URL = os.getenv("PROXY_URL", "").strip()
RECONNECT_TIME_FIRST = int(os.getenv("RECONNECT_TIME_FIRST", "8"))
MAX_COOKIE_ATTEMPTS = int(os.getenv("MAX_COOKIE_ATTEMPTS", "3"))
LISTING_SELECTORS = (
    "tr.searchResultsItem",
    "#searchResultsTable",
    ".searchResultsPage",
    ".searchResultsItems",
    "table.searchResultsTable",
)
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

def _build_driver(headless: bool, headless2: bool = False):
    from seleniumbase import Driver
    try:
        CHROME_PROFILE_DIR.mkdir(parents=True, exist_ok=True)

        kwargs: dict[str, Any] = dict(
            uc=True,
            headless=headless,
            headless2=headless2,
            user_data_dir=str(CHROME_PROFILE_DIR),
        )

        # Residential proxy destegi (Cloudflare Turnstile bypass icin kritik)
        if PROXY_URL:
            kwargs["proxy"] = PROXY_URL
            # Proxy URL'den kullanici bilgisini gizle
            proxy_display = PROXY_URL.split("@")[-1] if "@" in PROXY_URL else PROXY_URL
            print(f"[*] Residential proxy aktif: {proxy_display}")

        driver = Driver(**kwargs)
        print(
            f"[*] Tarayici surucusu hazir: SeleniumBase "
            f"(uc=True, headless={headless}, headless2={headless2}, "
            f"profil={CHROME_PROFILE_DIR.name}, proxy={'evet' if PROXY_URL else 'yok'})"
        )
        return driver
    except Exception as exc:
        raise RuntimeError(f"Tarayici baslatilamadi: {exc}")



def _page_has_listing_markup(page_source: str) -> bool:
    body = page_source.lower()
    markers = (
        "searchresultsitem",
        "searchresultstable",
        "searchresultspage",
        "ekran kart",
    )
    return any(marker in body for marker in markers)



def _looks_like_cloudflare(page_source: str) -> bool:
    body = page_source.lower()
    markers = ("just a moment", "cf-chl", "attention required", "cloudflare")
    return any(marker in body for marker in markers)



def _wait_for_listing_page(driver: Any, timeout: int = 60) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        for selector in LISTING_SELECTORS:
            try:
                if driver.find_elements(By.CSS_SELECTOR, selector):
                    return True
            except Exception:
                continue

        try:
            if _page_has_listing_markup(driver.page_source or ""):
                return True
        except Exception:
            pass

        time.sleep(1)
    return False



def _cookies_are_usable(cookies: list[dict[str, Any]]) -> bool:
    names = {str(cookie.get("name", "")).strip() for cookie in cookies}
    return any(name in names for name in REQUIRED_COOKIE_NAMES)



def _try_solve_turnstile(driver: Any, max_attempts: int = 3) -> bool:
    """Cloudflare Turnstile CAPTCHA'yi otomatik gecmeye calisir.
    
    SeleniumBase uc_gui_click_captcha() metodunu kullanir.
    Bu metod pyautogui ile Turnstile checkbox'ina tiklar.
    Sunucuda calisabilmesi icin xvfb (sanal ekran) gerekir.
    """
    for attempt in range(1, max_attempts + 1):
        print(f"[*] Turnstile bypass denemesi {attempt}/{max_attempts}...")
        try:
            driver.uc_gui_click_captcha()
            time.sleep(random.uniform(3, 6))

            page_source = driver.page_source or ""
            if _page_has_listing_markup(page_source):
                print("[+] Turnstile basariyla gecildi!")
                return True

            if not _looks_like_cloudflare(page_source):
                print("[+] Cloudflare challenge artik gorunmuyor.")
                return True

            print(f"[!] Turnstile halen aktif (deneme {attempt})")
        except Exception as exc:
            print(f"[!] Turnstile tikla hatasi (deneme {attempt}): {exc}")

        if attempt < max_attempts:
            wait = random.uniform(2, 4)
            print(f"[*] {wait:.1f}s bekleniyor...")
            time.sleep(wait)

    return False


def get_cookie_and_ua_attempt(headless: bool, headless2: bool) -> tuple[str | None, str | None]:
    print(f"[*] Chrome aciliyor (headless={headless}, headless2={headless2})...")
    driver = None
    try:
        driver = _build_driver(headless=headless, headless2=headless2)

        # Sayfayi yukle â€” sadece git, cookie al, cik.
        print("[*] Sahibinden'e gidiliyor...")
        driver.uc_open_with_reconnect(SAHIBINDEN_URL, reconnect_time=RECONNECT_TIME_FIRST)
        time.sleep(random.uniform(3, 5))

        print("[*] Sayfanin yuklenmesi ve olasi Cloudflare kontrolunun gecmesi bekleniyor...")
        if _wait_for_listing_page(driver, timeout=60):
            print("[+] Sayfa yuklendi!")
        else:
            print("[!] Sayfa zaman asimina ugradi veya listing selectorleri bulunamadi.")

        # Cloudflare halen aktifse Turnstile bypass dene
        page_source = driver.page_source or ""
        if _looks_like_cloudflare(page_source) and not _page_has_listing_markup(page_source):
            print("[!] Cloudflare Turnstile tespit edildi, otomatik bypass deneniyor...")
            if _try_solve_turnstile(driver):
                print("[+] Turnstile bypass basarili!")
                time.sleep(random.uniform(1, 3))
            else:
                print("[-] Turnstile bypass basarisiz.")
                return None, None

        # Cookie ve UA al
        page_source = driver.page_source or ""
        if _looks_like_cloudflare(page_source) and not _page_has_listing_markup(page_source):
            print("[-] Cloudflare challenge halen aktif gorunuyor; cookie kaydedilmeyecek.")
            return None, None

        cookies = driver.get_cookies()
        ua = driver.execute_script("return navigator.userAgent;")

        if not _cookies_are_usable(cookies):
            print("[-] Gecerli gorunen kritik cookie'ler alinmadi; donulen sayfa Cloudflare olabilir.")
            return None, None

        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
        print(f"[+] {len(cookies)} cerez alindi.")
        return cookie_str or None, ua

    except Exception as exc:
        print(f"[-] Chrome hatasi: {exc}")
        return None, None

    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
            print("[*] Tarayici kapatildi.")


def get_cookie_and_ua(headless: bool = False) -> tuple[str | None, str | None]:
    """
    Chrome ile Sahibinden'i acip cookie + user-agent alir.
    
    Headless modunda Cloudflare'a takilmamak icin kademeli strateji:
      1) headless=True  (standart headless, en hizli)
      2) headless2=True (SeleniumBase sanal ekran headless, daha iyi gizleme)
      3) headless=False  (tam GUI â€” xvfb varsa gercek tarayici gibi calisir, en guclu)
    
    Her denemede Turnstile CAPTCHA tespit edilirse uc_gui_click_captcha() ile
    otomatik gecis denenir.
    """
    if not headless:
        return get_cookie_and_ua_attempt(headless=False, headless2=False)

    attempts = [
        ("1. Deneme: headless=True (standart)", dict(headless=True, headless2=False)),
        ("2. Deneme: headless2=True (SB sanal ekran)", dict(headless=False, headless2=True)),
        ("3. Deneme: headless=False (xvfb GUI modu â€” en guclu)", dict(headless=False, headless2=False)),
    ]

    for i, (label, kwargs) in enumerate(attempts[:MAX_COOKIE_ATTEMPTS]):
        print(f"[*] {label}...")
        cookie, ua = get_cookie_and_ua_attempt(**kwargs)
        if cookie:
            return cookie, ua

        if i < len(attempts) - 1:
            wait = 3 + i * 2  # Her denemede biraz daha bekle
            print(f"[*] {wait}s bekleniyor, sonraki deneme hazirlanacak...")
            time.sleep(wait)

    print("[-] Tum denemeler basarisiz oldu.")
    return None, None




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
    chrome_major = _extract_chrome_major(ua) or CHROME_VERSION_MAIN or "145"
    platform = _sec_ch_platform(ua)
    content = f"""#!/bin/bash
# Sahibinden.com - otomatik olusturuldu

curl {_shell_single_quote(SAHIBINDEN_URL)} \\
  -H {_shell_single_quote('Upgrade-Insecure-Requests: 1')} \\
  -H {_shell_single_quote(f'User-Agent: {ua}')} \\
  -H {_shell_single_quote(f'sec-ch-ua: \"Not:A-Brand\";v=\"99\", \"Google Chrome\";v=\"{chrome_major}\", \"Chromium\";v=\"{chrome_major}\"')} \\
  -H {_shell_single_quote('sec-ch-ua-arch: \"x86\"')} \\
  -H {_shell_single_quote('sec-ch-ua-bitness: \"64\"')} \\
  -H {_shell_single_quote('sec-ch-ua-mobile: ?0')} \\
  -H {_shell_single_quote('sec-ch-ua-model: \"\"')} \\
  -H {_shell_single_quote(f'sec-ch-ua-platform: \"{platform}\"')} \\
  -H {_shell_single_quote(f'Cookie: {cookie}')} \\
  --compressed
"""
    CURL_PATH.write_text(content, encoding="utf-8")
    if os.name == "posix":
        os.chmod(CURL_PATH, 0o600)
    print(f"[+] {CURL_PATH.name} guncellendi.")
    _send_telegram_message("âœ… Yeni Sahibinden cookie'leri basariyla alindi ve sistem guncellendi!")



def refresh_cookie(headless: bool = False) -> bool:
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

    print("[*] Toplu ilan cekimi baslatiliyor (aiohttp hizli motor)...")
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



def main() -> None:
    parser = argparse.ArgumentParser(description="Sahibinden cookie/scrape yardimcisi")
    parser.add_argument("--headless", action="store_true", help="Cookie alirken Chrome'u headless modda calistir (Sanal Ekran haric)")
    parser.add_argument("--refresh-only", action="store_true", help="Sadece cookie yenile")
    parser.add_argument("--run-scraper", action="store_true", help="Cookie yenilemeden sonra bulk_scraper.py calistir")
    parser.add_argument("--start-server", action="store_true", help="Cookie yenilemeden sonra API sunucusunu baslat")
    parser.add_argument("--host", default="127.0.0.1", help="API sunucu host")
    parser.add_argument("--port", type=int, default=8000, help="API sunucu port")
    parser.add_argument("--xvfb", action="store_true", help="Linux sunucular icin Xvfb sanal ekranini kullanir")
    args = parser.parse_args()

    # Varsayilan davranis (eski akisa uyumlu): yenile + scraper + server
    if args.refresh_only:
        do_scraper = False
        do_server = False
    elif args.run_scraper or args.start_server:
        do_scraper = args.run_scraper
        do_server = args.start_server
    else:
        do_scraper = True
        do_server = True

    display = None
    if args.xvfb:
        if Display is None:
            print("[-] pyvirtualdisplay kurulu degil. Xvfb atlaniyor (Windows'ta gerekmez).")
        else:
            print("[*] Xvfb sanal ekran (Virtual Display) baslatiliyor...")
            try:
                display = Display(visible=False, size=(1920, 1080))
                display.start()
            except Exception as e:
                print(f"[-] Xvfb baslatilamadi (Linux'ta misiniz ve Xvfb kurulu mu?): {e}")

    try:
        ok = refresh_cookie(headless=args.headless)
        if not ok:
            raise SystemExit(1)

        if do_scraper:
            code = run_scraper()
            if code != 0:
                raise SystemExit(code)

        if do_server:
            start_server(host=args.host, port=args.port)

        print("[+] Tamamlandi!")
    finally:
        if display:
            display.stop()
            print("[*] Xvfb sanal ekran (Virtual Display) kapatildi.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[!] Iptal edildi.")



