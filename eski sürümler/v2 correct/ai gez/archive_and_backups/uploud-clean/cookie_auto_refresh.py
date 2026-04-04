"""Cookie auto-refresh runner for server use.

Kullanim:
  - Tek sefer kontrol/yenile:  python cookie_auto_refresh.py --once
  - Surekli daemon:            python cookie_auto_refresh.py --daemon
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from dataclasses import dataclass

from dotenv import load_dotenv
load_dotenv()

from curl_cffi import requests as cffi_requests

from bulk_scraper import parse_curl
from sahibinden_bot import PROJECT_ROOT, SCRAPER_PATH, refresh_cookie
from telegram_cookie_bridge import send_cookie_payload

CURL_FILE = PROJECT_ROOT / "curl_request.sh"


@dataclass
class CookieCheckResult:
    ok: bool
    reason: str
    http_status: int | None = None


def log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def cookie_age_minutes() -> float:
    if not CURL_FILE.exists():
        return float("inf")
    age_seconds = time.time() - CURL_FILE.stat().st_mtime
    return age_seconds / 60


def validate_cookie(timeout_seconds: int) -> CookieCheckResult:
    if not CURL_FILE.exists():
        return CookieCheckResult(False, "curl_request.sh yok")

    try:
        config = parse_curl()
    except Exception as exc:
        return CookieCheckResult(False, f"curl parse hatasi: {exc}")

    try:
        resp = cffi_requests.get(
            config["url"],
            headers=config["headers"],
            timeout=timeout_seconds,
            impersonate="chrome",
        )
    except Exception as exc:
        return CookieCheckResult(False, f"istek hatasi: {exc}")

    if resp.status_code != 200:
        return CookieCheckResult(False, f"HTTP {resp.status_code}", resp.status_code)

    body = resp.text.lower()
    has_listing_markup = ("searchresultsitem" in body) or ("searchresults" in body)
    cloudflare_signals = ("just a moment", "cf-chl", "attention required", "cloudflare")

    if any(token in body for token in cloudflare_signals) and not has_listing_markup:
        return CookieCheckResult(False, "cloudflare challenge sayfasi", resp.status_code)

    if not has_listing_markup and "ilan" not in body:
        return CookieCheckResult(False, "beklenmeyen cevap govdesi", resp.status_code)

    return CookieCheckResult(True, "cookie gecerli", resp.status_code)


def run_scraper() -> int:
    if not SCRAPER_PATH.exists():
        log("bulk_scraper.py bulunamadi, scraper adimi atlandi.")
        return 0
    log("bulk_scraper.py tetikleniyor...")
    result = subprocess.run([sys.executable, str(SCRAPER_PATH)], cwd=str(PROJECT_ROOT))
    if result.returncode != 0:
        log(f"bulk_scraper.py hata kodu: {result.returncode}")
    return result.returncode


def run_once(
    force_refresh_after_min: int,
    timeout_seconds: int,
    headless: bool,
    run_scraper_on_refresh: bool,
    send_telegram_on_refresh: bool,
    send_gcs_on_refresh: bool,
) -> int:
    age = cookie_age_minutes()
    force_due = age >= force_refresh_after_min
    check = validate_cookie(timeout_seconds=timeout_seconds)

    if not check.ok or force_due:
        reason = check.reason if not check.ok else f"{force_refresh_after_min} dk yas siniri asildi"
        log(f"Cookie yenilenecek: {reason}")

        if not refresh_cookie(headless=headless):
            log("Cookie yenileme basarisiz.")
            return 1

        log("Cookie yenilendi.")

        if send_telegram_on_refresh or send_gcs_on_refresh:
            try:
                config = parse_curl()
                headers = config.get("headers", {})
                cookie = str(headers.get("Cookie", "")).strip()
                ua = str(headers.get("User-Agent", "")).strip()
                if cookie and ua:
                    if send_telegram_on_refresh:
                        ok, msg = send_cookie_payload(
                            cookie=cookie,
                            ua=ua,
                            reason=reason,
                            source="cookie_auto_refresh",
                        )
                        if ok:
                            log("Cookie Telegram'a gonderildi.")
                        else:
                            log(f"Uyari: Telegram gonderimi basarisiz: {msg}")

                    if send_gcs_on_refresh:
                        try:
                            from gcs_cookie_bridge import upload_cookie_payload

                            ok, msg = upload_cookie_payload(
                                cookie=cookie,
                                ua=ua,
                                reason=reason,
                                source="cookie_auto_refresh",
                            )
                            if ok:
                                log("Cookie GCS'e yuklendi.")
                            else:
                                log(f"Uyari: GCS yukleme basarisiz: {msg}")
                        except Exception as exc:
                            log(f"Uyari: GCS adimi exception verdi: {exc}")
                else:
                    log("Uyari: bridge gonderimi atlandi (cookie/ua bos).")
            except Exception as exc:
                log(f"Uyari: bridge hazirlama adimi exception verdi: {exc}")

        # Yenilemeden sonra hizli dogrulama
        check_after = validate_cookie(timeout_seconds=timeout_seconds)
        if not check_after.ok:
            log(f"Uyari: yenileme sonrasi dogrulama basarisiz: {check_after.reason}")
            return 2

        if run_scraper_on_refresh:
            return run_scraper()

        return 0

    log(f"Cookie gecerli (yas: {age:.1f} dk).")
    return 0


def run_daemon(args: argparse.Namespace) -> int:
    interval_seconds = max(60, int(args.check_interval_min) * 60)
    log(
        "Daemon basladi. "
        f"Kontrol araligi={args.check_interval_min} dk, "
        f"force_refresh={args.force_refresh_after_min} dk."
    )
    while True:
        code = run_once(
            force_refresh_after_min=args.force_refresh_after_min,
            timeout_seconds=args.timeout_seconds,
            headless=args.headless,
            run_scraper_on_refresh=args.run_scraper_on_refresh,
            send_telegram_on_refresh=args.send_telegram_on_refresh,
            send_gcs_on_refresh=args.send_gcs_on_refresh,
        )
        if code != 0 and args.exit_on_error:
            log(f"Daemon durduruluyor (hata kodu: {code}).")
            return code
        time.sleep(interval_seconds)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Cookie otomatik yenileyici")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="Tek sefer kontrol et/yenile")
    mode.add_argument("--daemon", action="store_true", help="Surekli calis")

    parser.add_argument("--headless", action="store_true", help="Chrome'u headless modda ac")
    parser.add_argument(
        "--check-interval-min",
        type=int,
        default=15,
        help="Daemon modunda kontrol araligi (dakika)",
    )
    parser.add_argument(
        "--force-refresh-after-min",
        type=int,
        default=90,
        help="Cookie bu dakikayi asarsa zorunlu yenile",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=25,
        help="Cookie dogrulama istek timeout'u",
    )
    parser.add_argument(
        "--run-scraper-on-refresh",
        action="store_true",
        help="Cookie yenilenince bulk_scraper.py tetikle",
    )
    parser.add_argument(
        "--send-telegram-on-refresh",
        action="store_true",
        help="Cookie yenilenince Telegram'a payload gonder",
    )
    parser.add_argument(
        "--send-gcs-on-refresh",
        action="store_true",
        help="Cookie yenilenince GCS'e payload gonder",
    )
    parser.add_argument(
        "--exit-on-error",
        action="store_true",
        help="Daemon modunda hata olursa cik",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # Varsayilan mod: once (timer/cron ile kolay entegrasyon)
    daemon_mode = args.daemon
    if daemon_mode:
        raise SystemExit(run_daemon(args))

    code = run_once(
        force_refresh_after_min=args.force_refresh_after_min,
        timeout_seconds=args.timeout_seconds,
        headless=args.headless,
        run_scraper_on_refresh=args.run_scraper_on_refresh,
        send_telegram_on_refresh=args.send_telegram_on_refresh,
        send_gcs_on_refresh=args.send_gcs_on_refresh,
    )
    raise SystemExit(code)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Iptal edildi.")
