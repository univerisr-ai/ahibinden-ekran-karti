"""V3 Bot Controller — GCP Tam Otonom"""
import os
import sys
import re
import json
import time
import subprocess
from pathlib import Path
from dotenv import load_dotenv  # type: ignore
from telegram import Update  # type: ignore
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes, MessageHandler, filters  # type: ignore

if sys.stdout and getattr(sys.stdout, "encoding", None) and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore
    except Exception:
        pass

load_dotenv()
TELEGRAM_BOT_TOKEN_2 = os.getenv("TELEGRAM_BOT_TOKEN_2")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
COOKIE_FILE = os.path.join(PROJECT_DIR, "cookies.json")

COOKIE_GEN_TIMEOUT = int(os.getenv("COOKIE_GEN_TIMEOUT", "600"))  # V3 daha uzun sürebilir


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    welcome = (
        "🤖 Sahibinden V3 (GCP Tam Otonom) Botuna Hoş Geldiniz!\n\n"
        "Komutlar:\n"
        "/basla   : Tam zincir (cookie → ilan çek)\n"
        "/camoufox: Sadece Camoufox ile cookie al\n"
        "/sb      : Sadece SeleniumBase UC ile cookie al\n"
        "/durum   : Cookie durumu\n"
        "/warp    : WARP durumu\n"
        "/ip      : Mevcut IP bilgisi"
    )
    await update.message.reply_text(welcome)


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not os.path.exists(COOKIE_FILE):
        await update.message.reply_text("❌ cookies.json bulunamadı.")
        return

    with open(COOKIE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    timestamp = data.get("timestamp", 0)
    age_minutes = (time.time() - timestamp) / 60
    cookies = data.get("cookies", {})
    has_cf = "cf_clearance" in cookies
    method = data.get("method", "bilinmiyor")

    status = (
        f"📊 **Cookie Durumu**\n\n"
        f"🕐 Yaş: {age_minutes:.1f} dakika\n"
        f"🔑 cf_clearance: {'✅ Var' if has_cf else '❌ Yok'}\n"
        f"🔧 Yöntem: {method}\n"
        f"🍪 Toplam Cookie: {len(cookies)}\n"
        f"{'⚠️ Cookie 60 dk eski!' if age_minutes > 60 else '✅ Cookie güncel'}"
    )
    await update.message.reply_text(status, parse_mode="Markdown")


async def warp_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        result = subprocess.run(
            ["warp-cli", "status"],
            capture_output=True, text=True, timeout=10
        )
        status = result.stdout.strip() if result.stdout else "Bilinmiyor"
        await update.message.reply_text(f"🌐 WARP Durumu:\n`{status}`", parse_mode="Markdown")
    except FileNotFoundError:
        await update.message.reply_text("❌ warp-cli bulunamadı. WARP kurulu değil.")
    except Exception as e:
        await update.message.reply_text(f"❌ WARP kontrol hatası: {e}")


async def ip_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Mevcut IP bilgisini göster (residential/datacenter kontrolü)."""
    try:
        import requests as http_req
        resp = http_req.get(
            "http://ip-api.com/json/?fields=query,isp,org,hosting,country,city",
            timeout=10
        )
        data = resp.json()
        ip_type = "🏠 Residential" if not data.get("hosting") else "🏢 Datacenter"

        msg = (
            f"🌐 **IP Bilgisi**\n\n"
            f"IP: `{data.get('query')}`\n"
            f"ISP: {data.get('isp')}\n"
            f"Konum: {data.get('city')}, {data.get('country')}\n"
            f"Tür: {ip_type}"
        )
        await update.message.reply_text(msg, parse_mode="Markdown")
    except Exception as e:
        await update.message.reply_text(f"❌ IP kontrol hatası: {e}")


async def trigger_scrape(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """V3 fallback zinciri ile tam akış."""
    await update.message.reply_text(
        "⏳ Cookie Generator V3 (GCP Otonom) başlatılıyor...\n"
        "Sıra: 🦊 Camoufox → 🌐 SeleniumBase UC → 🔄 Nodriver+WARP\n"
        f"(Maksimum {COOKIE_GEN_TIMEOUT}sn)"
    )

    cookie_script = os.path.join(PROJECT_DIR, "cookie_generator_v3.py")
    success = await _run_cookie_script(update, cookie_script, [])

    if success:
        await update.message.reply_text("🚀 İlan çekici başlatılıyor...")
        scraper_script = os.path.join(PROJECT_DIR, "fast_scraper.py")
        if not os.path.exists(scraper_script):
            # v2'den kullan
            scraper_script = os.path.join(PROJECT_DIR, "..", "v2_warp_bypass", "fast_scraper.py")
        if os.path.exists(scraper_script):
            subprocess.Popen([sys.executable, scraper_script])
            await update.message.reply_text("✅ fast_scraper.py başlatıldı!")
        else:
            await update.message.reply_text("⚠️ fast_scraper.py bulunamadı.")


async def trigger_camoufox(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Sadece Camoufox ile cookie al."""
    await update.message.reply_text("🦊 Camoufox ile cookie alınıyor...")
    cookie_script = os.path.join(PROJECT_DIR, "cookie_generator_v3.py")
    await _run_cookie_script(update, cookie_script, ["--method", "camoufox"])


async def trigger_sb(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Sadece SeleniumBase UC ile cookie al."""
    await update.message.reply_text("🌐 SeleniumBase UC ile cookie alınıyor...")
    cookie_script = os.path.join(PROJECT_DIR, "cookie_generator_v3.py")
    await _run_cookie_script(update, cookie_script, ["--method", "sb"])


async def _run_cookie_script(update, script_path, extra_args):
    """Cookie script'ini çalıştır ve sonucu raporla."""
    if not os.path.exists(script_path):
        await update.message.reply_text(f"❌ {os.path.basename(script_path)} bulunamadı!")
        return False

    try:
        cmd = [sys.executable, script_path] + extra_args
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=COOKIE_GEN_TIMEOUT
        )
    except subprocess.TimeoutExpired:
        await update.message.reply_text(
            f"❌ Cookie üretici {COOKIE_GEN_TIMEOUT}sn timeout!\n"
            "Olası nedenler:\n"
            "• Cloudflare challenge değişmiş\n"
            "• Ağ bağlantı sorunu"
        )
        return False

    if result.returncode == 0:
        # Cookie kontrolü
        if os.path.exists(COOKIE_FILE):
            with open(COOKIE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            has_cf = "cf_clearance" in data.get("cookies", {})
            method = data.get("method", "?")

            if has_cf:
                await update.message.reply_text(
                    f"✅ Cookie başarıyla alındı!\n"
                    f"🔧 Yöntem: {method}\n"
                    f"🔑 cf_clearance: ✅"
                )
                return True

    stdout_tail = result.stdout[-600:] if result.stdout else "Yok"
    stderr_tail = result.stderr[-400:] if result.stderr else "Yok"
    error_msg = (
        f"❌ Cookie üretimi başarısız!\n\n"
        f"**Çıktı:**\n`{stdout_tail}`"
    )
    if len(error_msg) > 4000:
        error_msg = error_msg[:4000] + "..."
    await update.message.reply_text(error_msg, parse_mode="Markdown")
    return False


def _parse_cookie_from_message(text):
    cookie_str = None
    ua = None
    cookie_match = re.search(r"Cookie[:\*]*\s*\n?`([^`]+)`", text, re.IGNORECASE)
    if cookie_match:
        cookie_str = cookie_match.group(1).strip()
    ua_match = re.search(r"User-Agent[:\*]*\s*\n?`([^`]+)`", text, re.IGNORECASE)
    if ua_match:
        ua = ua_match.group(1).strip()
    return cookie_str, ua


def _save_parsed_cookies(cookie_str, ua):
    cookie_dict = {}
    for pair in cookie_str.split("; "):
        if "=" in pair:
            key, _, value = pair.partition("=")
            cookie_dict[key.strip()] = value.strip()

    output_data = {
        "cookies": cookie_dict,
        "user_agent": ua or "",
        "timestamp": time.time(),
        "method": "telegram_message",
        "warp_used": False,
        "source": "telegram_message"
    }
    with open(COOKIE_FILE, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=4)
    return cookie_dict


async def handle_cookie_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text or update.message.caption or ""

    if "🟢 [YENI_COOKIE_KOMUTU]" not in text:
        return

    cookie_str, ua = _parse_cookie_from_message(text)

    if cookie_str:
        cookie_dict = _save_parsed_cookies(cookie_str, ua)
        has_cf = "cf_clearance" in cookie_dict

        await update.message.reply_text(
            f"📥 Cookie mesajı algılandı ve kaydedildi!\n"
            f"🔑 cf_clearance: {'✅ Var' if has_cf else '❌ Yok'}\n"
            f"🍪 Toplam: {len(cookie_dict)} cookie\n\n"
            f"🚀 İlan çekici başlatılıyor..."
        )
    else:
        await update.message.reply_text(
            "📥 Cookie mesajı algılandı ama parse edilemedi.\n"
            "🚀 Mevcut cookies.json ile devam ediliyor..."
        )

    # Scraper'ı başlat
    scraper_script = os.path.join(PROJECT_DIR, "fast_scraper.py")
    if not os.path.exists(scraper_script):
        scraper_script = os.path.join(PROJECT_DIR, "..", "v2_warp_bypass", "fast_scraper.py")
    if os.path.exists(scraper_script):
        subprocess.Popen([sys.executable, scraper_script])
        await update.message.reply_text("✅ fast_scraper.py başlatıldı.")


def main():
    if not TELEGRAM_BOT_TOKEN_2:
        print("[-] HATA: TELEGRAM_BOT_TOKEN_2 bulunamadı (.env).")
        sys.exit(1)

    print("=" * 50)
    print("  Sahibinden Bot Controller (V3 — GCP Otonom)")
    print("  Ubuntu 24.04 LTS | europe-west4")
    print("  Telegram komutları dinleniyor...")
    print("=" * 50)

    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN_2).build()
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("basla", trigger_scrape))
    app.add_handler(CommandHandler("camoufox", trigger_camoufox))
    app.add_handler(CommandHandler("sb", trigger_sb))
    app.add_handler(CommandHandler("durum", status_command))
    app.add_handler(CommandHandler("warp", warp_command))
    app.add_handler(CommandHandler("ip", ip_command))

    app.add_handler(MessageHandler(
        (filters.TEXT | filters.PHOTO) & ~filters.COMMAND,
        handle_cookie_message
    ))

    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
