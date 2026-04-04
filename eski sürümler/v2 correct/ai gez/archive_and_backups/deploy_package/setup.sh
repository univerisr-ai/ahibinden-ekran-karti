#!/bin/bash
# ============================================================
# AI GEZ - Google Cloud Sunucu Kurulum Scripti
# Tek komutla tum sistemi kurar: bash setup.sh
# ============================================================
set -e

APP_DIR="/opt/ai-gez"
VENV_DIR="$APP_DIR/.venv"
USER_NAME="ai-gez"

echo "============================================"
echo "  AI GEZ - Sunucu Kurulumu Basliyor"
echo "============================================"

# 1) Sistem paketlerini guncelle
echo "[1/7] Sistem paketleri guncelleniyor..."
sudo apt update -y
sudo apt upgrade -y

# 2) Chrome kurulumu
echo "[2/7] Google Chrome kuruluyor..."
if ! command -v google-chrome &> /dev/null; then
    wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    sudo apt install -y /tmp/google-chrome.deb || sudo apt --fix-broken install -y
    rm -f /tmp/google-chrome.deb
    echo "[+] Chrome kuruldu: $(google-chrome --version)"
else
    echo "[+] Chrome zaten kurulu: $(google-chrome --version)"
fi

# 3) Xvfb + gerekli paketler
echo "[3/7] Xvfb ve Python bagimliliklari kuruluyor..."
sudo apt install -y xvfb python3-venv python3-pip python3-dev fonts-liberation libnss3 libatk-bridge2.0-0 libgtk-3-0

# 4) Uygulama dizini
echo "[4/7] Uygulama dizini olusturuluyor: $APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo cp -r ./* "$APP_DIR/"
sudo cp .env "$APP_DIR/.env" 2>/dev/null || true
sudo cp .env.example "$APP_DIR/.env.example" 2>/dev/null || true

# 5) Python sanal ortam
echo "[5/7] Python sanal ortam kuruluyor..."
cd "$APP_DIR"
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install -r requirements.txt
echo "[+] Python paketleri kuruldu."

# 6) Systemd servislerini kur
echo "[6/7] Systemd servisleri kuruluyor..."
if [ -d "$APP_DIR/deploy/systemd" ]; then
    sudo cp "$APP_DIR/deploy/systemd/"*.service /etc/systemd/system/ 2>/dev/null || true
    sudo cp "$APP_DIR/deploy/systemd/"*.timer /etc/systemd/system/ 2>/dev/null || true
    sudo systemctl daemon-reload
    echo "[+] Systemd servisleri yuklendi."
fi

# 7) Test
echo "[7/7] Kurulum test ediliyor..."
"$VENV_DIR/bin/python" -c "
from seleniumbase import Driver
print('[+] SeleniumBase OK')
" 2>/dev/null && echo "[+] SeleniumBase calisiyor." || echo "[!] SeleniumBase hatasi - chrome kontrolu yapiniz."

google-chrome --version 2>/dev/null && echo "[+] Chrome OK" || echo "[!] Chrome bulunamadi!"

echo ""
echo "============================================"
echo "  KURULUM TAMAMLANDI!"
echo "============================================"
echo ""
echo "  Uygulama dizini : $APP_DIR"
echo "  Python venv     : $VENV_DIR"
echo ""
echo "  SIRADAKI ADIMLAR:"
echo "  1) .env dosyasini duzenle:"
echo "     sudo nano $APP_DIR/.env"
echo ""
echo "  2) Cookie testi calistir:"
echo "     cd $APP_DIR"
echo "     $VENV_DIR/bin/python sahibinden_bot.py --refresh-only --headless --xvfb"
echo ""
echo "  3) Bulk scraper testi:"
echo "     $VENV_DIR/bin/python bulk_scraper.py"
echo ""
echo "  4) Telegram bot baslatma:"
echo "     $VENV_DIR/bin/python telegram_bot.py"
echo ""
echo "  5) (Opsiyonel) Cookie auto-refresh daemon:"
echo "     sudo systemctl enable --now cookie-refresh.timer"
echo ""
echo "============================================"
