import os
import sys
import time
import json
import random
from pathlib import Path
from dotenv import load_dotenv  # type: ignore
from curl_cffi import requests  # type: ignore

load_dotenv()

COOKIE_FILE = Path(__file__).parent / "cookies.json"
OUTPUT_FILE = Path(__file__).parent / "scraped_data.json"
TARGET_URL = os.getenv("TARGET_URL", "https://www.sahibinden.com/ekran-karti-masaustu")

# WARP SOCKS5 Proxy
WARP_SOCKS5 = os.getenv("WARP_SOCKS5", "socks5://127.0.0.1:40000")


def read_cookies():
    """cookies.json dosyasından çerezleri oku."""
    if not COOKIE_FILE.exists():
        print("[-] HATA: cookies.json bulunamadı!")
        return None, None, None

    with open(COOKIE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    age_minutes = (time.time() - data.get("timestamp", 0)) / 60
    if age_minutes > 60:
        print(f"[-] UYARI: Cookie {age_minutes:.0f}dk eski!")
    else:
        print(f"[+] Cookie yaşı: {age_minutes:.1f}dk (geçerli)")

    method = data.get("method", "bilinmiyor")
    print(f"[*] Cookie yöntemi: {method}")

    return data.get("cookies", {}), data.get("user_agent", ""), method


def _determine_proxy(method):
    """Cookie yöntemine göre proxy belirle."""
    # WARP ile alınan cookie'ler aynı IP'den scrape edilmeli
    if method in ("nodriver", "nodriver_warp") or "warp" in str(method):
        print(f"[+] WARP proxy aktif (cookie IP sabitleme): {WARP_SOCKS5}")
        return {"http": WARP_SOCKS5, "https": WARP_SOCKS5}

    # Camoufox/SeleniumBase: doğrudan bağlantı (GCP IP)
    print("[*] Doğrudan bağlantı (GCP IP)")
    return None


def scrape_pages(target_url, cookies, user_agent, method, max_pages=3):
    print(f"\n[*] Hızlı İlan Çekimi (Max: {max_pages} Sayfa)")

    proxies = _determine_proxy(method)

    headers = {
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "max-age=0",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1"
    }

    results = []
    consecutive_errors = 0

    for page_num in range(1, max_pages + 1):
        print(f"\n[*] >>> SAYFA {page_num} <<<")

        offset = (page_num - 1) * 20
        page_url = f"{target_url}?pagingOffset={offset}" if offset > 0 else target_url

        try:
            response = requests.get(
                page_url,
                cookies=cookies,
                headers=headers,
                impersonate="chrome131",
                proxies=proxies,
                timeout=20
            )

            if response.status_code == 200:
                print(f"  [+] Başarılı! {len(response.text)} bayt")
                results.append(f"[VERI] Sayfa {page_num} - {len(response.text)} bayt")
                consecutive_errors = 0

            elif response.status_code == 403:
                print("  [-] 403 Forbidden — Cloudflare engeli!")
                consecutive_errors += 1
                if consecutive_errors >= 2:
                    print("  [-] Art arda 2 hata. Durduruluyor.")
                    break

            elif response.status_code == 429:
                print("  [-] 429 Rate limit!")
                wait = random.uniform(10, 20)
                print(f"  [*] {wait:.0f}sn bekleniyor...")
                time.sleep(wait)
                consecutive_errors += 1

            else:
                print(f"  [-] HTTP {response.status_code}")
                consecutive_errors += 1

        except Exception as e:
            print(f"  [-] Ağ Hatası: {e}")
            consecutive_errors += 1
            if consecutive_errors >= 3:
                break

        if page_num < max_pages:
            delay = random.uniform(2.5, 6.5)
            print(f"  [*] Anti-Ban: {delay:.2f}sn")
            time.sleep(delay)

    return results


def send_to_ai(data_list):
    print("\n==================================")
    print("[*] 3. Aşama: YAPAY ZEKA ANALİZİ")
    print("==================================")
    print(f"[*] {len(data_list)} parça veri AI'ye gönderiliyor...")
    # TODO: OpenAI / Gemini / Claude API Entegrasyonu
    time.sleep(2)
    print("[+] AI analiz tamamlandı!")


def main():
    print("=" * 50)
    print("  Sahibinden Hızlı Scraper (V3 — GCP Otonom)")
    print("=" * 50)

    cookies, ua, method = read_cookies()
    if not cookies or not ua:
        sys.exit(1)

    print(f"[*] User-Agent: {ua[:60]}...")

    scraped_data = scrape_pages(TARGET_URL, cookies, ua, method, max_pages=3)

    if scraped_data:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(scraped_data, f, indent=4)
        print(f"\n[+] Veriler → {OUTPUT_FILE.name}")
        send_to_ai(scraped_data)
    else:
        print("\n[-] Hiçbir veri çekilemedi.")

if __name__ == "__main__":
    main()
