"""
Sahibinden Hızlı Toplu Çekici
─────────────────────────────
• curl_request.sh'den cookie/header okur
• curl_cffi ile Chrome TLS parmak izi taklit eder (Cloudflare bypass)
• Fiyat segmentasyonu ile 1000-ilan sınırını aşar (10.000+ ilan)
• Paralel segment çekimi → kısa sürede tamamlanır
• Sonuçları ilanlar.json'a yazar
"""
import json
import math
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from dotenv import load_dotenv
load_dotenv()

from curl_cffi import requests as cffi_requests
from bs4 import BeautifulSoup

# Windows UTF-8
if sys.stdout and getattr(sys.stdout, "encoding", None) and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

# ==========================================
# AYARLAR
# ==========================================
PROJECT_ROOT = Path(__file__).resolve().parent
CURL_FILE = PROJECT_ROOT / "curl_request.sh"
OUTPUT_FILE = PROJECT_ROOT / "ilanlar.json"
BASE_URL = "https://www.sahibinden.com"


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


# Paralel segment sayısı (fazla artırmayın — Cloudflare sizi engeller)
SEGMENT_WORKERS = _env_int("SEGMENT_WORKERS", 4)
# Her segment içinde paralel sayfa çekme (daha güvenli: 2-3)
PAGE_WORKERS = _env_int("PAGE_WORKERS", 3)
PAGE_SIZE = _env_int("PAGE_SIZE", 50)                             # Sayfa başına ilan
MAX_PAGES_PER_SEGMENT = _env_int("MAX_PAGES_PER_SEGMENT", 20)     # Segment başına max sayfa
REQUEST_DELAY = _env_float("REQUEST_DELAY", 0.6)                  # İstekler arası bekleme (sn)
REQUEST_TIMEOUT = _env_int("REQUEST_TIMEOUT", 25)                 # İstek zaman aşımı (sn)
MAX_RETRIES = _env_int("MAX_RETRIES", 3)

# Fiyat segmentleri (TL) — tüm fiyat aralığını kapsar
PRICE_SEGMENTS = [
    (0,      1500),
    (1500,   3000),
    (3000,   5000),
    (5000,   7500),
    (7500,   10000),
    (10000,  15000),
    (15000,  20000),
    (20000,  30000),
    (30000,  50000),
    (50000,  100000),
    (100000, 300000),
    (300000, 1000000),
]


# ==========================================
# CURL PARSER
# ==========================================
def parse_curl() -> dict:
    """curl_request.sh'den cookie ve header bilgilerini çıkarır."""
    if not CURL_FILE.exists():
        raise FileNotFoundError("curl_request.sh bulunamadı! Önce sahibinden_bot.py çalıştırın.")

    url = ""
    headers: dict[str, str] = {}

    content = CURL_FILE.read_text(encoding="utf-8")

    for raw in content.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.endswith("\\"):
            line = line[:-1].strip()

        if line.startswith("curl "):
            m = re.search(r"curl\s+'([^']+)'", line)
            if m:
                url = m.group(1)
        elif line.startswith("-H "):
            m = re.search(r"-H\s+'([^:]+):\s*(.*)'$", line)
            if m:
                headers[m.group(1).strip()] = m.group(2).strip()

    if not url:
        raise ValueError("curl_request.sh içinde URL bulunamadı!")

    # Sorunlu header'ları temizle
    blocked = {"host", "content-length", "accept-encoding", "connection"}
    headers = {k: v for k, v in headers.items() if k.lower() not in blocked and not k.startswith(":")}

    # Eksik header'ları tamamla
    headers.setdefault("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
    headers.setdefault("Accept-Language", "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7")
    headers.setdefault("Referer", "https://www.sahibinden.com/")

    return {"url": url, "headers": headers}


# ==========================================
# URL BUILDER
# ==========================================
def build_url(base_url: str, offset: int, price_min: int | None = None, price_max: int | None = None) -> str:
    parsed = urlparse(base_url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    params["pagingOffset"] = [str(offset)]
    params["pagingSize"]   = [str(PAGE_SIZE)]

    if price_min is not None:
        params["price_min"] = [str(price_min)]
    if price_max is not None:
        params["price_max"] = [str(price_max)]

    return urlunparse(parsed._replace(query=urlencode(params, doseq=True)))


# ==========================================
# HTML PARSER
# ==========================================
def parse_page(html: str) -> tuple[list[dict], int]:
    """HTML'den ilan listesi ve toplam ilan sayısını çıkarır."""
    soup = BeautifulSoup(html, "html.parser")

    total = 0
    # Birden fazla selector dene
    for selector in (".result-text", "#searchResultsCount", ".searchResultCount",
                     "[class*='result-text']", "[class*='resultText']", "h1"):
        el = soup.select_one(selector)
        if el:
            m = re.search(r"([\d.]+)\s*ilan", el.text)
            if m:
                total = int(m.group(1).replace(".", ""))
                break

    # Selector çalışmadıysa tüm sayfa metninde ara
    if total == 0:
        m = re.search(r"([\d.]{3,})\s*ilan", soup.get_text())
        if m:
            total = int(m.group(1).replace(".", ""))

    rows = soup.select("tr.searchResultsItem")
    listings = []

    for row in rows:
        classes = row.get("class", [])
        if any(c in classes for c in ("nativeAd", "searchResultsPromoSuper", "searchResultsPromoHighlight")):
            continue

        title_el = row.select_one("a.classifiedTitle") or row.select_one("td.searchResultsTitleValue a")
        if not title_el:
            continue

        href     = title_el.get("href", "").strip()
        id_match = re.search(r"/(\d{7,})(?:/|$)", href)
        price_el = row.select_one("td.searchResultsPriceValue span") or row.select_one("td.searchResultsPriceValue div")
        loc_el   = row.select_one("td.searchResultsLocationValue")
        date_el  = row.select_one("td.searchResultsDateValue span") or row.select_one("td.searchResultsDateValue")
        img_el   = row.select_one("img")

        listings.append({
            "ilan_id": id_match.group(1) if id_match else "",
            "baslik":  title_el.get_text(strip=True),
            "fiyat":   price_el.get_text(strip=True) if price_el else "",
            "konum":   " ".join(loc_el.get_text(strip=True).split()) if loc_el else "",
            "tarih":   date_el.get_text(strip=True) if date_el else "",
            "link":    href if href.startswith("http") else f"{BASE_URL}{href}",
            "resim":   (img_el.get("src") or img_el.get("data-src", "")) if img_el else "",
        })

    return listings, total


# ==========================================
# FETCH ENGİNE (curl_cffi — Chrome TLS taklit)
# ==========================================
def fetch_page(url: str, headers: dict, label: str = "") -> str | None:
    """Tek sayfayı Chrome fingerprint'i ile çeker."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = cffi_requests.get(
                url,
                headers=headers,
                timeout=REQUEST_TIMEOUT,
                impersonate="chrome",  # Chrome TLS parmak izi taklit
            )
            if resp.status_code == 200:
                return resp.text
            elif resp.status_code == 429:
                wait = 5 * attempt
                print(f"  [!] 429 Rate Limit{' — ' + label if label else ''} — {wait}s bekleniyor...")
                time.sleep(wait)
            elif resp.status_code == 403:
                print(f"  [-] 403 Forbidden{' — ' + label if label else ''} (deneme {attempt}) — Cookie geçersiz olabilir!")
                time.sleep(3)
            else:
                print(f"  [!] HTTP {resp.status_code}{' — ' + label if label else ''} (deneme {attempt})")
                time.sleep(1)
        except Exception as e:
            print(f"  [!] Hata: {e}{' — ' + label if label else ''} (deneme {attempt})")
            time.sleep(1.5)
    return None


# ==========================================
# SEGMENT SCRAPER
# ==========================================
def scrape_segment(base_url: str, headers: dict, price_min: int, price_max: int) -> list[dict]:
    """Tek bir fiyat segmentinden tüm sayfaları çeker."""
    label = f"{price_min:,}-{price_max:,} TL"

    first_url = build_url(base_url, 0, price_min, price_max)
    html = fetch_page(first_url, headers, label)

    if not html:
        print(f"  [-] {label}: İlk sayfa alınamadı!")
        return []

    listings, total = parse_page(html)

    if not listings and total == 0:
        return []

    if total == 0:
        total = PAGE_SIZE  # En az 1 sayfa

    # Kaç sayfa çekileceğini hesapla
    total_pages = min(math.ceil(total / PAGE_SIZE), MAX_PAGES_PER_SEGMENT)

    if total_pages > 1:
        # Kalan sayfaları paralel çek
        def fetch_page_num(page_num: int):
            time.sleep(REQUEST_DELAY * (page_num % PAGE_WORKERS + 1))  # Stagger
            url = build_url(base_url, page_num * PAGE_SIZE, price_min, price_max)
            page_html = fetch_page(url, headers, f"{label} s{page_num+1}")
            if page_html:
                items, _ = parse_page(page_html)
                return items
            return []

        with ThreadPoolExecutor(max_workers=PAGE_WORKERS) as pool:
            futures = {pool.submit(fetch_page_num, p): p for p in range(1, total_pages)}
            for future in as_completed(futures):
                try:
                    items = future.result()
                    listings.extend(items)
                except Exception as e:
                    print(f"  [!] Sayfa hatası: {e}")

    print(f"  [+] {label}: {len(listings)} ilan çekildi (Sahibinden toplam: {total:,})")
    return listings


# ==========================================
# DEDUPLICATION
# ==========================================
def deduplicate(listings: list[dict]) -> list[dict]:
    seen: set[str] = set()
    unique: list[dict] = []
    for item in listings:
        key = item.get("ilan_id") or item.get("link", "")
        if key and key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


# ==========================================
# ANA ÇALIŞMA
# ==========================================
def run() -> list[dict]:
    config = parse_curl()
    base_url = config["url"]
    headers  = config["headers"]

    print("=" * 55)
    print("  SAHIBINDEN HIZLI TOPLU ÇEKİCİ")
    print("  Fiyat Segmentasyonu ile 10.000+ İlan")
    print("=" * 55)
    print(f"  Segment sayısı  : {len(PRICE_SEGMENTS)}")
    print(f"  Paralel segment : {SEGMENT_WORKERS}")
    print(f"  Paralel sayfa   : {PAGE_WORKERS}")
    print(f"  Sayfa boyutu    : {PAGE_SIZE}")
    print(f"  Max sayfa/seg.  : {MAX_PAGES_PER_SEGMENT} ({MAX_PAGES_PER_SEGMENT * PAGE_SIZE} ilan)")
    print()

    # Bağlantı testi — ilk sayfayı çek
    print("  [*] Bağlantı test ediliyor...")
    test_html = fetch_page(build_url(base_url, 0), headers, "test")
    if not test_html:
        print("  [-] Bağlantı kurulamadı! Cookie geçersiz olabilir.")
        print("      Önce sahibinden_bot.py çalıştırın.")
        return []

    _, total_all = parse_page(test_html)
    print(f"  [+] Bağlantı başarılı — Sahibinden toplam ilan: {total_all:,}")
    print()
    print("  [*] Fiyat segmentlerine göre çekim başlıyor...")
    print()

    all_listings: list[dict] = []
    start_time = time.time()

    # Segmentleri paralel çek
    with ThreadPoolExecutor(max_workers=SEGMENT_WORKERS) as pool:
        futures = {
            pool.submit(scrape_segment, base_url, headers, pmin, pmax): (pmin, pmax)
            for pmin, pmax in PRICE_SEGMENTS
        }
        for future in as_completed(futures):
            pmin, pmax = futures[future]
            try:
                segment_listings = future.result()
                all_listings.extend(segment_listings)
            except Exception as e:
                print(f"  [!] Segment {pmin:,}-{pmax:,} TL hatası: {e}")

    elapsed = time.time() - start_time
    unique = deduplicate(all_listings)
    speed = len(unique) / elapsed if elapsed > 0 else 0

    print()
    print("=" * 55)
    print("  SONUÇ")
    print("=" * 55)
    print(f"  Ham ilan sayısı        : {len(all_listings):,}")
    print(f"  Benzersiz ilan sayısı  : {len(unique):,}")
    print(f"  Toplam süre            : {elapsed:.1f} saniye")
    print(f"  Hız                    : {speed:.0f} ilan/saniye")
    print()

    return unique


def main():
    listings = run()
    if listings:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(listings, f, ensure_ascii=False, indent=2)
        print(f"  [+] {len(listings):,} ilan → {OUTPUT_FILE.name}")
        print("  [+] Sunucu çalışıyorsa http://127.0.0.1:8000/ adresini yenileyin.")
    else:
        print("  [-] Hiç ilan çekilemedi!")
        print("      Olası nedenler:")
        print("      1. Cookie süresi dolmuş → sahibinden_bot.py çalıştırın")
        print("      2. IP engelleme → Bir süre bekleyin")
        print("      3. İnternet bağlantısı sorunu")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  [!] Kullanıcı tarafından iptal edildi.")
