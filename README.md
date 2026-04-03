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
- `TELEGRAM_USER_ID`

`TELEGRAM_CHAT_ID` eski ad olarak desteklenir, ama yeni kurulumda `TELEGRAM_USER_ID` kullanmak daha dogrudur.

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
