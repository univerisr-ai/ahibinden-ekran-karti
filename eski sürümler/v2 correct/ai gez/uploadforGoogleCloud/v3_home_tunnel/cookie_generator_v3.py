"""
V3 Ana Cookie Generator — GCP Tam Otonom Fallback Zinciri

Sıralı deneme stratejisi (GCP üzerinde, ev bağlantısı YOK):
1. Camoufox (Firefox anti-detect) → farklı fingerprint
2. SeleniumBase UC Mode → Turnstile CAPTCHA çözme
3. Nodriver + WARP → Cloudflare CDN IP ile maskeleme

Sunucu: Ubuntu 24.04 LTS, europe-west4
Tüm süreç otonom: cron job → cookie üret → Telegram → ilan çek → AI

Kullanım:
    python cookie_generator_v3.py                   # Tüm yöntemleri dene
    python cookie_generator_v3.py --method camoufox  # Sadece camoufox
    python cookie_generator_v3.py --method sb        # Sadece seleniumbase
    python cookie_generator_v3.py --method nodriver   # Sadece nodriver+warp
"""

import os
import sys
import time
import json
import argparse
import traceback
import subprocess
from pathlib import Path

import requests as http_req  # type: ignore
from dotenv import load_dotenv  # type: ignore

load_dotenv()

PROJECT_DIR = Path(__file__).parent
COOKIE_FILE = PROJECT_DIR / "cookies.json"
TELEGRAM_BOT_TOKEN_1 = os.getenv("TELEGRAM_BOT_TOKEN_1")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# Retry — her yöntem için kaç deneme
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "2"))
RETRY_DELAY = 15  # saniye


# ============================================================
#  IP Kontrol — Bilgilendirme Amaçlı
# ============================================================

def check_ip_info():
    """
    Mevcut IP adresini ve tipini logla.
    ip-api.com ücretsiz API kullanır.
    """
    try:
        resp = http_req.get(
            "http://ip-api.com/json/?fields=query,isp,org,hosting,country,city",
            timeout=10
        )
        data = resp.json()
        ip = data.get("query", "?")
        isp = data.get("isp", "?")
        is_hosting = data.get("hosting", True)
        country = data.get("country", "?")
        city = data.get("city", "?")

        ip_type = "DATACENTER" if is_hosting else "RESIDENTIAL"
        icon = "🏢" if is_hosting else "🏠"

        print(f"[*] IP: {ip} ({isp})")
        print(f"    Konum: {city}, {country}")
        print(f"    Tür: {icon} {ip_type}")

        if is_hosting:
            print("    → Datacenter IP, fallback zinciri en iyi denemelerini yapacak")
        else:
            print("    → Residential IP, başarı şansı yüksek!")

        return data
    except Exception as e:
        print(f"[-] IP kontrol hatası: {e}")
        return None


# ============================================================
#  Yöntem Çalıştırıcılar
# ============================================================

def run_camoufox():
    """Camoufox cookie generator'ı çalıştır."""
    print("\n" + "=" * 55)
    print("  🦊 YÖNTEM 1: CAMOUFOX (Firefox Anti-Detect)")
    print("=" * 55)

    script = PROJECT_DIR / "cookie_generator_camoufox.py"
    if not script.exists():
        print(f"[-] {script.name} bulunamadı!")
        return False

    try:
        result = subprocess.run(
            [sys.executable, str(script)],
            capture_output=True,
            text=True,
            timeout=300,
            env={**os.environ, "MAX_RETRIES": str(MAX_RETRIES)}
        )

        if result.stdout:
            print(result.stdout[-1200:])
        if result.stderr:
            err = result.stderr[-500:]
            if err.strip():
                print(f"[STDERR] {err}")

        if result.returncode == 0 and _verify_cookie():
            return True

    except subprocess.TimeoutExpired:
        print("[-] Camoufox 300sn timeout!")
    except Exception as e:
        print(f"[-] Camoufox çalıştırma hatası: {e}")

    return False


def run_seleniumbase():
    """SeleniumBase UC Mode cookie generator'ı çalıştır."""
    print("\n" + "=" * 55)
    print("  🌐 YÖNTEM 2: SELENIUMBASE UC MODE")
    print("=" * 55)

    script = PROJECT_DIR / "cookie_generator_sb.py"
    if not script.exists():
        print(f"[-] {script.name} bulunamadı!")
        return False

    # Ubuntu 24.04: xvfb-run ile headed mod (headless tespite takılır)
    cmd = ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1920x1080x24",
           sys.executable, str(script)]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            env={**os.environ, "MAX_RETRIES": str(MAX_RETRIES)}
        )

        if result.stdout:
            print(result.stdout[-1200:])
        if result.stderr:
            err = result.stderr[-500:]
            if err.strip():
                print(f"[STDERR] {err}")

        if result.returncode == 0 and _verify_cookie():
            return True

    except subprocess.TimeoutExpired:
        print("[-] SeleniumBase 300sn timeout!")
    except FileNotFoundError:
        print("[-] xvfb-run bulunamadı! Kurulum: sudo apt install xvfb")
    except Exception as e:
        print(f"[-] SeleniumBase çalıştırma hatası: {e}")

    return False


def run_nodriver_warp():
    """Mevcut v2 nodriver + WARP yöntemi (son çare)."""
    print("\n" + "=" * 55)
    print("  🔄 YÖNTEM 3: NODRIVER + WARP (V2 Fallback)")
    print("=" * 55)

    # Sırasıyla: lokalde ve v2 klasöründe ara
    candidates = [
        PROJECT_DIR / "cookie_generator_nodriver.py",
        PROJECT_DIR.parent / "v2_warp_bypass" / "cookie_generator.py",
    ]
    script = None
    for c in candidates:
        if c.exists():
            script = c
            break

    if not script:
        print("[-] Nodriver cookie generator bulunamadı!")
        return False

    try:
        result = subprocess.run(
            [sys.executable, str(script)],
            capture_output=True,
            text=True,
            timeout=300,
            env={**os.environ, "MAX_RETRIES": str(MAX_RETRIES)}
        )

        if result.stdout:
            print(result.stdout[-1200:])

        if result.returncode == 0 and _verify_cookie():
            return True

    except subprocess.TimeoutExpired:
        print("[-] Nodriver 300sn timeout!")
    except Exception as e:
        print(f"[-] Nodriver çalıştırma hatası: {e}")

    return False


# ============================================================
#  Yardımcılar
# ============================================================

def _verify_cookie():
    """cookies.json'daki cf_clearance geçerliliğini kontrol et."""
    if not COOKIE_FILE.exists():
        return False
    try:
        with open(COOKIE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        cookies = data.get("cookies", {})
        has_cf = "cf_clearance" in cookies
        age = (time.time() - data.get("timestamp", 0)) / 60

        if has_cf and age < 5:
            print(f"[+] ✅ cf_clearance doğrulandı! (yaş: {age:.1f}dk)")
            return True
        elif has_cf:
            print(f"[-] cf_clearance var ama eski ({age:.1f}dk)")
            return False
        else:
            print("[-] cf_clearance yok!")
            return False
    except Exception:
        return False


def _notify_final_result(success, method_used):
    """Son durumu Telegram'a bildir."""
    if not TELEGRAM_BOT_TOKEN_1 or not TELEGRAM_CHAT_ID:
        return

    if success:
        msg = f"✅ Cookie Generator V3 başarılı!\nYöntem: {method_used}"
    else:
        msg = (
            "❌ Cookie Generator V3 — TÜM YÖNTEMLER BAŞARISIZ!\n\n"
            "Denenen yöntemler:\n"
            "1. Camoufox (Firefox) ❌\n"
            "2. SeleniumBase UC ❌\n"
            "3. Nodriver + WARP ❌\n\n"
            "debug_*.png ekran görüntülerini kontrol edin."
        )

    try:
        http_req.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN_1}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": msg},
            timeout=10
        )
    except Exception:
        pass


# ============================================================
#  Ana Fonksiyon — Otonom Fallback Zinciri
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Cookie Generator V3 — GCP Otonom")
    parser.add_argument("--method", choices=["camoufox", "sb", "nodriver", "all"],
                        default="all", help="Çalıştırılacak yöntem")
    args = parser.parse_args()

    print("=" * 55)
    print("  🍪 Cookie Generator V3 — GCP Tam Otonom")
    print("     Ubuntu 24.04 LTS | europe-west4")
    print("=" * 55)

    # IP bilgisi logla
    check_ip_info()

    methods = {
        "camoufox": ("Camoufox", run_camoufox),
        "sb": ("SeleniumBase UC", run_seleniumbase),
        "nodriver": ("Nodriver+WARP", run_nodriver_warp),
    }

    if args.method == "all":
        order = ["camoufox", "sb", "nodriver"]
    else:
        order = [args.method]

    for method_key in order:
        name, func = methods[method_key]
        success = func()

        if success:
            print(f"\n{'=' * 55}")
            print(f"  ✅ BAŞARILI! Yöntem: {name}")
            print(f"{'=' * 55}")
            _notify_final_result(True, name)
            sys.exit(0)
        else:
            print(f"\n[-] {name} başarısız.")
            if method_key != order[-1]:
                print("    → Sonraki yöntem deneniyor...")
                time.sleep(5)

    print(f"\n{'=' * 55}")
    print("  ❌ TÜM YÖNTEMLER BAŞARISIZ!")
    print(f"{'=' * 55}")
    _notify_final_result(False, "none")
    sys.exit(1)


if __name__ == "__main__":
    main()
