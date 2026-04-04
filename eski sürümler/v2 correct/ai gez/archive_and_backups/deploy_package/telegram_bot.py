import os
import subprocess
import sys
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes

# Çevresel değişkenleri yükle (.env)
load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Bot başlatıldığında gönderilecek mesaj."""
    welcome_message = (
        "🤖 Sahibinden Otomasyon Botuna Hoş Geldiniz!\n\n"
        "Komutlar:\n"
        "/cookie : Sunucuda Xvfb sanal ekranını açar ve Sahibinden'den yeni cookie'leri alır."
    )
    await update.message.reply_text(welcome_message)

async def trigger_cookie(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Cookie alma işlemini tetikler."""
    await update.message.reply_text("⏳ Cookie yenileme işlemi başlatılıyor. Lütfen bekleyin...\n(Bu işlem Cloudflare kontrolüne göre 15-45 saniye sürebilir.)")
    
    try:
        # sahibinden_bot.py'yi sadece cookie yenileme ve Xvfb modunda çalıştır
        import pathlib
        project_root = pathlib.Path(__file__).parent.resolve()
        bot_script = project_root / "sahibinden_bot.py"
        
        args = [sys.executable, str(bot_script), "--refresh-only", "--xvfb"]
        
        # Windows'da çalıştırırken stdout/stderr'i yakalamak için
        result = subprocess.run(args, cwd=str(project_root), capture_output=True, text=True)
        
        if result.returncode == 0:
            # Başarılı olduğunda sahibinden_bot.py içinden zaten mesaj atılacak.
            # Yine de buraya bir log bırakabiliriz.
            print("[+] Cookie betiği başarıyla çalıştı.")
        else:
            await update.message.reply_text(f"❌ Hata oluştu! Çıktı:\n```\n{result.stderr[-500:]}\n```", parse_mode="Markdown")
            
    except Exception as e:
        await update.message.reply_text(f"❌ Kritik Hata: {str(e)}")

def main() -> None:
    if not TELEGRAM_BOT_TOKEN:
        print("HATA: TELEGRAM_BOT_TOKEN .env dosyasında bulunamadı!")
        print("Lütfen @BotFather üzerinden bir token alın ve .env dosyasına ekleyin.")
        sys.exit(1)

    print("[*] Telegram botu başlatılıyor...")
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("cookie", trigger_cookie))
    app.add_handler(CommandHandler("yenile", trigger_cookie))

    print("[+] Bot dinlemede! Çıkmak için Ctrl+C'ye basın.")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
