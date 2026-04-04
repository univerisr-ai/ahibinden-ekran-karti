# Server Setup (Cookie Auto Refresh)

## 1) Onerilen sunucu tipi

Bu proje icin minimum:
- 2 vCPU
- 4 GB RAM
- 40+ GB NVMe SSD
- Ubuntu 24.04 LTS

Sebep: Selenium + Chrome + cookie yenileme adimi 1 GB RAM makinelerde sik crash verebilir.

Pratik onerim:
- Hetzner Cloud (EU lokasyon: FSN veya NBG) ve en az 4 GB RAM plan
- Alternatif: Vultr Regular 2 GB (baslangic), stabilite icin 4 GB'a cik
- Fiyat referansi (06 Mart 2026 kontrolu):
  - Hetzner EU: CX23 $4.99, CPX22 $9.49 (1 Nisan 2026 guncellemesi sonrasi)
  - Vultr: 2 GB $10/ay, 4 GB $20/ay

Not: Hetzner resmi duyurusuna gore fiyatlar **1 Nisan 2026** tarihinde guncellendi.

## 2) Altyapi akisi (sunucu/domain olmadan da hazir)

Akis:
- Cookie server: `cookie_auto_refresh.py` cookie yeniler.
- Cookie server: `gcs_cookie_bridge.py push` ile payload'i GCS'e yazar.
- Web tarafi server: `gcs_cookie_bridge.py pull` ile GCS'ten son payload'i alip `curl_request.sh` dosyasini gunceller.
- (Opsiyonel) Telegram bridge: manuel test ve bildirim amacli kullanilabilir.

Boylece domain hazir olmasa bile backend akisi simdiden test edilebilir.

## 3) Sunucuya alinacak dosyalar

### Sadece cookie yenileme icin (minimum)
`deploy/minimal-cookie-files.txt` dosyasindaki set:
- cookie_auto_refresh.py
- telegram_cookie_bridge.py
- gcs_cookie_bridge.py
- sahibinden_bot.py
- bulk_scraper.py
- curl_request.sh
- requirements.txt
- .env.example

### Cookie + API + test frontend
`deploy/full-stack-files.txt` dosyasindaki set:
- backend/api_server.py
- frontend/index.html
- cookie_auto_refresh.py
- telegram_cookie_bridge.py
- gcs_cookie_bridge.py
- sahibinden_bot.py
- bulk_scraper.py
- curl_request.sh
- requirements.txt
- .env.example

Sunucuya **tasima**:
- `.venv/`
- `.chrome_profile/`
- `__pycache__/`
- lokal `ilanlar.json` (opsiyonel, sifirdan uretilebilir)

## 4) Sunucuda kurulum (Ubuntu)

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip curl unzip xvfb
```

Chrome/Chromium kurulu olmali (undetected-chromedriver icin gerekli).

```bash
cd /opt/ai-gez
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 5) Bridge ayarlari (GCS onerilen)

```bash
cp .env.example .env
```

`.env` icinde:
- `GCS_COOKIE_BUCKET` (zorunlu)
- `GCS_COOKIE_OBJECT` (opsiyonel, default: `cookie/latest.json`)
- `GCS_COOKIE_HISTORY_PREFIX` (opsiyonel, default: `cookie/history`)

Kimlik dogrulama:
- Google Cloud VM uzerinde calisiyorsan VM'e uygun Service Account bagla.
- VM disinda calisiyorsan `GOOGLE_APPLICATION_CREDENTIALS` ile JSON key dosyasi tanimla.

Guvenlik notu: Payload cookie icerir. Bucket yetkisini sadece gerekli servis hesaplariyla sinirla.

Hizli test (manual):
```bash
python gcs_cookie_bridge.py push --reason manual_test --source cookie_server
python gcs_cookie_bridge.py pull
```

## 6) Otomatik cookie yenileme + GCS push

Projede hazir dosyalar:
- `deploy/systemd/cookie-refresh.service`
- `deploy/systemd/cookie-refresh.timer`

Kullanim:
```bash
sudo cp deploy/systemd/cookie-refresh.service /etc/systemd/system/
sudo cp deploy/systemd/cookie-refresh.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cookie-refresh.timer
sudo systemctl status cookie-refresh.timer
```

Bu timer her 10 dakikada bir kontrol yapar:
- Cookie gecersizse yeniler
- Cookie cok eskiyse (default 90 dk) zorunlu yeniler
- Cookie yenilenirse GCS'e payload yazar

Eger cookie yenilenince otomatik scrape de istiyorsan, service dosyasindaki
`ExecStart` satirina `--run-scraper-on-refresh` ekleyebilirsin.

Log:
```bash
tail -f /var/log/ai-gez-cookie.log
```

## 7) GCS'den website sunucusuna cookie cekme

Hazir unit:
- `deploy/systemd/gcs-cookie-pull.service`
- `deploy/systemd/gcs-cookie-pull.timer`

```bash
sudo cp deploy/systemd/gcs-cookie-pull.service /etc/systemd/system/
sudo cp deploy/systemd/gcs-cookie-pull.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gcs-cookie-pull.timer
sudo systemctl status gcs-cookie-pull.timer
```

Log:
```bash
tail -f /var/log/ai-gez-gcs-pull.log
```

## 8) Telegram bridge (opsiyonel / manuel test)

Istersen Telegram koprusu yine kullanilabilir:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Manuel test:
```bash
python telegram_cookie_bridge.py push --reason manual_test --source local
python telegram_cookie_bridge.py pull
```

## 9) API sunucu (opsiyonel)

Hazir unit:
- `deploy/systemd/api-server.service`

```bash
sudo cp deploy/systemd/api-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now api-server.service
sudo systemctl status api-server.service
```

## 10) Hiz/ram ayari (242 ilan ve ustu icin)

`bulk_scraper.py` artik `.env` uzerinden ayarlanabilir:
- `SEGMENT_WORKERS`
- `PAGE_WORKERS`
- `PAGE_SIZE`
- `MAX_PAGES_PER_SEGMENT`
- `REQUEST_DELAY`
- `REQUEST_TIMEOUT`
- `MAX_RETRIES`

Baslangic onerisi (denge):
- `SEGMENT_WORKERS=4`
- `PAGE_WORKERS=2`
- `REQUEST_DELAY=0.6`

## 11) Sunucu onkontrol ve log hijyeni

Yeni yardimci dosyalar:
- `server_preflight.py`: servis baslamadan once eksik dosya, env ve bagimlilik kontrolu yapar.
- `redacted_runner.py`: servis loglarinda token, cookie ve benzeri hassas verileri maskeler.

Hizli kullanim:
```bash
cd /opt/ai-gez
.venv/bin/python server_preflight.py --service cookie-refresh
.venv/bin/python server_preflight.py --service gcs-cookie-pull
.venv/bin/python server_preflight.py --service api-server
```

Hassas dosya izinlerini daraltmak icin:
```bash
chmod 600 .env curl_request.sh
.venv/bin/python server_preflight.py --service cookie-refresh --fix-perms
```

Eger terminal gecmisinde token veya sifre loga dustuyse:
- Telegram bot tokenini rotate et
- Hesap sifrelerini degistir
- `.env`, `curl_request.sh` ve ilgili log dosyalarinin izinlerini tekrar kontrol et
