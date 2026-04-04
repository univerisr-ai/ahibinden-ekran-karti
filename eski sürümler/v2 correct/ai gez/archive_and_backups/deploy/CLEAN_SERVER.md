# Clean Server Layout

Amac: sunucuda sadece calisma icin gereken dosyalar kalsin, deneme/test dosyalari ayrilsin.

## Tutulacak dosyalar
- `deploy/clean-runtime-files.txt` icindeki dosyalar

## Silinecek eski dosyalar
- `deploy/legacy-files-to-remove.txt` icindeki dosyalar

## Onerilen dizin
- `/opt/ai-gez` : aktif runtime dosyalari
- `/opt/ai-gez/logs` : loglar
- `/opt/ai-gez/archive` : gerekiyorsa eski test dosyalari

## Temiz kurulum akisi
1. Runtime dosyalarini `/opt/ai-gez` altina kopyala.
2. `.env` dosyasini kontrol et.
3. `server_preflight.py` ile servis onkontrolu yap.
4. systemd servislerini guncelle.
5. Eski test dosyalarini sil veya `archive/` altina tasi.
