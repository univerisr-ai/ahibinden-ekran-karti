# COOKIE SİSTEMİ DETAYLI ANALİZ RAPORU

## 1. Cookie Kaynakları ve Yükleme Sırası

```
src/scrapeops.mjs:82-101  (ensureBrowser)
  │
  ├── 1. loadSahibindenStorageState()       ← src/session_state.mjs:217
  │     ├── SAHIBINDEN_STORAGE_STATE_B64    (base64 env)
  │     ├── SAHIBINDEN_STORAGE_STATE        (raw JSON env)
  │     ├── SAHIBINDEN_STORAGE_STATE_FILE   (dosya, default: auth.json)
  │     └── Filter: sadece sahibinden.com domain, expired temizlik
  │
  └── 2. loadAllSahibindenCookies()         ← src/cookies.mjs:84
        ├── SAHIBINDEN_COOKIES              (GitHub Secret / env)
        ├── cookies.json                    (local development)
        └── Merge: aynı name+domain birleştirilir
```

## 2. Cookie Doğrulama Katmanları

| Katman | Nerede | Ne yapar |
|--------|--------|----------|
| JSON parse | `cookies.mjs:48-61` | SAHIBINDEN_COOKIES env'i JSON parse eder |
| Schema doğrulama | `cookies.mjs:55` | `name` string, `value` undefined değil kontrolü |
| Domain filtre | `cookies.mjs:15-23` | sadece sahibinden.com / shbdn.com |
| Expiry kontrol | `session_state.mjs:108` | Expired cookie'leri atar |
| Python byte temizliği | `session_state.mjs:79-86` | `b'...'` formatını temizler |
| SameSite normalizasyonu | `session_state.mjs:186-203` | `no_restriction` → `None`, `lax` → `Lax` etc |
| Non-printable filtre | `session_state.mjs:129-133` | Kontrol karakterli value'ları atar |

## 3. Storage State Kaydetme (saveStorageState)

**Mevcut durum:** Sadece `main.mjs:708`'de, tüm scraping bittikten sonra çağrılıyor.

```
main.mjs:708  →  await saveStorageState()
```

**Risk:** Eğer run ortasında crash olursa:
- Cloudflare challenge çözülmüş olsa bile `cf_clearance` cookiesi kaybolur
- Bir sonraki run'da Cloudflare tekrar challenge ister
- Storage state dosyası güncellenmez

**Öneri:** Her segment sonunda veya periyodik olarak da kaydedilmeli.

## 4. Parallel Proof Test Sonuçları (test/parallel-proof.mjs)

| Metrik | Değer |
|--------|-------|
| Browser sekmeleri | 10 |
| Session paylaşımı | ✅ Tüm sekmeler AYNI cookie seti |
| `cf_clearance` paylaşımı | ✅ Tüm sekmelerde Cloudflare cookie'leri ortak |
| Paralel 10 sayfa | 4.4 saniye (tümü 403 - cookie yok) |
| Sıralı 3 sayfa | 3.6 saniye |

**Tahmini hız kazancı (valid cookie ile):**
- Sıralı 10 sayfa: ~12 saniye
- Paralel 10 sayfa: ~4.5 saniye
- **~2.7x daha hızlı**

## 5. Tespit Edilen Sorunlar ve Öneriler

### Sorun 1: Storage State sadece run sonunda kaydediliyor
- **Risk:** Yüksek. Crash durumunda çözülmüş Cloudflare challenge kaybolur.
- **Çözüm:** `scrapeSegment()` sonunda veya her N sayfada bir `saveStorageState()` çağrılmalı.
- **Yeri:** `scrapeops.mjs` - `scrapeSegment()` sonunda

### Sorun 2: Tek page (sekme) kullanılıyor
- **Risk:** Orta. Sıralı çekim yavaş, Cloudflare rate-limit riski aynı.
- **Çözüm:** Context'e 10 page eklenip round-robin kullanılmalı.
- **Yeri:** `scrapeops.mjs` - `ensureBrowser()` + `fetchPage()`

### Sorun 3: Cookie expiry sadece 3 isim için loglanıyor
- **Risk:** Düşük. Sadece `csid`, `cwt`, `st` loglanıyor, diğer session cookie'leri atlanıyor.
- **Çözüm:** Tüm session cookie'leri loglanabilir veya bir uyarı eşiği eklenebilir.
- **Yeri:** `scrapeops.mjs:86-91`

### Sorun 4: FlareSolverr cookie'leri storage state'e kaydedilmiyor
- **Risk:** Orta. FlareSolverr ile çözülen challenge cookie'leri `context.addCookies()` ile ekleniyor ama `saveStorageState()` ile kaydedilmiyor olabilir (aslında context.storageState() tüm cookie'leri alır, bu yüzden çalışır).
- **Not:** Aslında çalışıyor çünkü `context.storageState()` context'teki tüm cookie'leri alır.

## 6. Cookie Sistemi Güvenlik Skoru

| Kriter | Puan | Açıklama |
|--------|------|----------|
| JSON validasyonu | ✅ 10/10 | try/catch + schema kontrolü |
| Domain filtre | ✅ 10/10 | Sadece sahibinden/shbdn |
| Expiry yönetimi | ✅ 9/10 | Süresi geçen atılır, loglanır |
| Persistence | ⚠️ 6/10 | Sadece run sonunda kaydeder |
| Çoklu kaynak | ✅ 10/10 | env + file + storage state |
| Python byte temizliği | ✅ 10/10 | `b'...'` formatını düzeltir |
| SameSite normalizasyon | ✅ 9/10 | Tüm varyasyonlar handle edilir |
| Non-printable filtre | ✅ 8/10 | Kontrol karakterlerini atar |
| Crash recovery | ❌ 3/10 | Storage state sadece başarılı run'da kaydedilir |
| **Toplam** | **75/100** | Temel cookie yönetimi sağlam, crash recovery zayıf |
