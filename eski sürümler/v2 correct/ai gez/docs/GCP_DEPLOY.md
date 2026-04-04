# GCP Sunucu Deployment Rehberi

Bu rehber, AI GEZ projesinin Google Cloud Platform (GCP) uzerinde calismasi icin adimlari icerir.

## Sorun Analizi

### Karsilasilan Sorun
- DrissionPage CDP modu GCP uzerinde Cloudflare tarafindan tespit ediliyor
- Sadece `cf_clearance` cookie'si alinabiliyor, `st`, `csid`, `csss` cookieler alinamiyor
- Warmup asamasinda timeout oluyor

### Sebep
- GCP IP adresleri Cloudflare tarafindan "datacenter" olarak isaretlenmis
- Ekstra bot tespit mekanizmalari devreye giriyor
- DrissionPage CDP modu tek basina yetersiz

### Cozum
- **SeleniumBase UC (Undetected Chrome)** modu kullanilmali
- SeleniumBase, Chrome'u gercek kullanici gibi gostermek icin gelismis stealth teknikleri kullanir
- `headless2=True` modu ile Cloudflare bypass daha etkili

---

## Deployment Adimlari

### 1. GCP VM Olusturma

```bash
# gcloud CLI ile olusturma (veya Console uzerinden)
gcloud compute instances create ai-gez-server \
  --zone=us-central1-a \
  --machine-type=e2-medium \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB \
  --tags=http-server,https-server
```

### 2. Baglanma ve Hazirlik

```bash
# SSH ile baglan
gcloud compute ssh ai-gez-server --zone=us-central1-a

# Sistem guncelleme
sudo apt update && sudo apt upgrade -y
```

### 3. Proje Kurulumu

```bash
# Uygulama dizini
sudo mkdir -p /opt/ai-gez
sudo chown $USER:$USER /opt/ai-gez

# Dosyalari kopyala (yerelden veya git'den)
# Git kullaniyorsaniz:
git clone <repo-url> /opt/ai-gez
cd /opt/ai-gez

# VEYA dosyalari scp ile gonderin:
# gcloud compute scp --recurse ./deploy_package/* ai-gez-server:/opt/ai-gez/
```

### 4. Kurulum Scripti

```bash
cd /opt/ai-gez
chmod +x setup.sh
./setup.sh
```

Bu script sunlari yapar:
- Chrome kurulumu
- Xvfb ve Python bagimliliklari
- Python venv olusturma
- requirements.txt kurulumu
- Systemd servislerini yukleme

### 5. .env Dosyasi Yapilandirmasi

```bash
cd /opt/ai-gez
nano .env
```

Ornek icerik:
```env
# Sahibinden
SAHIBINDEN_URL=https://www.sahibinden.com/ekran-karti-masaustu
SAHIBINDEN_EMAIL=sizin@email.com
SAHIBINDEN_PASS=sifreniz

# Telegram (opsiyonel)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# GCS (opsiyonel)
GCS_COOKIE_BUCKET=your-bucket-name
GOOGLE_APPLICATION_CREDENTIALS=/opt/ai-gez/service-account.json

# Proxy (WARP veya residential proxy - TAVSIYE EDILIR)
PROXY_URL=socks5://user:pass@host:port
```

### 6. Cookie Testi

**Bu adim cok onemli!** Cookie alma isleminin calistigini dogrulayin:

```bash
cd /opt/ai-gez
source .venv/bin/activate

# Test scripti calistir
python test_server_cookie.py

# VEYA xvfb ile:
xvfb-run -a python test_server_cookie.py
```

Basarili cikti ornegi:
```
[36s] cf=True, st=True, csid=True, csss=True | CF=False, Listings=True, Login=False

[+] BASARILI! Tum kritik cookieler alindi.
[+] Toplam 15 cookie
```

### 7. Manuel Cookie Alma Testi

```bash
# Yeni bot ile cookie almayi test et
python sahibinden_bot.py --refresh-only --headless

# Basariliysa curl_request.sh olusacak
cat curl_request.sh

# Cookie gecerliligini test et
python -c "
from curl_cffi import requests as cffi
import re

# curl_request.sh'den oku
with open('curl_request.sh') as f:
    content = f.read()

# Cookie ve UA cikar
ua_match = re.search(r\"User-Agent: (.+)\\\", content)
cookie_match = re.search(r\"Cookie: (.+)\\\", content)

if ua_match and cookie_match:
    headers = {
        'User-Agent': ua_match.group(1),
        'Cookie': cookie_match.group(1)
    }
    resp = cffi.get('https://www.sahibinden.com/ekran-karti-masaustu', headers=headers, impersonate='chrome')
    print(f'Status: {resp.status_code}')
    print(f'Has listings: {\"searchResultsItem\" in resp.text}')
else:
    print('Cookie/UA bulunamadi')
"
```

### 8. Otomasyon Servislerini Baslatma

**Tek seferlik test:**
```bash
# Cookie yenile ve scraper'i calistir
python sahibinden_bot.py --refresh-only --headless
python bulk_scraper.py
```

**Systemd servisleri ile surekli calistirma:**

```bash
# Servisleri etkinlestir ve baslat
sudo systemctl daemon-reload

# Cookie refresh timer (her saat basi)
sudo systemctl enable cookie-refresh.timer
sudo systemctl start cookie-refresh.timer

# API server (arkaplan servisi)
sudo systemctl enable api-server.service
sudo systemctl start api-server.service

# Durum kontrolu
sudo systemctl status cookie-refresh.timer
sudo systemctl status api-server.service
```

### 9. Log Kontrolu

```bash
# Son cookie refresh loglari
sudo journalctl -u cookie-refresh.service -f

# API server loglari
sudo journalctl -u api-server.service -f

# Tum ai-gez loglari
sudo journalctl -u '*ai-gez*' -f
```

---

## Sorun Giderme

### Problem: Cookie alinamiyor

```bash
# 1. Chrome kurulumunu kontrol et
google-chrome --version

# 2. Xvfb calisiyor mu?
xvfb-run -a echo "Xvfb OK"

# 3. SeleniumBase testi
cd /opt/ai-gez
source .venv/bin/activate
python test_server_cookie.py
```

### Problem: IP Engellenmis

Eger GCP IP'niz Cloudflare tarafindan engellenmisse:

1. **WARP/Wireguard kullanin:**
```bash
# Cloudflare WARP kurulumu
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | sudo gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflare-client.list
sudo apt update && sudo apt install cloudflare-warp

# WARP'a baglan
warp-cli register
warp-cli connect
warp-cli status
```

2. **Residential proxy kullanin:**
```env
# .env dosyasina ekle
PROXY_URL=socks5://user:pass@host:port
```

3. **Farkli bir GCP bolgesi deneyin** (IP adresi degisecek)

### Problem: SeleniumBase calismiyor

```bash
# chromedriver guncelle
seleniumbase install chromedriver

# veya
python -m seleniumbase install chromedriver
```

### Problem: Ekran karti sayfasi yerine login sayfasi geliyor

Bu normal davranis - yurt disi IP'lerden erisimde login gerekiyor:

1. `.env` dosyasina login bilgilerini ekleyin
2. Bot otomatik login yapmaya calisacak

### Problem: "Just a moment" hatasi

Cloudflare challenge cozulemiyor:

1. Xvfb ile calistirin: `xvfb-run -a python sahibinden_bot.py`
2. Daha uzun bekleme suresi ekleyin (sahibinden_bot_v2.py'de `max_wait` parametresi)
3. Farkli bir sunucu/IP deneyin

---

## Dosya Yapisi

```
/opt/ai-gez/
├── sahibinden_bot.py        # Ana bot (SeleniumBase + DrissionPage)
├── bulk_scraper.py          # Ilan cekici (curl_cffi)
├── cookie_auto_refresh.py   # Otomatik yenileyici
├── telegram_cookie_bridge.py # Telegram entegrasyonu
├── gcs_cookie_bridge.py     # GCS entegrasyonu
├── test_server_cookie.py    # Sunucu test scripti
├── curl_request.sh          # Olusturulan cookie dosyasi
├── ilanlar.json            # Cekilen ilanlar
├── .env                    # Ortam degiskenleri
├── requirements.txt        # Python bagimliliklari
├── setup.sh               # Kurulum scripti
└── deploy/
    └── systemd/            # Systemd servis dosyalari
```

---

## Guncelleme

```bash
cd /opt/ai-gez
# Yeni dosyalari cek
git pull

# VEYA manuel kopyalama

# Bagimliliklari guncelle
source .venv/bin/activate
pip install -r requirements.txt --upgrade

# Servisleri yeniden baslat
sudo systemctl restart cookie-refresh.timer
sudo systemctl restart api-server.service
```

---

## Guvenlik Notlari

1. **`.env` dosyasi izinleri:**
```bash
chmod 600 /opt/ai-gez/.env
chmod 600 /opt/ai-gez/curl_request.sh
```

2. **Service account anahtarlari:**
- GCS kullaniyorsaniz, `service-account.json` dosyasini guvenli tutun
- `chmod 600 /opt/ai-gez/service-account.json`

3. **Firewall:**
```bash
# Sadece gereken portlari acin
sudo ufw allow 8000/tcp  # API server
sudo ufw allow 22/tcp    # SSH
sudo ufw enable
```

---

## Destek

Sorun yasarsaniz:
1. `test_server_cookie.py` calistirin ve ciktiyi kaydedin
2. Loglari kontrol edin: `sudo journalctl -u cookie-refresh.service -n 100`
3. SeleniumBase ve Chrome surumlerini kontrol edin
