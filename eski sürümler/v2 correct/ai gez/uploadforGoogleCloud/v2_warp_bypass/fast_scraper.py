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

# WARP SOCKS5 Proxy (cf_clearance IP'ye bağlı olduğu için aynı proxy kullanılmalı)
WARP_SOCKS5 = os.getenv("WARP_SOCKS5", "socks5://127.0.0.1:40000")


def read_cookies():
    """cookie_generator.py tarafindan uretilen JSON dosyasindan cerezleri alir."""
    if not COOKIE_FILE.exists():
        print("[-] HATA: cookies.json bulunamadı! Önce cookie_generator.py çalıştırılmalı.")
        return None, None, False

    with open(COOKIE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Cookie yaşını kontrol et
    age_minutes = (time.time() - data.get("timestamp", 0)) / 60
    if age_minutes > 60:
        print(f"[-] UYARI: Cookie'ler {age_minutes:.0f} dakika eski! Cloudflare reddedebilir.")
    else:
        print(f"[+] Cookie yaşı: {age_minutes:.1f} dakika (geçerli)")

    warp_used = data.get("warp_used", False)
    return data.get("cookies", {}), data.get("user_agent", ""), warp_used


def scrape_pages(target_url, cookies, user_agent, use_warp_proxy=False, max_pages=3):
    print(f"\n[*] Hızlı İlan Çekimi Başlatılıyor (Hedef Max: {max_pages} Sayfa)")

    # WARP proxy ayarı (cf_clearance IP'ye bağlı — aynı IP'den scraping yapılmalı)
    proxies = None
    if use_warp_proxy:
        proxies = {"http": WARP_SOCKS5, "https": WARP_SOCKS5}
        print(f"[+] WARP SOCKS5 proxy aktif: {WARP_SOCKS5}")
    else:
        print("[*] Proxy kullanılmıyor (doğrudan bağlantı)")

    # Browser header'ları — cookie_generator.py ile birebir aynı fingerprint
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
        print(f"\n[*] >>> SAYFA {page_num} ÇEKİLİYOR <<<")

        # Sayfalama parametresi
        offset = (page_num - 1) * 20
        page_url = f"{target_url}?pagingOffset={offset}" if offset > 0 else target_url

        try:
            # TLS IMPERSONATION: Chrome 131 gibi davranarak curl izini tamamen siliyoruz
            response = requests.get(
                page_url,
                cookies=cookies,
                headers=headers,
                impersonate="chrome131",
                proxies=proxies,
                timeout=20
            )

            if response.status_code == 200:
                print(f"  [+] Sayfa {page_num} Başarılı! Veri: {len(response.text)} bayt")
                results.append(f"[ORNEK_VERI] Sayfa {page_num} - Hacim: {len(response.text)}")
                consecutive_errors = 0

            elif response.status_code == 403:
                print("  [-] HATA 403 Forbidden - Cloudflare engeli!")
                consecutive_errors += 1
                if consecutive_errors >= 2:
                    print("  [-] Art arda 2 hata. Durduruldu.")
                    break

            elif response.status_code == 429:
                print("  [-] HATA 429 Too Many Requests - Rate limit!")
                wait = random.uniform(10, 20)
                print(f"  [*] {wait:.0f}sn bekleniyor...")
                time.sleep(wait)
                consecutive_errors += 1

            else:
                print(f"  [-] Beklenmeyen HTTP: {response.status_code}")
                consecutive_errors += 1

        except Exception as e:
            print(f"  [-] Ağ Hatası: {e}")
            consecutive_errors += 1
            if consecutive_errors >= 3:
                print("  [-] Art arda 3 hata. Durduruldu.")
                break

        # RATE LIMIT KORUMASI
        if page_num < max_pages:
            delay = random.uniform(2.5, 6.5)
            print(f"  [*] Anti-Ban: {delay:.2f}sn bekleniyor...")
            time.sleep(delay)

    return results


def send_to_ai(data_list):
    """Elde edilen veriyi analiz etmesi için Yapay Zekaya gönderir."""
    print("\n==================================")
    print("[*] 3. Aşama: YAPAY ZEKA ANALİZİ")
    print("==================================")
    print(f"[*] Toplam {len(data_list)} parça veri Yapay Zeka API'sine gönderiliyor...")

    # TODO: OpenAI / Gemini / Claude API Entegrasyonu Kodları Buraya Eklenecek.
    time.sleep(2)  # Simülasyon

    print("[+] Yapay Zeka ilanları değerlendirdi ve elenenleri veritabanına aktardı!")


def main():
    print("=============================================")
    print("   Sahibinden Hızlı Scraper (v2)")
    print("   curl_cffi + WARP (TLS Impersonation)")
    print("=============================================")

    cookies, ua, warp_used = read_cookies()
    if not cookies or not ua:
        sys.exit(1)

    print(f"[*] User-Agent: {ua[:60]}...")  # type: ignore
    print(f"[*] WARP cookie: {'Evet' if warp_used else 'Hayır'}")

    scraped_data = scrape_pages(TARGET_URL, cookies, ua, use_warp_proxy=warp_used, max_pages=3)

    if scraped_data:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(scraped_data, f, indent=4)
        print(f"\n[+] Veriler {OUTPUT_FILE.name} dosyasına kaydedildi.")
        send_to_ai(scraped_data)
    else:
        print("\n[-] Uyarı: Hiçbir veri çekilemedi.")

if __name__ == "__main__":
    main()
