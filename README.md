# GitHub'da sahibinden ekran karti yonlendirme ve duzenli ziyaret

Bu proje iki parca halinde calisir:

1. GitHub Pages icin tek sayfalik yonlendirme sitesi
2. GitHub Actions ile duzenli araliklarda sadece ilgili sayfaya istek atan workflow

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
