"""
SeleniumBase UC Mode Cookie Generator
Undetected ChromeDriver ile Turnstile CAPTCHA bypass.
GCP'de Xvfb ile headed modda çalıştırılmalıdır.

pip install seleniumbase
"""

import os
import sys
import time
import json
import random
import traceback
from pathlib import Path

try:
    from seleniumbase import SB  # type: ignore
except ImportError:
    print("[-] HATA: seleniumbase kurulu degil!")
    print("    pip install seleniumbase")
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
#  Telegram Bildirimi
# ============================================================

def send_cookie_to_telegram(cookie_dict, ua, method="seleniumbase_uc"):
    if not TELEGRAM_BOT_TOKEN_1 or not TELEGRAM_CHAT_ID:
        print("[-] Telegram ayarlari eksik.")
        return

    cookie_str = "; ".join([f"{k}={v}" for k, v in cookie_dict.items()])

    if "cf_clearance" not in cookie_dict:
        message = (
            f"⚠️ [HATA: TESPİT EDİLDİ]\n\n"
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
        photo_path = Path(__file__).parent / "debug_sb.png"
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
#  SeleniumBase UC Mode Cookie Bypass
# ============================================================

def bypass_with_seleniumbase():
    """
    SeleniumBase'in Undetected ChromeDriver modunu kullanarak
    Cloudflare Turnstile'ı aşar.
    """
    print("[*] SeleniumBase UC Mode ile Cloudflare bypass başlatılıyor...")

    # Linux'ta Xvfb gerekli (headed mod şart, headless tespit ediliyor)
    is_linux = sys.platform.startswith("linux")
    use_headed = is_linux  # Linux'ta headed + Xvfb

    try:
        with SB(
            uc=True,
            headless=not use_headed if not is_linux else False,
            # Linux'ta headless=False + xvfb_run ile başlatılmalı
            locale_code="tr-TR",
            ad_block_on=False,
        ) as sb:

            # --- Warm-up: Ana sayfa ---
            print(f"[*] 1. Warm-up: {HOMEPAGE_URL}")
            sb.uc_open_with_reconnect(HOMEPAGE_URL, reconnect_time=4)
            time.sleep(random.uniform(2.0, 4.0))

            # Rastgele scroll
            sb.execute_script(f"window.scrollBy(0, {random.randint(150, 400)})")
            time.sleep(random.uniform(1.0, 2.5))
            sb.execute_script(f"window.scrollBy(0, {random.randint(100, 300)})")
            time.sleep(random.uniform(1.5, 3.0))

            # --- Hedef sayfaya ---
            print(f"[*] 2. Hedef sayfa: {TARGET_URL}")
            sb.uc_open_with_reconnect(TARGET_URL, reconnect_time=5)
            time.sleep(random.uniform(3.0, 6.0))

            # --- Cloudflare check + Turnstile bypass ---
            print("[*] 3. Cloudflare challenge kontrol ediliyor...")
            source = sb.get_page_source()
            passed_cf = False

            if "just a moment" in source.lower() or "challenge-platform" in source.lower():
                print("  → Challenge tespit edildi, Turnstile tıklanıyor...")

                for click_attempt in range(3):
                    print(f"  → Tıklama denemesi {click_attempt + 1}/3")

                    # Yöntem 1: uc_click ile iframe'e tıklama (tkinter gerektirmez)
                    try:
                        sb.uc_click(
                            'iframe[src*="challenges.cloudflare.com"]',
                            reconnect_time=5
                        )
                        print("  → uc_click ile iframe tıklandı")
                    except Exception as e1:
                        print(f"  → uc_click hatası: {e1}")

                        # Yöntem 2: Selenium ile doğrudan element tıklama
                        try:
                            iframes = sb.find_elements('iframe[src*="challenges.cloudflare.com"]')
                            if not iframes:
                                iframes = sb.find_elements('iframe[src*="turnstile"]')
                            if iframes:
                                iframe = iframes[0]
                                # iframe'in konumunu al ve offset ile tıkla
                                from selenium.webdriver.common.action_chains import ActionChains
                                actions = ActionChains(sb.driver)
                                # Checkbox: iframe'in sol tarafında, dikey ortada
                                actions.move_to_element_with_offset(iframe, -iframe.size['width']//2 + 28, 0)
                                actions.click()
                                actions.perform()
                                print("  → ActionChains ile tıklandı")
                            else:
                                print("  → Turnstile iframe bulunamadı")
                        except Exception as e2:
                            print(f"  → Alternatif tıklama hatası: {e2}")

                    time.sleep(random.uniform(5.0, 10.0))

                    # Kontrol: Challenge geçildi mi?
                    source = sb.get_page_source()
                    if "just a moment" not in source.lower() and "challenge-platform" not in source.lower():
                        print("  → ✅ Challenge geçildi!")
                        passed_cf = True
                        break
                    else:
                        print("  → Challenge hâlâ aktif, tekrar deneniyor...")
                        time.sleep(5)

                if not passed_cf:
                    # Son bir bekleme denemesi
                    print("  → Son bekleme (20sn)...")
                    time.sleep(20)
                    source = sb.get_page_source()
            else:
                print("[+] Challenge yok veya otomatik geçildi!")
                passed_cf = True

            # Son durum kontrolü
            if not passed_cf:
                source = sb.get_page_source()
                passed_cf = "just a moment" not in source.lower() and "challenge-platform" not in source.lower()

            if passed_cf:
                print("[+] Cloudflare geçildi!")
            else:
                print("[-] Cloudflare geçilemedi.")

            # Biraz daha gezinti
            sb.execute_script(f"window.scrollBy(0, {random.randint(100, 300)})")
            time.sleep(random.uniform(1.0, 2.0))

            # --- Screenshot ---
            try:
                sb.save_screenshot(str(Path(__file__).parent / "debug_sb.png"))
                print("[+] Ekran görüntüsü: debug_sb.png")
            except Exception as e:
                print(f"[-] Screenshot hatası: {e}")

            # --- Cookie toplama ---
            print("[*] 4. Cookie'ler toplanıyor...")
            cookies_list = sb.driver.get_cookies()
            cookie_dict = {c["name"]: c["value"] for c in cookies_list}

            # User-Agent
            ua = sb.execute_script("return navigator.userAgent")

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
                "method": "seleniumbase_uc",
                "warp_used": False
            }
            with open(COOKIE_FILE, "w", encoding="utf-8") as f:
                json.dump(output_data, f, indent=4)
            print(f"[+] Cookies → {COOKIE_FILE.name}")

            # Telegram'a gönder
            send_cookie_to_telegram(cookie_dict, ua, "seleniumbase_uc")

            return "cf_clearance" in cookie_dict

    except Exception as e:
        print(f"[-] SeleniumBase hatası: {e}")
        traceback.print_exc()
        return False


# ============================================================
#  main()
# ============================================================

def main():
    print("=" * 50)
    print("  Cookie Generator — SeleniumBase UC Mode")
    print("=" * 50)

    MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))

    for attempt in range(1, MAX_RETRIES + 1):
        print(f"\n--- DENEME {attempt}/{MAX_RETRIES} ---")

        success = bypass_with_seleniumbase()

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
