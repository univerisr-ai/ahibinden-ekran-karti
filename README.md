# GitHub'da sahibinden ekran karti yonlendirme ve duzenli ziyaret

Bu proje uc parca halinde calisir:

1. GitHub Pages icin tek sayfalik yonlendirme sitesi
2. GitHub Actions ile duzenli araliklarda sadece ilgili sayfaya istek atan workflow
3. Telegram'dan komut gelince GitHub sunucusunda ekran goruntusu alip geri gonderen workflow

Her iki parca da su adresi kullanir:

`https://www.sahibinden.com/ekran-karti-masaustu`

## Ne yapar?

- Sadece sahibinden ekran karti kategorisine gider.
- Ilan cekmez.
- Veri islemez.
- Workflow tarafinda sadece ilgili sayfaya HTTP istegi atar.

## GitHub Pages kurulum

1. Bu klasoru GitHub'da yeni bir repoya yukle.
2. GitHub'da `Settings > Pages` kismina gir.
3. `Deploy from a branch` sec.
4. Branch olarak `main`, klasor olarak `/ (root)` sec.
5. Birkaç dakika sonra sana bir GitHub Pages linki verir.

Bu link acilinca ziyaretci dogrudan ekran karti sayfasina gecer.

## GitHub Actions ile duzenli ziyaret

`.github/workflows/visit-sahibinden.yml` dosyasi hazirdir.

Bu workflow:

- Elle calistirilabilir
- Her 6 saatte bir otomatik calisir
- Sadece `https://www.sahibinden.com/ekran-karti-masaustu` adresine istek atar
- HTTP durum kodunu ve inen veri boyutunu loglar
- Sayfa basligini ve dosya hash degerini loglar
- Indirilen HTML'i artifact olarak saklar

GitHub'da acmak icin:

1. Repoyu GitHub'a yukle.
2. `Actions` sekmesine gir.
3. Workflow'lari etkinlestir.
4. `Visit sahibinden ekran karti` workflow'unu ac.
5. Istersen `Run workflow` ile elle test et.
6. Calisan job icinde `Artifacts` bolumunden indirilen `page.html` dosyasini gorebilirsin.

## Onemli not

GitHub Pages statik calisir. Duzenli ziyaret isini bu projede GitHub Actions yapar.

GitHub'in resmi dokumanina gore `schedule` ile calisan workflow'lar:

- Varsayilan branch uzerinde calisir
- En sik 5 dakikada bir tetiklenebilir
- Public repolarda 60 gun etkinlik olmazsa otomatik durdurulabilir

Yani bu yapi mumkundur, ama tamami Pages ile degil; Pages + Actions birlikte calisir.

## Telegram ile ekran goruntusu alma

`.github/workflows/telegram-sahibinden-shot.yml` ve
`scripts/telegram-sahibinden-shot.mjs` dosyalari hazirdir.

Bu yapi:

- GitHub sunucusunda calisir
- PC kapali olsa bile devam eder
- Telegram mesajlarini en sik 5 dakikada bir kontrol eder
- Komut gorurse sahibinden ekran karti sayfasinin ekran goruntusunu ceker
- Goruntuyu ayni Telegram bota geri yollar

### GitHub Secrets

GitHub'da `Settings > Secrets and variables > Actions` icine sunlari ekle:

- `TELEGRAM_BOT_TOKEN_1`
- `TELEGRAM_BOT_TOKEN_2`
- `TELEGRAM_CHAT_ID`

Bu projede DM fallback kapalidir. Grup icine gonderim icin `TELEGRAM_CHAT_ID` kullanin.

### Kullanimi

1. `Actions` sekmesinde `Telegram sahibinden screenshot` workflow'unu etkinlestir.
2. `Run workflow` ile bir kez elle calistirip ilk testi yap.
3. Daha sonra Telegram'dan bota su tur mesajlar atabilirsin:
   - `ekran`
   - `/ekran`
   - `/shot`
   - `kontrol`
   - `sahibinden`
4. Workflow mesaji gorurse ekran goruntusunu ayni sohbete geri yollar.

Grup icinde kullaniyorsan slash komutu kullanmak daha guvenlidir. Ornek:

- `/ekran`
- `/shot`

### Onemli sinir

Bu yapi gercek zamanli degildir. GitHub Actions zamanlanmis workflow'lari en sik 5 dakikada bir calisir. Yani Telegram'dan mesaj attiktan sonra cevap genelde birkaç dakika icinde gelir.

## Scraper cookie kurulumu (GitHub Actions oncelikli)

`scraper.yml` icin cookie bootstrap altyapisi eklendi. Sistem su sirada cookie kaynaklarini su oncelikle dener:

1. `SAHIBINDEN_COOKIES` (GitHub Secret / ENV)
2. Lokal `cookies.json` dosyasi (yalnizca local calisma)

`REQUIRE_SAHIBINDEN_COOKIES=true` aktifken cookie yoksa veya gecersizse kosu fail-fast olarak daha baslamadan durdurulur.

### Gerekli GitHub Secrets

GitHub'da `Settings > Secrets and variables > Actions` altina sunlari ekleyin:

- `SAHIBINDEN_COOKIES`
- `TELEGRAM_BOT_TOKEN_1` veya `TELEGRAM_BOT_TOKEN_2`
- `TELEGRAM_CHAT_ID` (grup icin zorunlu, `-100...` veya `-...` formatinda; degeri tirnaksiz girin)
- (opsiyonel, bot-only relay) `ANALYZER_DISPATCH_TOKEN` (2elAnaliz reposuna `repository_dispatch` gonderebilen token)
- (opsiyonel) `GEMINI_API_KEY`, `OPENROUTER_API_KEY`

GitHub Variables (opsiyonel):

- `AI_PROVIDER` (ornek: `openrouter` veya `gemini`)
- `OPENROUTER_MODEL` (ornek: `anthropic/claude-3.5-sonnet`)
- (opsiyonel, relay) `ANALYZER_REPO_OWNER` (varsayilan: `univerisr-ai`)
- (opsiyonel, relay) `ANALYZER_REPO_NAME` (varsayilan: `2elAnaliz`)
- (opsiyonel, relay) `ANALYZER_DISPATCH_EVENT` (varsayilan: `telegram_file_ready`)

Not: Telegram'da botlar diger bot mesajlarini update olarak goremez. Bu nedenle bot-only akista scraper, dosyayi Telegram'a gonderdikten sonra `file_id` ile analyzer workflow'unu `repository_dispatch` uzerinden tetikler.

### SAHIBINDEN_COOKIES formati

Secret degeri bir JSON array olmali. Her kayit icin `name`, `value` ve `domain` veya `url` zorunludur.

```json
[
   {
      "name": "sid",
      "value": "ornek-deger",
      "domain": ".sahibinden.com",
      "path": "/",
      "httpOnly": false,
      "secure": true,
      "sameSite": "Lax"
   }
]
```

Notlar:

- `expires` gecmisse cookie otomatik elenir.
- `sameSite` degeri `Lax`, `Strict` veya `None` olmali.
- Secret icerigini loglara yazdirmayin.

### Lokal gelistirme (cookies.json fallback)

Repo kokune `cookies.json` koyarsaniz, `SAHIBINDEN_COOKIES` yokken lokalde otomatik okunur.

### Siklikla gorulen fail-fast kodlari

- `COOKIE_REQUIRED_MISSING`: Cookie zorunlu ama hic kaynak bulunamadi.
- `COOKIE_PARSE_INVALID`: JSON parse hatasi.
- `COOKIE_SCHEMA_INVALID`: Cookie semasi gecersiz.
- `COOKIE_EMPTY_AFTER_FILTER`: Expires/format sonrasi kullanilabilir cookie kalmadi.
- `COOKIE_ADD_FAILED`: Playwright context icine cookie eklenemedi.
- `AUTH_REQUIRED`: Login gerekli sayfa tespit edildi.

### Cevresel degisken referansi (scraper)

| Degisken | Aciklama |
|---|---|
| `SAHIBINDEN_COOKIES` | Sahibinden cookie JSON payload (Secret/ENV) |
| `REQUIRE_SAHIBINDEN_COOKIES` | `true` ise cookie bootstrap zorunlu ve fail-fast |
| `USE_WARP_PROXY` | WARP SOCKS proxy modunu ac/kapat |
| `DOLAP_USE_WARP_PROXY` | Dolap workflow'undaki WARP variable adini Sahibinden icin alias olarak kullanir |
| `SAHIBINDEN_PROXY_SERVER` | Sahibinden icin acik proxy URL override'i; kimlik bilgisi URL icinde verilebilir |
| `DOLAP_PROXY_SERVER` | Dolap scraper'daki proxy ayarini Sahibinden icin fallback olarak kullanir |
| `HEADLESS` | Playwright headless calisma modu |
| `SAHIBINDEN_PRODUCT_TYPE` | `gpu` varsayilan, `cpu` islemci kategorisi |
| `SAHIBINDEN_BASE_URL` | Varsayilan kategori URL'sini override eder |
| `CUSTOM_MIN_PRICE` | Workflow dispatch min fiyat |
| `CUSTOM_MAX_PRICE` | Workflow dispatch max fiyat |
| `BYPASS_AI` | AI analizini atla/aktif et |
| `ANALYZER_DISPATCH_TOKEN` | 2elAnaliz reposuna `repository_dispatch` atmak icin PAT / token |
| `ANALYZER_REPO_OWNER` | Analyzer repo owner (varsayilan `univerisr-ai`) |
| `ANALYZER_REPO_NAME` | Analyzer repo adi (varsayilan `2elAnaliz`) |
| `ANALYZER_DISPATCH_EVENT` | Repository dispatch event tipi (varsayilan `telegram_file_ready`) |
| `FINGERPRINT_DIAGNOSTIC` | Runtime profil ozeti ve imza loglarini ac/kapat |
| `FINGERPRINT_STRICT_MODE` | Profil policy mismatch durumunda fail-fast |
| `EXPECTED_TIMEZONE` | Beklenen timezone (or. Europe/Istanbul) |
| `EXPECTED_LOCALE` | Beklenen locale (or. tr-TR) |
| `EXPECTED_PLATFORM` | Platform substring kontrolu (or. win32) |

### Runtime profil kontrolu (fingerprint diagnostigi)

Scraper, tarayici acilisinda runtime profil ozeti (timezone, locale, platform, webdriver ve imza) loglar.

- `FINGERPRINT_DIAGNOSTIC=true` ise bu diagnostik loglar aktif olur.
- `FINGERPRINT_STRICT_MODE=true` ve policy mismatch varsa kosu `FINGERPRINT_POLICY_FAILED` ile fail-fast durur.
- `EXPECTED_TIMEZONE`, `EXPECTED_LOCALE`, `EXPECTED_PLATFORM` ile beklenen ortam tanimlanabilir.

### Haftada 2 rastgele gun politikasi

Scraper workflow'u cron ile her gun tetiklenir, ancak calisma politikasi su sekildedir:

- Her hafta icin deterministic bir seed ile 2 rastgele gun secilir.
- Yalnizca secilen 2 gunde scraping adimlari calisir.
- Diger gunlerde workflow erken ve basarili sekilde skip edilir.
- Schedule tetiklerinde ek olarak jitter beklemesi uygulanir (0-5400 sn), boylece calisma saati sabit bir imza birakmaz.

Manuel `workflow_dispatch` tetiklemeleri bu politikayi bypass eder ve dogrudan calisir.

### CPU workflow'u

`.github/workflows/sahibinden_cpu.yml` ayri bir Actions workflow'udur. Ayni scraper motorunu kullanir ama `SAHIBINDEN_PRODUCT_TYPE=cpu` ile Sahibinden islemci kategorisine gider:

`https://www.sahibinden.com/islemci-masaustu`

GPU workflow'una zarar vermemek icin:

- GPU default profil olarak kalir; env verilmezse eski ekran karti akisi calisir.
- CPU workflow artifact adi `scraper-results-cpu-<run_id>` olur.
- CPU kosusu varsayilan olarak analyzer'a dispatch atmaz; once artifact uzerinden veri kalitesi kontrol edilir.
- CPU icin AI kapali tutulur; GPU odakli prompt ile yanlis siniflama yapmasin diye fallback siralama kullanilir.

## Daha saglam yontem: sahibinden bildirimlerini Telegram'a dusurme

GitHub tarafi sahibinden'in bot korumasina takildigi icin, daha guvenilir secenek sahibinden'in kendi bildirimlerini kullanmaktir.

Bu repo icinde hazir Google Apps Script dosyasi:

- `apps-script/sahibinden-telegram-relay.gs`

Bu yontem:

- PC kapaliyken de calisir
- Google sunucusunda zamanlanmis tetikleyici ile ilerler
- sahibinden'in kendi e-posta bildirimlerini izler
- yeni bildirim gelince Telegram'a metin ve link yollar
- birden fazla hesabi merkez Gmail'de toplamak icin uygundur
- scraping yapmaz, ekran goruntusu almaya calismaz

### Nasil kurulur

1. sahibinden'de aramani `Favori Arama` olarak kaydet.
2. E-posta bildirimini ac.
3. Google hesabinda `script.google.com` uzerinden yeni bir Apps Script projesi olustur.
4. `apps-script/sahibinden-telegram-relay.gs` dosyasindaki kodu yapistir.
5. `TELEGRAM_BOT_TOKEN` ve `TELEGRAM_CHAT_ID` alanlarini doldur.
6. Birden fazla hesabin varsa her Gmail hesabindan merkez adrese yonlendirme ac.
7. Istersen Gmail plus alias kullan:
   - `merkez+hesap1@gmail.com`
   - `merkez+hesap2@gmail.com`
8. Script icindeki `ACCOUNT_ALIASES` alanini bu aliaslara gore doldur.
9. `setupEveryFiveMinutesTrigger()` fonksiyonunu bir kez calistir.
10. Bundan sonra yeni sahibinden e-postalari Telegram'a duser.

### Neden bunu oneriyorum

Sahibinden yardim iceriklerinde `Favori Aramalarim` ile uygun ilan geldiginde e-posta ve mobil bildirim alinabildigi yaziyor. Bu resmi yontem, GitHub veya baska bulut IP'lerinin bot dogrulamasina takilmasindan daha guvenilir.

---

## ⚙️ CI Maliyet Optimizasyonu & Incremental Scraping

Bu repo GitHub Actions dakikalarini asagidaki onlemlerle korur:

- **Tek keepalive:** Cift calisan keepalive workflow'larindan WARP+camoufox geoip yuzunden her gun `InvalidIP` ile cokeni kaldirildi. `sahibinden_keepalive.yml` (proxysiz camoufox) kalir. `camoufox-server.py` artik `geoip`'i yalnizca `CAMOUFOX_GEOIP=true` iken dener.
- **Devre kesici:** `MAX_CONSECUTIVE_FAILED_SEGMENTS` (varsayilan 3) ust uste sonuc donmeyen segment olunca kosuyu erken bitirir. WARP/Cloudflare blogunda 30+ dk bosa hammer yapan durum ortadan kalkti. Scraper job timeout'lari 120 → 30 dk.
- **5-dk cron kaldirildi:** `telegram-sahibinden-shot.yml` artik yalnizca manuel (`workflow_dispatch`).

### Incremental scraping (opsiyonel — varsayilan KAPALI)

Ayni ~10.000 ilani her kosuda bastan cekmemek icin `INCREMENTAL_SCRAPE` ozelligi eklendi.

**Acmak icin:** repo'da `Settings → Secrets and variables → Actions → Variables` altinda `INCREMENTAL_SCRAPE = true` ekleyin.

Acikken:
- Gorulen ilan ID'leri `state/seen-<urun>.json` icinde tutulur ve Actions cache ile kosular arasi tasinir.
- `date_desc` siralamada bir segmentin sayfasi tamamen gorulmus ilanlardan olusunca o segmentte derine inmek birakilir (sayfa/sure/CI tasarrufu).
- Yalnizca yeni ilanlar (`is_new`) islenir ve raporlanir.

Ilgili env degiskenleri: `SEEN_STATE_DIR`, `SEEN_TTL_DAYS` (45), `SEEN_MAX_ENTRIES` (80000), `SEEN_STOP_PAGES` (1).

> Not: Acmadan once cikti tuketen tarafin (or. gpupusula.shop) "delta/yeni-ilan" akisini destekledigini dogrulayin; ozellik tam veri yerine yalnizca yeni ilanlari ureten bir moda gecirir.
