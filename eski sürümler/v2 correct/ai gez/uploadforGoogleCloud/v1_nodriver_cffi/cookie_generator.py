import os
import sys
import time
import json
import math
import random
import asyncio
from pathlib import Path
from pyvirtualdisplay import Display  # type: ignore
import nodriver as uc  # type: ignore
import requests  # type: ignore
from dotenv import load_dotenv  # type: ignore

load_dotenv()

TARGET_URL = os.getenv("TARGET_URL", "https://www.sahibinden.com/ekran-karti-masaustu")
HOMEPAGE_URL = "https://www.sahibinden.com"
COOKIE_FILE = Path(__file__).parent / "cookies.json"
TELEGRAM_BOT_TOKEN_1 = os.getenv("TELEGRAM_BOT_TOKEN_1")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# WARP SOCKS5 Proxy (warp_setup.sh ile kurulur)
WARP_SOCKS5 = os.getenv("WARP_SOCKS5", "socks5://127.0.0.1:40000")
USE_WARP = os.getenv("USE_WARP", "true").lower() == "true"

# Retry ayarları
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
RETRY_BASE_DELAY = 15  # saniye

# ============================================================
#  İnsan Simülasyonu Fonksiyonları (cloud.txt araştırmasına göre)
# ============================================================

def bezier_point(t, p0, p1, p2, p3):
    """Kübik Bezier eğrisi üzerinde bir nokta hesapla."""
    u = 1 - t
    return (u**3 * p0 + 3 * u**2 * t * p1 + 3 * u * t**2 * p2 + t**3 * p3)

def generate_bezier_path(start_x, start_y, end_x, end_y, steps=25):
    """
    İki nokta arasında Bezier eğrisi ile insan benzeri mouse yolu oluştur.
    Düz çizgi yerine doğal bir eğri çizer (cloud.txt - Madde 3).
    """
    # Rastgele kontrol noktaları (eğriyi doğal yapar)
    cp1_x = start_x + (end_x - start_x) * random.uniform(0.2, 0.4) + random.randint(-50, 50)
    cp1_y = start_y + (end_y - start_y) * random.uniform(0.1, 0.3) + random.randint(-30, 30)
    cp2_x = start_x + (end_x - start_x) * random.uniform(0.6, 0.8) + random.randint(-50, 50)
    cp2_y = start_y + (end_y - start_y) * random.uniform(0.7, 0.9) + random.randint(-30, 30)
    
    path = []
    for i in range(steps + 1):
        t = i / steps
        x = bezier_point(t, start_x, cp1_x, cp2_x, end_x)
        y = bezier_point(t, start_y, cp1_y, cp2_y, end_y)
        path.append((int(x), int(y)))
    return path

def fitts_delay(distance=100):
    """
    Fitts Kanunu'na göre tıklama gecikmesi hesapla.
    Uzak hedefler = daha uzun gecikme (cloud.txt - Madde 3).
    """
    base_time = 0.3  # 300ms minimum
    log_factor = math.log2(1 + distance / 50) * 0.1
    noise = random.uniform(-0.05, 0.15)
    return max(0.2, base_time + log_factor + noise)

async def human_mouse_move(page, target_x, target_y):
    """Bezier eğrisi ile mouse hareketi simüle et."""
    # Mevcut pozisyon (rastgele başlangıç)
    start_x = random.randint(100, 400)
    start_y = random.randint(100, 300)
    
    path = generate_bezier_path(start_x, start_y, target_x, target_y)
    
    for x, y in path:
        await page.send(uc.cdp.input_.dispatch_mouse_event(
            type_="mouseMoved",
            x=x,
            y=y
        ))
        # Her adım arasında küçük gecikme (50-150ms arası, cloud.txt'e uygun)
        await asyncio.sleep(random.uniform(0.02, 0.06))

async def human_click(page, x, y):
    """İnsan benzeri tıklama: mouse hareketi + Fitts gecikmesi + tıklama."""
    await human_mouse_move(page, x, y)
    
    delay = fitts_delay(distance=random.randint(50, 300))
    await asyncio.sleep(delay)
    
    # Mouse down + up (gerçek tıklama)
    await page.send(uc.cdp.input_.dispatch_mouse_event(
        type_="mousePressed",
        x=x, y=y,
        button=uc.cdp.input_.MouseButton("left"),
        click_count=1
    ))
    await asyncio.sleep(random.uniform(0.05, 0.15))
    await page.send(uc.cdp.input_.dispatch_mouse_event(
        type_="mouseReleased",
        x=x, y=y,
        button=uc.cdp.input_.MouseButton("left"),
        click_count=1
    ))

async def random_scroll(page):
    """Rastgele doğal kaydırma (insan davranışı taklidi)."""
    scroll_amount = random.randint(150, 500)
    await page.send(uc.cdp.input_.dispatch_mouse_event(
        type_="mouseWheel",
        x=random.randint(300, 800),
        y=random.randint(300, 500),
        delta_x=0,
        delta_y=scroll_amount
    ))
    await asyncio.sleep(random.uniform(0.5, 1.5))

# ============================================================
#  Telegram Bildirimi
# ============================================================

def send_cookie_to_telegram(cookie_dict, ua):
    if not TELEGRAM_BOT_TOKEN_1 or not TELEGRAM_CHAT_ID:
        print("[-] Telegram ayarları (.env) eksik. Cookie Telegram'a gönderilemedi.")
        return
        
    cookie_str = "; ".join([f"{k}={v}" for k, v in cookie_dict.items()])
    
    if "cf_clearance" not in cookie_dict:
        message = (
            "⚠️ [HATA: TESPİT EDİLDİ]\n\n"
            "Sistem Cloudflare engelini aşamadı (`cf_clearance` yok).\n"
            "Mevcut durumun ekran görüntüsü ektedir."
        )
    else:
        message = (
            "🟢 [YENI_COOKIE_KOMUTU]\n\n"
            "Sistem taptaze bir Cloudflare çerezi üretti!\n\n"
            f"🍪 **Cookie:**\n`{cookie_str}`\n\n"
            f"🕵️ **User-Agent:**\n`{ua}`"
        )
    
    try:
        photo_path = Path(__file__).parent / "debug.png"
        if photo_path.exists():
            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN_1}/sendPhoto"
            with open(photo_path, "rb") as photo:
                resp = requests.post(url, data={"chat_id": TELEGRAM_CHAT_ID, "caption": message, "parse_mode": "Markdown"}, files={"photo": photo})
        else:
            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN_1}/sendMessage"
            resp = requests.post(url, json={"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "Markdown"})
            
        if resp.status_code == 200:
            print("[+] Cookie/Mesaj başarıyla Telegram'a iletildi!")
        else:
            print(f"[-] Telegram gönderim hatası: HTTP {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"[-] Telegram istek hatası: {e}")

# ============================================================
#  WARP Kontrolü
# ============================================================

def check_warp_connection():
    """WARP SOCKS5 proxy'nin çalışıp çalışmadığını kontrol et."""
    if not USE_WARP:
        print("[*] WARP devre dışı (USE_WARP=false)")
        return False
        
    try:
        proxy_addr = WARP_SOCKS5.replace("socks5://", "")
        resp = requests.get(
            "https://ifconfig.me",
            proxies={"http": WARP_SOCKS5, "https": WARP_SOCKS5},
            timeout=10
        )
        print(f"[+] WARP aktif! WARP IP: {resp.text.strip()}")
        return True
    except Exception as e:
        print(f"[-] WARP SOCKS5 bağlantısı başarısız: {e}")
        print("[-] WARP olmadan devam ediliyor (başarı şansı düşük)...")
        return False

# ============================================================
#  Ana Cookie Bypass Fonksiyonu
# ============================================================

async def bypass_cloudflare_and_get_cookies():
    print("[*] 1. Sanal Ekran (Xvfb) Başlatılıyor...")
    display = Display(visible=0, size=(1920, 1080))
    display.start()
    
    browser = None
    try:
        # WARP kontrolü
        warp_active = check_warp_connection()
        
        # Chrome başlatma argümanları
        chrome_args = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--window-size=1920,1080',
            '--start-maximized',
        ]
        
        # WARP SOCKS5 proxy ekle
        if warp_active:
            proxy_addr = WARP_SOCKS5.replace("socks5://", "")
            chrome_args.append(f'--proxy-server=socks5://{proxy_addr}')
            print(f"[+] Chrome WARP proxy ile başlatılacak: socks5://{proxy_addr}")
        
        print("[*] 2. Nodriver ile undetected Chrome başlatılıyor...")
        browser = await uc.start(
            headless=False,
            browser_args=chrome_args
        )
        
        # ============================================
        # WARM-UP AŞAMASI (cloud.txt - Madde 3)
        # Doğrudan hedef URL yerine ana sayfadan başla
        # ============================================
        print(f"[*] 3. Warm-up: Ana sayfa ({HOMEPAGE_URL}) açılıyor...")
        page = await browser.get(HOMEPAGE_URL)
        
        # Ana sayfada insan gibi bekle
        await asyncio.sleep(random.uniform(3.0, 5.0))
        
        # Rastgele scroll yap (insan davranışı)
        print("[*]    → Sayfada rastgele geziniyor...")
        await random_scroll(page)
        await asyncio.sleep(random.uniform(1.0, 2.5))
        await random_scroll(page)
        await asyncio.sleep(random.uniform(1.5, 3.0))
        
        # Mouse hareketi yap (Bezier eğrisi ile)
        await human_mouse_move(page, random.randint(300, 800), random.randint(200, 500))
        await asyncio.sleep(random.uniform(1.0, 2.0))
        
        # ============================================
        # HEDEF SAYFAYA GEÇİŞ
        # ============================================
        print(f"[*] 4. Hedef sayfaya geçiliyor: {TARGET_URL}")
        page = await browser.get(TARGET_URL)
        
        # İnsan simülasyonu: Rastgele bekleme
        await asyncio.sleep(random.uniform(4.0, 7.0))
        
        # ============================================
        # CLOUDFLARE BEKLEMESİ
        # ============================================
        print("[*] 5. Cloudflare Sayfasının Geçilmesi Bekleniyor (Maksimum 60sn)...")
        passed = False
        for i in range(20):
            content = await page.get_content()
            content_lower = content.lower()
            
            if "just a moment" not in content_lower and "challenge-platform" not in content_lower:
                print("[+] Cloudflare Kontrolü Başarıyla Geçildi!")
                passed = True
                break
            
            print(f"  ... {i * 3} saniye geçti, Turnstile bekleniyor...")
            
            # Cloudflare Turnstile checkbox tıklama denemesi
            if i > 2:
                try:
                    # Turnstile iframe'i bul ve tıkla
                    turnstile_frame = await page.query_selector("iframe[src*='challenges.cloudflare.com']")
                    if turnstile_frame:
                        box = await turnstile_frame.get_bounding_box()
                        if box:
                            click_x = box["x"] + box["width"] / 2 + random.randint(-5, 5)
                            click_y = box["y"] + box["height"] / 2 + random.randint(-5, 5)
                            print(f"  → Turnstile checkbox'a tıklanıyor ({click_x:.0f}, {click_y:.0f})...")
                            await human_click(page, click_x, click_y)
                except Exception:
                    pass
            
            await asyncio.sleep(3)
        
        if not passed:
            print("[-] Uyarı: Cloudflare bekleme süresi doldu, sayfa tam yüklenmemiş olabilir.")
        
        # İnsan gibi sayfayı gez
        await random_scroll(page)
        await asyncio.sleep(random.uniform(1.5, 3.0))
            
        print("[*] 6. Çerezler (Cookies) Toplanıyor...")
        await asyncio.sleep(2)
        
        # Ekran görüntüsü al
        try:
            await page.save_screenshot(str(Path(__file__).parent / "debug.png"))
            print("[+] Ekran görüntüsü (debug.png) kaydedildi.")
        except Exception as e:
            print(f"[-] Ekran görüntüsü alınamadı: {e}")
            
        # Çerezleri Nodriver üzerinden çek
        cookies_list = await browser.cookies.get_all()
        cookie_dict = {c.name: c.value for c in cookies_list}
        
        # User-Agent'ı çek
        ua = await page.evaluate("navigator.userAgent")
        
        # cf_clearance kontrolü
        if "cf_clearance" not in cookie_dict:
            print("[-] DİKKAT: 'cf_clearance' çerezi alınamadı!")
            print(f"    Mevcut çerezler: {list(cookie_dict.keys())}")
        else:
            print("[+] 'cf_clearance' başarıyla alındı!")
            
        # JSON Olarak Kaydet
        output_data = {
            "cookies": cookie_dict,
            "user_agent": ua,
            "timestamp": time.time(),
            "warp_used": warp_active
        }
        
        with open(COOKIE_FILE, "w", encoding="utf-8") as f:
            json.dump(output_data, f, indent=4)
            
        print(f"[+] Çerezler {COOKIE_FILE.name} dosyasına kaydedildi.")
        
        # Telegram'a gönder
        send_cookie_to_telegram(cookie_dict, ua)
        
        if "cf_clearance" not in cookie_dict:
            return False
            
        return True
        
    except Exception as e:
        print(f"[-] Hata Oluştu (cookie_generator): {e}")
        import traceback
        traceback.print_exc()
        return False
        
    finally:
        if browser:
            print("[*] Chrome kapatılıyor...")
            browser.stop()
        if display:
            print("[*] Sanal Ekran (Xvfb) Kapatılıyor...")
            display.stop()

# ============================================================
#  Ana Fonksiyon (Otomatik Retry ile)
# ============================================================

def main():
    print("=============================================")
    print("   Sahibinden Cookie Generator (v2)")
    print("   Nodriver + WARP + İnsan Taklidi")
    print("=============================================")
    print(f"   WARP: {'Aktif' if USE_WARP else 'Devre dışı'}")
    print(f"   Hedef: {TARGET_URL}")
    print(f"   Max Deneme: {MAX_RETRIES}")
    print("=============================================")
    
    for attempt in range(1, MAX_RETRIES + 1):
        print(f"\n{'='*45}")
        print(f"   DENEME {attempt}/{MAX_RETRIES}")
        print(f"{'='*45}")
        
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            success = loop.run_until_complete(bypass_cloudflare_and_get_cookies())
            
            if success:
                print(f"\n[+] ✅ BAŞARILI! (Deneme {attempt}/{MAX_RETRIES})")
                os._exit(0)
            else:
                print(f"\n[-] ❌ Deneme {attempt} başarısız.")
                
                if attempt < MAX_RETRIES:
                    # Exponential backoff: 15s, 30s, 60s...
                    wait_time = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                    print(f"[*] Sonraki deneme için {wait_time} saniye bekleniyor...")
                    time.sleep(wait_time)
                    
        except Exception as e:
            print(f"[-] Kritik Hata (Deneme {attempt}): {e}")
            
            if attempt < MAX_RETRIES:
                wait_time = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                print(f"[*] Sonraki deneme için {wait_time} saniye bekleniyor...")
                time.sleep(wait_time)
        finally:
            loop.close()
    
    print(f"\n[-] ❌ Tüm {MAX_RETRIES} deneme başarısız oldu.")
    os._exit(1)

if __name__ == "__main__":
    main()
