"""Sahibinden çerez çekici — Chrome ile otomatik cookie alır ve sunucuyu başlatır."""
import os
import sys
import time
import subprocess
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Windows terminal UTF-8 desteği
if sys.stdout and getattr(sys.stdout, "encoding", None) and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

# ==========================================
# AYARLAR
# ==========================================
SAHIBINDEN_URL = "https://www.sahibinden.com/ekran-karti-masaustu"
CHROME_PROFILE_DIR = os.path.join(os.getcwd(), ".chrome_profile")
CHROME_VERSION = 145


def get_cookie_and_ua() -> tuple[str | None, str | None]:
    """
    Tek bir Chrome penceresi açar → Sahibinden'e girer →
    aşağı kaydırıp 2. sayfaya tıklar (Cloudflare bypass) →
    çerezleri ve User-Agent'ı döndürür → Chrome'u kapatır.
    """
    print("[*] Chrome açılıyor...")
    driver = None
    try:
        opts = uc.ChromeOptions()
        opts.add_argument(f"--user-data-dir={CHROME_PROFILE_DIR}")
        opts.add_argument("--disable-gpu")

        driver = uc.Chrome(options=opts, version_main=CHROME_VERSION)

        # 1) İlk sayfayı yükle
        print("[*] Sahibinden'e gidiliyor...")
        driver.get(SAHIBINDEN_URL)

        try:
            WebDriverWait(driver, 20).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "tr.searchResultsItem"))
            )
            print("[+] İlk sayfa yüklendi!")
            time.sleep(2)
        except Exception:
            print("[!] İlk sayfa tam yüklenmedi, devam ediliyor...")

        # 2) Aşağı kaydır + 2. sayfaya tıkla (Cloudflare cookie tetiklemesi)
        print("[*] Aşağı kaydırılıp 2. sayfaya tıklanıyor...")
        try:
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(1.5)

            btn = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable(
                    (By.CSS_SELECTOR, "ul.pageNaviButtons li a.prevNextBut[title='Sonraki']")
                )
            )
            driver.execute_script("arguments[0].click();", btn)
            print("[+] 2. sayfaya tıklandı...")

            WebDriverWait(driver, 15).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "tr.searchResultsItem"))
            )
            print("[+] 2. sayfa yüklendi, çerezler oturdu!")
            time.sleep(3)
        except Exception as e:
            print(f"[!] 2. sayfa hatası: {e}")
            driver.get(f"{SAHIBINDEN_URL}?pagingOffset=50&pagingSize=50")
            time.sleep(4)

        # 3) Cookie ve UA al
        cookies = driver.get_cookies()
        ua = driver.execute_script("return navigator.userAgent;")

        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
        print(f"[+] {len(cookies)} çerez alındı.")
        return cookie_str or None, ua

    except Exception as e:
        print(f"[-] Chrome hatası: {e}")
        return None, None

    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
            print("[*] Tarayıcı kapatıldı.")


def save_curl(cookie: str, ua: str) -> None:
    """curl_request.sh dosyasını günceller."""
    path = os.path.join(os.getcwd(), "curl_request.sh")
    content = f"""#!/bin/bash
# Sahibinden.com - otomatik oluşturuldu

curl '{SAHIBINDEN_URL}' \\
  -H 'Upgrade-Insecure-Requests: 1' \\
  -H 'User-Agent: {ua}' \\
  -H 'sec-ch-ua: "Not:A-Brand";v="99", "Google Chrome";v="{CHROME_VERSION}", "Chromium";v="{CHROME_VERSION}"' \\
  -H 'sec-ch-ua-arch: "x86"' \\
  -H 'sec-ch-ua-bitness: "64"' \\
  -H 'sec-ch-ua-mobile: ?0' \\
  -H 'sec-ch-ua-model: ""' \\
  -H 'sec-ch-ua-platform: "Windows"' \\
  -H 'Cookie: {cookie}' \\
  --compressed
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("[+] curl_request.sh güncellendi.")


def start_server() -> None:
    """API sunucusunu yeni pencerede başlatır."""
    server = os.path.join(os.getcwd(), "backend", "api_server.py")
    if not os.path.exists(server):
        print("[-] backend/api_server.py bulunamadı!")
        return

    print("[*] Sunucu başlatılıyor: http://127.0.0.1:8000/")
    if os.name == "nt":
        subprocess.Popen(
            [sys.executable, server, "--skip-cookie-check"],
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )
    else:
        subprocess.Popen([sys.executable, server, "--skip-cookie-check"])


def main() -> None:
    cookie, ua = get_cookie_and_ua()

    if not cookie:
        print("[-] Cookie alınamadı!")
        return

    if not ua:
        ua = f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/{CHROME_VERSION}.0.0.0 Safari/537.36"

    save_curl(cookie, ua)

    # Toplu ilan çekimi (hızlı aiohttp motoru)
    print()
    scraper_path = os.path.join(os.getcwd(), "bulk_scraper.py")
    if os.path.exists(scraper_path):
        print("[*] Toplu ilan çekimi başlatılıyor (aiohttp hızlı motor)...")
        result = subprocess.run(
            [sys.executable, scraper_path],
            cwd=os.getcwd(),
        )
        if result.returncode != 0:
            print("[-] Toplu çekim başarısız oldu!")
    else:
        print("[!] bulk_scraper.py bulunamadı, toplu çekim atlanıyor.")

    # Sunucuyu başlat
    print()
    start_server()
    print("[+] Tamamlandı!")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[!] İptal edildi.")
