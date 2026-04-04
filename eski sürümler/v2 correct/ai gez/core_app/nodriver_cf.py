import asyncio
import nodriver as uc
from curl_cffi import requests

async def get_clearance_cookies(url):
    print("[*] 1. Aşama: nodriver ile Chrome başlatılıyor...")
    # nodriver ile tarayıcıyı başlat. Arka planda gizlenmiş (undetected) bir tarayıcı açar.
    # headless=False ile açılması, Cloudflare'in fare hareketlerini veya cihaz donanımını 
    # daha kolay doğrulamasına (Human-in-the-Loop) olanak tanır.
    browser = await uc.start()
    
    print(f"[*] {url} adresine gidiliyor...")
    page = await browser.get(url)
    
    print("[*] Cloudflare kontrolü bekleniyor...")
    # İhtiyaç halinde manuel olarak CF kutusuna tıklama süresi (Yarı otomatik / Human-in-the-loop)
    for i in range(30):
        content = await page.get_content()
        if "just a moment" not in content.lower() and "challenge-platform" not in content.lower():
            print("[+] Cloudflare başarıyla geçildi!")
            break
        await asyncio.sleep(2)
        if i % 5 == 0 and i > 0:
            print(f"  ... {i} saniye geçti, bekleniyor. Ekranda kutucuk varsa tıklayın.")
    else:
        print("[-] Cloudflare bekleme süresi doldu...")
    
    # Çerezlerin tarayıcıya tam oturması için kısa bir bekleme
    await asyncio.sleep(4)
    
    print("[*] Çerezler (Cookies) ve User-Agent alınıyor...")
    cookies_list = await browser.cookies.get_all()
    cookie_dict = {cookie.name: cookie.value for cookie in cookies_list}
    
    # Tarayıcının mevcut User-Agent değerini javascript üzerinden alıyoruz
    ua = await page.evaluate("navigator.userAgent")
    
    # Tarayıcıyı kapatıyoruz, artık Python üzerinden (curl_cffi ile) devam edeceğiz.
    print("[*] Tarayıcı kapatılıyor...")
    browser.stop()
    
    return cookie_dict, ua

def fetch_with_curl_cffi(url, cookies, user_agent):
    print("\n[*] 2. Aşama: curl_cffi ile İstek Atılıyor (TLS Impersonation)...")
    
    # nodriver'dan aldığımız tarayıcı uyumlu User-Agent başlığını kullanıyoruz
    headers = {
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1"
    }

    # TLS Parmak İzi Uyumu (TLS Fingerprinting): 
    # curl_cffi, "impersonate" parametresi sayesinde request'in TLS el sıkışmasını (JA3/JA4)
    # gerçek bir Chrome gibi yapar. Burada 'chrome120' veya 'chrome124' kullanabilirsiniz.
    try:
        response = requests.get(
            url,
            cookies=cookies,
            headers=headers,
            impersonate="chrome124", 
            timeout=15
        )
        
        print(f"[+] HTTP Durum Kodu: {response.status_code}")
        if response.status_code == 200:
            print(f"[+] Başarılı! Sayfa boyutu: {len(response.text)} bayt.")
            # Örnek olarak sayfanın başlığını (title) ekrana yazdıralım
            if "<title>" in response.text:
                title = response.text.split("<title>")[1].split("</title>")[0]
                print(f"[+] Sayfa Başlığı: {title.strip()}")
        else:
            print("[-] İstek reddedildi. CF koruması devam ediyor olabilir.")
    
    except Exception as e:
        print(f"[-] curl_cffi Hatası: {e}")

async def main():
    target_url = "https://www.sahibinden.com/ekran-karti-masaustu"
    
    # Nodriver ile çerezleri çek
    cookies, ua = await get_clearance_cookies(target_url)
    
    if not cookies:
        print("[-] Çerez alınamadı. Çıkış yapılıyor.")
        return
        
    print(f"[+] Toplam çerez sayısı: {len(cookies)}")
    print(f"[+] Kullanılan User-Agent: {ua}")
    
    if "cf_clearance" in cookies:
        print("[+] 'cf_clearance' çerezi başarıyla alındı!")
    else:
        print("[-] UYARI: 'cf_clearance' çerezi görünmüyor. Eğer siteye engel koyulmuşsa giriş yapılamayabilir.")
        
    # Alınan çerezler ve User-Agent ile requests (curl_cffi) kullanarak veri çekimi yap
    fetch_with_curl_cffi(target_url, cookies, ua)

if __name__ == "__main__":
    asyncio.run(main())
