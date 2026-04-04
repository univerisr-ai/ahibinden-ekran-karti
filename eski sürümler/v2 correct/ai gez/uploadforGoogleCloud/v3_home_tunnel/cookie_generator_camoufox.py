"""
Camoufox Cookie Generator — Firefox Anti-Detect Tarayıcı
Cloudflare'in Chrome-odaklı tespitlerini atlamak için Firefox tabanlı.
GCP'de veya ev bilgisayarında çalışabilir.

pip install camoufox[geoip] playwright
python -m camoufox fetch
"""

import os
import sys
import time
import json
import math
import random
import asyncio
import traceback
from pathlib import Path

try:
    from camoufox.async_api import AsyncCamoufox  # type: ignore
except ImportError:
    print("[-] HATA: camoufox kurulu degil!")
    print("    pip install camoufox[geoip] playwright")
    print("    python -m camoufox fetch")
    sys.exit(1)

import requests  # type: ignore
from dotenv import load_dotenv  # type: ignore

load_dotenv()

TARGET_URL = os.getenv("TARGET_URL", "https://www.sahibinden.com/ekran-karti-masaustu")
HOMEPAGE_URL = "https://www.sahibinden.com"
COOKIE_FILE = Path(__file__).parent / "cookies.json"
TELEGRAM_BOT_TOKEN_1 = os.getenv("TELEGRAM_BOT_TOKEN_1")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# ============================================================
#  İnsan Simülasyonu
# ============================================================

def bezier_point(t, p0, p1, p2, p3):
    u = 1 - t
    return u**3 * p0 + 3 * u**2 * t * p1 + 3 * u * t**2 * p2 + t**3 * p3

def generate_bezier_path(sx, sy, ex, ey, steps=20):
    cp1x = sx + (ex - sx) * random.uniform(0.2, 0.4) + random.randint(-40, 40)
    cp1y = sy + (ey - sy) * random.uniform(0.1, 0.3) + random.randint(-25, 25)
    cp2x = sx + (ex - sx) * random.uniform(0.6, 0.8) + random.randint(-40, 40)
    cp2y = sy + (ey - sy) * random.uniform(0.7, 0.9) + random.randint(-25, 25)
    path = []
    for i in range(steps + 1):
        t = i / steps
        x = bezier_point(t, sx, cp1x, cp2x, ex)
        y = bezier_point(t, sy, cp1y, cp2y, ey)
        path.append((int(x), int(y)))
    return path

async def human_mouse_move(page, tx, ty):
    """Bezier eğrisi ile mouse hareketi — Playwright API."""
    sx, sy = random.randint(100, 400), random.randint(100, 300)
    path = generate_bezier_path(sx, sy, tx, ty)
    for x, y in path:
        await page.mouse.move(x, y)
        await asyncio.sleep(random.uniform(0.015, 0.05))

async def random_scroll(page):
    amount = random.randint(150, 500)
    await page.evaluate(f"window.scrollBy(0, {amount})")
    await asyncio.sleep(random.uniform(0.5, 1.5))

# ============================================================
#  Telegram Bildirimi
# ============================================================

def send_cookie_to_telegram(cookie_dict, ua, method="camoufox"):
    if not TELEGRAM_BOT_TOKEN_1 or not TELEGRAM_CHAT_ID:
        print("[-] Telegram ayarlari eksik.")
        return

    cookie_str = "; ".join([f"{k}={v}" for k, v in cookie_dict.items()])

    if "cf_clearance" not in cookie_dict:
        message = (
            "⚠️ [HATA: TESPİT EDİLDİ]\n\n"
            f"Yöntem: {method}\n"
            "Sistem Cloudflare engelini aşamadı (`cf_clearance` yok)."
        )
    else:
        message = (
            "🟢 [YENI_COOKIE_KOMUTU]\n\n"
            f"Yöntem: {method}\n"
            "Sistem taptaze bir Cloudflare çerezi üretti!\n\n"
            f"🍪 **Cookie:**\n`{cookie_str}`\n\n"
            f"🕵️ **User-Agent:**\n`{ua}`"
        )

    try:
        photo_path = Path(__file__).parent / "debug_camoufox.png"
        if photo_path.exists():
            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN_1}/sendPhoto"
            with open(photo_path, "rb") as photo:
                requests.post(
                    url,
                    data={"chat_id": TELEGRAM_CHAT_ID, "caption": message, "parse_mode": "Markdown"},
                    files={"photo": photo},
                    timeout=30
                )
        else:
            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN_1}/sendMessage"
            requests.post(
                url,
                json={"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "Markdown"},
                timeout=30
            )
        print("[+] Cookie/Mesaj Telegram'a iletildi!")
    except Exception as e:
        print(f"[-] Telegram hatasi: {e}")


# ============================================================
#  Camoufox Cookie Bypass
# ============================================================

async def bypass_with_camoufox():
    """
    Camoufox (Firefox anti-detect) ile Cloudflare bypass.
    Playwright API kullanır, Chrome'dan tamamen farklı fingerprint.
    """
    print("[*] Camoufox ile Cloudflare bypass başlatılıyor...")

    try:
        async with AsyncCamoufox(
            headless="virtual",  # virtual = Xvfb olmadan sanal ekran
            geoip=True,          # IP'ye göre locale ayarla
            humanize=True,       # Dahili insan simülasyonu
            os=("windows", "macos", "linux"),  # Rastgele OS fingerprint
        ) as browser:

            page = await browser.new_page()

            # --- Warm-up: Ana sayfa ---
            print(f"[*] 1. Warm-up: {HOMEPAGE_URL}")
            await page.goto(HOMEPAGE_URL, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(random.uniform(3.0, 5.0))

            # İnsan benzeri gezinti
            await random_scroll(page)
            await asyncio.sleep(random.uniform(1.0, 2.5))
            await human_mouse_move(page, random.randint(300, 800), random.randint(200, 500))
            await asyncio.sleep(random.uniform(1.0, 2.0))
            await random_scroll(page)
            await asyncio.sleep(random.uniform(1.5, 3.0))

            # --- Hedef sayfaya geçiş ---
            print(f"[*] 2. Hedef sayfa: {TARGET_URL}")
            await page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(random.uniform(4.0, 7.0))

            # --- Cloudflare bekleme + Turnstile tıklama ---
            print("[*] 3. Cloudflare challenge bekleniyor (max 90sn)...")
            passed = False
            turnstile_clicked = False

            for i in range(30):  # 30 * 3sn = 90sn
                content = await page.content()
                content_lower = content.lower()

                # Challenge geçildi mi?
                if "just a moment" not in content_lower and "challenge-platform" not in content_lower:
                    print("[+] Cloudflare geçildi!")
                    passed = True
                    break

                print(f"  ... {i * 3}sn, challenge devam ediyor...")

                # Turnstile iframe'i bul ve tıkla
                if i >= 2:
                    try:
                        # Turnstile iframe'ini bul
                        turnstile_frame = None
                        for frame in page.frames:
                            frame_url = frame.url or ""
                            if "challenges.cloudflare.com" in frame_url or "turnstile" in frame_url:
                                turnstile_frame = frame
                                break

                        if turnstile_frame:
                            # Yöntem 1: iframe'in kendisinin bounding box'ını al
                            # ve checkbox konumunu hesapla (sol tarafta, dikey ortada)
                            iframe_element = await page.query_selector(
                                'iframe[src*="challenges.cloudflare.com"], '
                                'iframe[src*="turnstile"]'
                            )
                            if iframe_element:
                                bbox = await iframe_element.bounding_box()
                                if bbox and not turnstile_clicked:
                                    # Turnstile checkbox her zaman iframe'in sol tarafında
                                    # Kutucuk yaklaşık x=28, y=iframe_yüksekliği/2
                                    click_x = bbox["x"] + 28 + random.randint(-4, 4)
                                    click_y = bbox["y"] + bbox["height"] / 2 + random.randint(-4, 4)
                                    print(f"  → Turnstile iframe bulundu ({bbox['width']:.0f}x{bbox['height']:.0f})")
                                    print(f"  → Checkbox tıklanıyor ({click_x:.0f}, {click_y:.0f})")

                                    # İnsan gibi mouse hareketi + tıklama
                                    await human_mouse_move(page, int(click_x), int(click_y))
                                    await asyncio.sleep(random.uniform(0.1, 0.3))
                                    await page.mouse.click(click_x, click_y)
                                    turnstile_clicked = True
                                    print("  → ✅ Tıklama yapıldı, sonuç bekleniyor...")
                                    await asyncio.sleep(random.uniform(4.0, 7.0))
                                    continue  # Sonucu hemen kontrol et

                            # Yöntem 2: iframe içindeki body'ye tıkla
                            if not turnstile_clicked:
                                try:
                                    body = await turnstile_frame.query_selector("body")
                                    if body:
                                        await body.click()
                                        turnstile_clicked = True
                                        print("  → Yöntem 2: iframe body tıklandı")
                                        await asyncio.sleep(random.uniform(4.0, 7.0))
                                        continue
                                except Exception:
                                    pass
                                    
                        else:
                            print("  → Turnstile iframe bulunamadı")

                        # 3. deneme sonrası tekrar tıkla (timeout ile reset)
                        if turnstile_clicked and i > 8:
                            turnstile_clicked = False  # Tekrar deneme izni

                    except Exception as e:
                        print(f"  → Turnstile tıklama hatası: {e}")

                await asyncio.sleep(3)

            if not passed:
                print("[-] Cloudflare bekleme süresi doldu.")

            # Biraz daha gezin
            await random_scroll(page)
            await asyncio.sleep(random.uniform(1.5, 3.0))

            # --- Ekran görüntüsü ---
            try:
                screenshot_path = str(Path(__file__).parent / "debug_camoufox.png")
                await page.screenshot(path=screenshot_path, full_page=False)
                print("[+] Ekran görüntüsü kaydedildi: debug_camoufox.png")
            except Exception as e:
                print(f"[-] Screenshot hatası: {e}")

            # --- Cookie toplama ---
            print("[*] 4. Cookie'ler toplanıyor...")
            context = page.context
            cookies_list = await context.cookies()
            cookie_dict = {c["name"]: c["value"] for c in cookies_list}

            # User-Agent
            ua = await page.evaluate("navigator.userAgent")

            # cf_clearance kontrolü
            if "cf_clearance" not in cookie_dict:
                print(f"[-] cf_clearance YOK! Mevcut: {list(cookie_dict.keys())}")
            else:
                print("[+] cf_clearance başarıyla alındı!")

            # JSON kaydet
            output_data = {
                "cookies": cookie_dict,
                "user_agent": ua,
                "timestamp": time.time(),
                "method": "camoufox",
                "warp_used": False
            }
            with open(COOKIE_FILE, "w", encoding="utf-8") as f:
                json.dump(output_data, f, indent=4)
            print(f"[+] Cookies → {COOKIE_FILE.name}")

            # Telegram'a gönder
            send_cookie_to_telegram(cookie_dict, ua, "camoufox")

            return "cf_clearance" in cookie_dict

    except Exception as e:
        print(f"[-] Camoufox hatası: {e}")
        traceback.print_exc()
        return False


# ============================================================
#  main()
# ============================================================

def main():
    print("=" * 50)
    print("  Cookie Generator — Camoufox (Firefox Anti-Detect)")
    print("=" * 50)

    MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))

    for attempt in range(1, MAX_RETRIES + 1):
        print(f"\n--- DENEME {attempt}/{MAX_RETRIES} ---")

        success = asyncio.run(bypass_with_camoufox())

        if success:
            print(f"\n[+] ✅ BAŞARILI! (Deneme {attempt})")
            return True
        else:
            print(f"\n[-] ❌ Deneme {attempt} başarısız.")
            if attempt < MAX_RETRIES:
                wait = 15 * (2 ** (attempt - 1))
                print(f"[*] {wait}sn bekleniyor...")
                time.sleep(wait)

    print(f"\n[-] ❌ Tüm {MAX_RETRIES} deneme başarısız.")
    return False


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
