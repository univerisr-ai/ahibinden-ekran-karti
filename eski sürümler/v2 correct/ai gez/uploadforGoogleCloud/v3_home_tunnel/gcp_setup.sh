#!/bin/bash
# ============================================================
#  GCP Ubuntu 24.04 LTS — V3 Tam Otonom Kurulum Scripti
#  Tüm bağımlılıkları kurar ve sistemi hazır hale getirir.
#
#  Region: europe-west4 (Netherlands)
#
#  Kullanım: sudo bash gcp_setup.sh
# ============================================================

set -e

echo "============================================="
echo "  GCP V3 Tam Otonom Kurulum"
echo "  Ubuntu 24.04 LTS — europe-west4"
echo "============================================="

# 1. Sistem güncellemesi
echo "[1/7] Sistem güncelleniyor..."
apt-get update -qq
apt-get upgrade -y -qq

# 2. Temel paketler
echo "[2/7] Temel paketler kuruluyor..."
apt-get install -y -qq \
    xvfb \
    python3-pip \
    python3-venv \
    python3-tk \
    python3-dev \
    curl \
    wget \
    gnupg \
    lsb-release \
    apt-transport-https \
    fonts-liberation \
    libasound2t64 \
    libatk-bridge2.0-0t64 \
    libatk1.0-0t64 \
    libatspi2.0-0t64 \
    libcups2t64 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0t64 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    unzip

# 3. Google Chrome
echo "[3/7] Google Chrome kuruluyor..."
if ! command -v google-chrome &>/dev/null; then
    wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    dpkg -i google-chrome-stable_current_amd64.deb || apt-get install -f -y -qq
    rm -f google-chrome-stable_current_amd64.deb
    echo "  → Chrome kuruldu: $(google-chrome --version 2>/dev/null || echo 'OK')"
else
    echo "  → Chrome zaten kurulu: $(google-chrome --version 2>/dev/null || echo 'OK')"
fi

# 4. Firefox (Camoufox için gerekli)
echo "[4/7] Firefox kuruluyor (Camoufox için)..."
apt-get install -y -qq firefox 2>/dev/null || true

# 5. Cloudflare WARP (fallback yöntemi)
echo "[5/7] Cloudflare WARP kuruluyor..."
if ! command -v warp-cli &>/dev/null; then
    curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ noble main" > /etc/apt/sources.list.d/cloudflare-client.list
    apt-get update -qq
    apt-get install -y -qq cloudflare-warp

    systemctl start warp-svc 2>/dev/null || true
    sleep 2

    if ! warp-cli registration show &>/dev/null; then
        warp-cli registration new
    fi
    warp-cli mode proxy
    warp-cli proxy port 40000
    warp-cli connect
    sleep 3

    systemctl enable warp-svc 2>/dev/null || true
    echo "  → WARP kuruldu ve SOCKS5 proxy aktif (127.0.0.1:40000)"
else
    echo "  → WARP zaten kurulu"
fi

# 6. Python ortamı
echo "[6/7] Python ortamı kuruluyor..."
PROJECT_DIR="/opt/ai-gez"
mkdir -p $PROJECT_DIR

if [ ! -d "$PROJECT_DIR/.venv" ]; then
    python3 -m venv $PROJECT_DIR/.venv
fi

source $PROJECT_DIR/.venv/bin/activate

# requirements.txt varsa kullan
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/requirements.txt" ]; then
    pip install -q -r "$SCRIPT_DIR/requirements.txt" 2>&1 | tail -3
else
    pip install -q nodriver curl_cffi python-dotenv requests python-telegram-bot 2>&1 | tail -3
    pip install -q seleniumbase 2>&1 | tail -3
    pip install -q "camoufox[geoip]" playwright 2>&1 | tail -3
fi

# Camoufox browser dosyalarını indir
echo "  → Camoufox browser indiriliyor..."
python -m camoufox fetch 2>/dev/null || echo "  → Camoufox fetch başarısız (sonra denenebilir)"

# Playwright browser indirme (seleniumbase kendi driver'ını yönetir)
# python -m playwright install chromium 2>/dev/null || true

echo "  → Python paketleri kuruldu"

# 7. Dosyaları kopyala
echo "[7/7] Proje dosyaları kontrol ediliyor..."
if [ -d "$SCRIPT_DIR" ] && [ "$SCRIPT_DIR" != "$PROJECT_DIR" ]; then
    cp -n "$SCRIPT_DIR"/*.py "$PROJECT_DIR/" 2>/dev/null || true
    cp -n "$SCRIPT_DIR"/.env.example "$PROJECT_DIR/" 2>/dev/null || true
    cp -n "$SCRIPT_DIR"/requirements.txt "$PROJECT_DIR/" 2>/dev/null || true
    echo "  → Dosyalar /opt/ai-gez/ klasörüne kopyalandı"
fi

# .env dosyası kontrolü
if [ ! -f "$PROJECT_DIR/.env" ]; then
    if [ -f "$PROJECT_DIR/.env.example" ]; then
        cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
        echo ""
        echo "  ⚠️  .env dosyası .env.example'dan oluşturuldu."
        echo "     Token'ları doldurun: nano $PROJECT_DIR/.env"
    fi
fi

echo ""
echo "============================================="
echo "  ✅ KURULUM TAMAMLANDI!"
echo "============================================="
echo ""
echo "📋 SONRAKI ADIMLAR:"
echo ""
echo "1. .env dosyasını düzenleyin:"
echo "   nano ${PROJECT_DIR}/.env"
echo ""
echo "2. Cookie üretimini test edin:"
echo "   cd ${PROJECT_DIR}"
echo "   source .venv/bin/activate"
echo "   python cookie_generator_v3.py"
echo ""
echo "3. Bot controller'ı başlatın:"
echo "   python bot_controller.py"
echo ""
echo "4. Cron job ekleyin (otonom cookie yenileme):"
echo "   crontab -e"
echo "   */45 * * * * cd ${PROJECT_DIR} && source .venv/bin/activate && python cookie_generator_v3.py >> /var/log/cookie_v3.log 2>&1"
echo ""

# WARP test
echo "🌐 WARP Durumu:"
WARP_IP=$(curl -s --max-time 10 --socks5 127.0.0.1:40000 https://ifconfig.me 2>/dev/null || echo "BAĞLANTILAMADI")
NORMAL_IP=$(curl -s --max-time 10 https://ifconfig.me 2>/dev/null || echo "Bilinmiyor")
echo "  → GCP IP:  ${NORMAL_IP}"
echo "  → WARP IP: ${WARP_IP}"
echo ""
