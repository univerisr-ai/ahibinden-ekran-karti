import os
import subprocess
import asyncio
import sys
from dotenv import load_dotenv  # type: ignore
from telegram import Update  # type: ignore
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes  # type: ignore

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

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    welcome = (
        "🤖 Sahibinden V1 (Nodriver + curl_cffi) Botuna Hoş Geldiniz!\n\n"
        "Komutlar:\n"
        "/basla : Yeni sistem üzerinden Cloudflare'i aşıp ilanları çekmeye başlar."
    )
    await update.message.reply_text(welcome)

async def trigger_scrape(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("⏳ 1. Aşama: Sanal Ekran & Nodriver ile Cookie Toplama Başlatılıyor. (Bekleyin...)")
    
    # 1. Adım: Cookie Üreticiyi Çalıştır (Bloklayıcı - Sonucu bekliyoruz)
    cookie_script = os.path.join(PROJECT_DIR, "cookie_generator.py")
    result = subprocess.run([sys.executable, cookie_script], capture_output=True, text=True)
    
    if result.returncode != 0:
        error_msg = f"❌ 1. Aşama Başarısız Oldu!\n\n**STDOUT:**\n`{result.stdout[-1000:]}`\n\n**STDERR:**\n`{result.stderr[-1000:]}`"
        await update.message.reply_text(error_msg, parse_mode="Markdown")
        return
        
    await update.message.reply_text("✅ Cookie ve User-Agent başarıyla alındı!\n🚀 2. Aşama: İlanlar (Hızlı Çekici) başlatılıyor...")
    
    # 2. Adım: İlan Çekiciyi Çalıştır (İlan Çekimi - Arka planda başlatalım ki Telegram kilitlenmesin)
    scraper_script = os.path.join(PROJECT_DIR, "fast_scraper.py")
    subprocess.Popen([sys.executable, scraper_script])
    
def _trigger_scraper_process():
    scraper_script = os.path.join(PROJECT_DIR, "fast_scraper.py")
    subprocess.Popen([sys.executable, scraper_script])

async def handle_cookie_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text or update.message.caption
    if text and text.startswith("🟢 [YENI_COOKIE_KOMUTU]"):
        await update.message.reply_text("📥 [SİSTEM TETİKLENDİ] Yeni cookie mesajı algılandı!\n\n🚀 İlanlar (Hızlı Çekici) arka planda otomatik olarak başlatılıyor...")
        _trigger_scraper_process()
        await update.message.reply_text("✅ İlan çekici (fast_scraper.py) başladı. Bittiğinde Yapay Zeka (AI) modülüne veri yollayacaktır.")

def main():
    if not TELEGRAM_BOT_TOKEN_2:
        print("[-] HATA: TELEGRAM_BOT_TOKEN_2 bulunamadı (.env dosyasını kontrol edin).")
        sys.exit(1)
        
    print("[*] Yeni Nesil Sahibinden Bot Controller (V1) Başlatıldı. Telegram komutları dinleniyor...")
    
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN_2).build()
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("basla", trigger_scrape))
    
    # Text mesajlarını veya Fotoğraflı mesajları (caption) dinleyip "YENI_COOKIE_KOMUTU" mesajında scraper'ı tetikle
    from telegram.ext import MessageHandler, filters
    app.add_handler(MessageHandler((filters.TEXT | filters.PHOTO) & ~filters.COMMAND, handle_cookie_message))
    
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
