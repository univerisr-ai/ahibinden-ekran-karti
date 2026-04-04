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

# Windows veya Linux terminal utf-8 ayari
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

# Cookie generator çalışma timeout süresi (saniye)
COOKIE_GEN_TIMEOUT = int(os.getenv("COOKIE_GEN_TIMEOUT", "300"))


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    welcome = (
        "🤖 Sahibinden V2 (WARP + Nodriver + curl_cffi) Botuna Hoş Geldiniz!\n\n"
        "Komutlar:\n"
        "/basla : Cookie üretip ilanları çeker (tam zincir)\n"
        "/durum : Cookie durumunu kontrol eder\n"
        "/warp : WARP bağlantı durumunu gösterir"
    )
    await update.message.reply_text(welcome)


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cookie durumunu kontrol et."""
    if not os.path.exists(COOKIE_FILE):
        await update.message.reply_text("❌ cookies.json bulunamadı. Henüz cookie üretilmemiş.")
        return

    with open(COOKIE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    timestamp = data.get("timestamp", 0)
    age_minutes = (time.time() - timestamp) / 60
    cookies = data.get("cookies", {})
    has_cf = "cf_clearance" in cookies
    warp_used = data.get("warp_used", False)

    status = (
        f"📊 **Cookie Durumu**\n\n"
        f"🕐 Yaş: {age_minutes:.1f} dakika\n"
        f"🔑 cf_clearance: {'✅ Var' if has_cf else '❌ Yok'}\n"
        f"🌐 WARP: {'✅ Kullanıldı' if warp_used else '❌ Kullanılmadı'}\n"
        f"🍪 Toplam Cookie: {len(cookies)}\n"
        f"{'⚠️ Cookie 60 dakikadan eski!' if age_minutes > 60 else '✅ Cookie güncel'}"
    )
    await update.message.reply_text(status, parse_mode="Markdown")


async def warp_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """WARP durumunu kontrol et."""
    try:
        result = subprocess.run(
            ["warp-cli", "status"],
            capture_output=True, text=True, timeout=10
        )
        status = result.stdout.strip() if result.stdout else "Bilinmiyor"
        await update.message.reply_text(f"🌐 WARP Durumu:\n`{status}`", parse_mode="Markdown")
    except FileNotFoundError:
        await update.message.reply_text("❌ warp-cli bulunamadı. WARP kurulu değil.\nKurulum: `sudo bash warp_setup.sh`", parse_mode="Markdown")
    except Exception as e:
        await update.message.reply_text(f"❌ WARP kontrol hatası: {e}")


async def trigger_scrape(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Tam zinciri başlat: Cookie üret → İlan çek."""
    await update.message.reply_text(
        "⏳ 1. Aşama: WARP + Nodriver ile Cookie Toplama Başlatılıyor...\n"
        f"(Maksimum {COOKIE_GEN_TIMEOUT}sn beklenir)"
    )

    # 1. Adım: Cookie Üreticiyi Çalıştır
    cookie_script = os.path.join(PROJECT_DIR, "cookie_generator.py")
    try:
        result = subprocess.run(
            [sys.executable, cookie_script],
            capture_output=True,
            text=True,
            timeout=COOKIE_GEN_TIMEOUT
        )
    except subprocess.TimeoutExpired:
        await update.message.reply_text(
            f"❌ Cookie üretici {COOKIE_GEN_TIMEOUT} saniye içinde tamamlanamadı!\n"
            "Olası nedenler:\n"
            "• WARP bağlantı sorunu\n"
            "• Cloudflare challenge değişmiş olabilir"
        )
        return

    if result.returncode != 0:
        stdout_tail = result.stdout[-800:] if result.stdout else "Yok"  # type: ignore
        stderr_tail = result.stderr[-800:] if result.stderr else "Yok"  # type: ignore
        error_msg = (
            f"❌ 1. Aşama Başarısız!\n\n"
            f"**STDOUT:**\n`{stdout_tail}`\n\n"
            f"**STDERR:**\n`{stderr_tail}`"
        )
        # Telegram mesaj limiti 4096 karakter
        if len(error_msg) > 4000:  # type: ignore
            error_msg = error_msg[:4000] + "..."
        await update.message.reply_text(error_msg, parse_mode="Markdown")
        return

    await update.message.reply_text(
        "✅ Cookie başarıyla alındı!\n"
        "🚀 2. Aşama: İlanlar (Hızlı Çekici) başlatılıyor..."
    )

    # 2. Adım: İlan Çekiciyi Arka Planda Başlat
    scraper_script = os.path.join(PROJECT_DIR, "fast_scraper.py")
    subprocess.Popen([sys.executable, scraper_script])


def _parse_cookie_from_message(text):
    """
    Telegram mesajından cookie string'i ve User-Agent'ı parse et.
    Cookie generator gönderdiği formattan ayıklar.
    """
    cookie_str = None
    ua = None

    # Cookie satırını bul:  🍪 **Cookie:**\n`cookie_str`
    cookie_match = re.search(r"Cookie[:\*]*\s*\n?`([^`]+)`", text, re.IGNORECASE)
    if cookie_match:
        cookie_str = cookie_match.group(1).strip()

    # User-Agent satırını bul:  🕵️ **User-Agent:**\n`ua_str`
    ua_match = re.search(r"User-Agent[:\*]*\s*\n?`([^`]+)`", text, re.IGNORECASE)
    if ua_match:
        ua = ua_match.group(1).strip()

    return cookie_str, ua


def _save_parsed_cookies(cookie_str, ua):
    """Parse edilen cookie string'ini cookies.json dosyasına yaz."""
    cookie_dict = {}
    for pair in cookie_str.split("; "):
        if "=" in pair:
            key, _, value = pair.partition("=")
            cookie_dict[key.strip()] = value.strip()

    output_data = {
        "cookies": cookie_dict,
        "user_agent": ua or "",
        "timestamp": time.time(),
        "warp_used": False,  # Mesajla gelen cookie WARP durumu bilinmez
        "source": "telegram_message"
    }

    with open(COOKIE_FILE, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=4)

    return cookie_dict


def _trigger_scraper_process():
    scraper_script = os.path.join(PROJECT_DIR, "fast_scraper.py")
    subprocess.Popen([sys.executable, scraper_script])


async def handle_cookie_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    Gelen mesajlardan cookie komutunu algıla.
    Cookie generator'dan gelen mesajı parse edip cookies.json'a yazar,
    ardından fast_scraper.py'yi tetikler.
    """
    text = update.message.text or update.message.caption or ""

    if "🟢 [YENI_COOKIE_KOMUTU]" not in text:
        return

    # Cookie ve UA'yı parse et
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

    _trigger_scraper_process()
    await update.message.reply_text(
        "✅ fast_scraper.py başlatıldı. Tamamlandığında AI modülüne veri aktaracaktır."
    )


def main():
    if not TELEGRAM_BOT_TOKEN_2:
        print("[-] HATA: TELEGRAM_BOT_TOKEN_2 bulunamadı (.env dosyasını kontrol edin).")
        sys.exit(1)

    print("=============================================")
    print("  Sahibinden Bot Controller (V2 - WARP)")
    print("  Telegram komutları dinleniyor...")
    print("=============================================")

    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN_2).build()
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("basla", trigger_scrape))
    app.add_handler(CommandHandler("durum", status_command))
    app.add_handler(CommandHandler("warp", warp_command))

    # Gelen mesajlardan cookie komutunu algıla
    app.add_handler(MessageHandler(
        (filters.TEXT | filters.PHOTO) & ~filters.COMMAND,
        handle_cookie_message
    ))

    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
