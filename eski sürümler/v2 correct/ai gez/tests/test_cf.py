from seleniumbase import Driver
import time
url = "https://www.sahibinden.com/ekran-karti-masaustu"
print("Testing uc=True, headless=True on Sahibinden...")
try:
    d = Driver(uc=True, headless=True)
    d.get(url)
    time.sleep(5)
    src = d.page_source.lower()
    if "just a moment" in src or "cf-chl" in src:
        print("BLOCKED BY CLOUDFLARE IN HEADLESS=True")
    else:
        print("PASSED IN HEADLESS=True")
    d.quit()
except Exception as e:
    print(e)

print("Testing uc=True, headless2=True on Sahibinden...")
try:
    d = Driver(uc=True, headless2=True)
    d.get(url)
    time.sleep(5)
    src = d.page_source.lower()
    if "just a moment" in src or "cf-chl" in src:
        print("BLOCKED BY CLOUDFLARE IN HEADLESS2=True")
    else:
        print("PASSED IN HEADLESS2=True")
    d.quit()
except Exception as e:
    print(e)
