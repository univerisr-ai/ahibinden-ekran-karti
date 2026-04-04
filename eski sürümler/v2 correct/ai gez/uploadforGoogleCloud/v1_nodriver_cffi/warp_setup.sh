#!/bin/bash
# ============================================================
#  Cloudflare WARP SOCKS5 Kurulum Scripti (GCP Ubuntu)
#  Bu script sunucuya Cloudflare WARP kurar ve SOCKS5 modunda
#  127.0.0.1:40000 portunda çalıştırır.
#  
#  Kullanım: sudo bash warp_setup.sh
# ============================================================

set -e

echo "============================================="
echo "  Cloudflare WARP SOCKS5 Kurulumu"
echo "============================================="

# 1. Gerekli paketleri kur
echo "[1/6] Gerekli paketler kuruluyor..."
apt-get update -qq
apt-get install -y -qq curl gnupg lsb-release apt-transport-https

# 2. Cloudflare GPG anahtarını ekle
echo "[2/6] Cloudflare GPG anahtarı ekleniyor..."
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg

# 3. Cloudflare APT reposunu ekle
echo "[3/6] Cloudflare APT deposu ekleniyor..."
DISTRO=$(lsb_release -cs)
echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ ${DISTRO} main" > /etc/apt/sources.list.d/cloudflare-client.list

# 4. cloudflare-warp paketini kur
echo "[4/6] cloudflare-warp paketi kuruluyor..."
apt-get update -qq
apt-get install -y -qq cloudflare-warp

# 5. WARP'ı kaydet ve proxy moduna al
echo "[5/6] WARP kaydediliyor ve SOCKS5 proxy moduna alınıyor..."

# Eğer daha önce kaydedilmişse atla
if ! warp-cli registration show &>/dev/null; then
    warp-cli registration new
    echo "  → Yeni kayıt oluşturuldu"
else
    echo "  → Mevcut kayıt kullanılıyor"
fi

# Proxy moduna al (tüm trafiği yönlendirmek yerine sadece SOCKS5 olarak çalışır)
warp-cli mode proxy
echo "  → Mod: proxy (SOCKS5)"

# Proxy portunu ayarla
warp-cli proxy port 40000
echo "  → Port: 40000"

# 6. Bağlan
echo "[6/6] WARP'a bağlanılıyor..."
warp-cli connect

# Bağlantı kontrolü
sleep 3
STATUS=$(warp-cli status 2>/dev/null || echo "Unknown")
echo ""
echo "============================================="
echo "  WARP Durum: ${STATUS}"
echo "============================================="

# IP testi
echo ""
echo "[TEST] WARP IP adresi kontrol ediliyor..."
WARP_IP=$(curl -s --socks5 127.0.0.1:40000 https://ifconfig.me 2>/dev/null || echo "HATA")
echo "  → WARP IP: ${WARP_IP}"

if [ "$WARP_IP" != "HATA" ]; then
    NORMAL_IP=$(curl -s https://ifconfig.me 2>/dev/null || echo "Bilinmiyor")
    echo "  → Normal IP: ${NORMAL_IP}"
    
    if [ "$WARP_IP" != "$NORMAL_IP" ]; then
        echo ""
        echo "✅ BAŞARILI! WARP SOCKS5 proxy aktif."
        echo "   Proxy adresi: socks5://127.0.0.1:40000"
    else
        echo ""
        echo "⚠️ UYARI: IP'ler aynı - WARP düzgün çalışmıyor olabilir."
    fi
else
    echo "❌ HATA: WARP proxy'ye bağlanılamadı!"
    echo "   'warp-cli status' ile durumu kontrol edin."
fi

echo ""
echo "============================================="
echo "  Kurulum Tamamlandı!"
echo "  WARP otomatik başlatma için:"
echo "  systemctl enable warp-svc"
echo "============================================="

# systemd ile otomatik başlatma
systemctl enable warp-svc 2>/dev/null || true
