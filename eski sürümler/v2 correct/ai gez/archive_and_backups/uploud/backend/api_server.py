#!/usr/bin/env python3
"""Sahibinden ilanları için yerel API sunucusu + HTML viewer."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

# ==========================================
# DOSYA YOLLARI
# ==========================================
ROOT_DIR     = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT_DIR / "frontend"
SCRAPER_PATH = ROOT_DIR / "bulk_scraper.py"
BASE_URL     = "https://www.sahibinden.com"
JSON_GLOB_PATTERNS = ("ilanlar.json", "*ilan*.json")

# Aktif scrape işlemi takibi
_scrape_lock   = threading.Lock()
_scrape_active = False


# ==========================================
# JSON OKUYUCU
# ==========================================
def _normalize(raw: dict[str, Any]) -> dict[str, str]:
    """Ham veriyi standart formata dönüştürür."""
    price = raw.get("price", raw.get("priceFormatted", raw.get("fiyat", "")))
    if isinstance(price, dict):
        price = price.get("value", "")

    image = raw.get("image", raw.get("thumbnail", raw.get("resim", "")))
    if isinstance(image, dict):
        image = image.get("url", image.get("src", ""))

    link = str(raw.get("url", raw.get("detailUrl", raw.get("link", "")))).strip()
    if link and not link.startswith("http"):
        link = f"{BASE_URL}{link}"

    return {
        "ilan_id": str(raw.get("id", raw.get("classifiedId", raw.get("ilan_id", "")))),
        "baslik":  str(raw.get("title", raw.get("subject", raw.get("baslik", "")))).strip(),
        "fiyat":   str(price).strip(),
        "konum":   str(raw.get("location", raw.get("townName", raw.get("konum", "")))).strip(),
        "tarih":   str(raw.get("date", raw.get("dateFormatted", raw.get("tarih", "")))).strip(),
        "link":    link,
        "resim":   str(image).strip() if image else "",
    }


def _load_json(path: Path) -> list[dict[str, str]]:
    """Tek bir JSON dosyasından ilanları yükler."""
    if not path.exists():
        return []

    data = json.loads(path.read_text(encoding="utf-8"))
    raw  = data.get("ilanlar", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])

    results = []
    for it in raw:
        if isinstance(it, dict):
            norm = _normalize(it)
            if norm["baslik"]:
                results.append(norm)
    return results


def _find_best_json() -> tuple[list[dict[str, str]], str]:
    """En güncel JSON dosyasını bulup yükler."""
    candidates: list[Path] = []
    seen: set[str] = set()

    for pattern in JSON_GLOB_PATTERNS:
        for p in ROOT_DIR.rglob(pattern):
            key = str(p.resolve()).lower()
            if p.is_file() and key not in seen:
                seen.add(key)
                candidates.append(p)

    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    for c in candidates:
        try:
            listings = _load_json(c)
            if listings:
                return listings, str(c)
        except Exception:
            continue

    return [], ""


def _deduplicate(listings: list[dict[str, str]]) -> list[dict[str, str]]:
    """Tekrarlanan ilanları temizler."""
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for item in listings:
        key = item.get("ilan_id") or item.get("link", "")
        if key and key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


# ==========================================
# ARKA PLANDA SCRAPE TETIKLE
# ==========================================
def _trigger_scrape_background() -> bool:
    """bulk_scraper.py'yi arka planda başlatır. True döndürürse başlatıldı."""
    global _scrape_active
    with _scrape_lock:
        if _scrape_active:
            return False  # Zaten çalışıyor
        _scrape_active = True

    def _run():
        global _scrape_active
        try:
            subprocess.run(
                [sys.executable, str(SCRAPER_PATH)],
                cwd=str(ROOT_DIR),
                timeout=600,  # 10 dakika max
            )
        except Exception:
            pass
        finally:
            with _scrape_lock:
                _scrape_active = False

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return True


# ==========================================
# HTTP SUNUCU
# ==========================================
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        # Sadece önemli mesajları logla
        if len(args) >= 2 and str(args[1]) not in ("200", "304"):
            super().log_message(format, *args)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path

        if path in ("/favicon.ico",) or path.startswith("/.well-known/"):
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return

        if path == "/api/listings":
            self._serve_listings(parse_qs(urlparse(self.path).query))
            return

        if path == "/api/scrape":
            self._trigger_scrape()
            return

        if path == "/api/scrape/status":
            self._scrape_status()
            return

        if path == "/health":
            self._json({"status": "ok"})
            return

        super().do_GET()

    def _serve_listings(self, query: dict[str, list[str]]) -> None:
        """JSON dosyasından ilanları okuyup API olarak sunar."""
        messages: list[str] = []

        listings, json_path = _find_best_json()
        if listings:
            listings = _deduplicate(listings)
            messages.append(f"JSON: {Path(json_path).name} ({len(listings):,} ilan)")
        else:
            messages.append("İlan bulunamadı. Lütfen scrape işlemi başlatın.")

        # Pagination parametreleri
        try:
            page      = int(query.get("page",  ["1"])[0])
            page_size = int(query.get("size",  ["0"])[0])  # 0 = tümünü döndür
        except (ValueError, IndexError):
            page, page_size = 1, 0

        # Arama filtresi
        q = (query.get("q", [""])[0] or "").strip().lower()
        if q:
            listings = [
                it for it in listings
                if q in (it.get("baslik") or "").lower()
                or q in (it.get("konum") or "").lower()
                or q in (it.get("ilan_id") or "").lower()
                or q in (it.get("fiyat") or "").lower()
            ]

        total = len(listings)

        # Sayfalama
        if page_size > 0:
            start    = (page - 1) * page_size
            listings = listings[start:start + page_size]
            pages    = max(1, -(-total // page_size))  # ceiling division
        else:
            pages = 1

        self._json({
            "source":    "json" if listings else "none",
            "json_path": json_path,
            "count":     total,
            "page":      page,
            "pages":     pages,
            "listings":  listings,
            "messages":  messages,
            "scrape_active": _scrape_active,
        })

    def _trigger_scrape(self) -> None:
        """bulk_scraper.py'yi başlatır."""
        if not SCRAPER_PATH.exists():
            self._json({"ok": False, "error": "bulk_scraper.py bulunamadı"}, HTTPStatus.NOT_FOUND)
            return

        started = _trigger_scrape_background()
        self._json({
            "ok":      True,
            "started": started,
            "message": "Scrape başlatıldı" if started else "Scrape zaten çalışıyor",
        })

    def _scrape_status(self) -> None:
        """Aktif scrape durumunu döndürür."""
        _, json_path = _find_best_json()
        self._json({
            "active":    _scrape_active,
            "json_path": json_path,
        })

    def _json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type",   "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)


# ==========================================
# ANA GİRİŞ NOKTASI
# ==========================================
def main() -> None:
    parser = argparse.ArgumentParser(description="Sahibinden ilan sunucusu")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--skip-cookie-check", action="store_true")
    args = parser.parse_args()

    if not FRONTEND_DIR.exists():
        raise FileNotFoundError(f"Frontend klasörü bulunamadı: {FRONTEND_DIR}")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print("=" * 50)
    print(f"  Sahibinden API Sunucusu")
    print(f"  http://{args.host}:{args.port}/")
    print(f"  Durdurmak icin: Ctrl+C")
    print("=" * 50)
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSunucu durduruldu.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
