import time
from seleniumbase import SB

url = "https://www.sahibinden.com/ekran-karti-masaustu"

def test_cf():
    # Test in headless mode (headless=True usually fails CF, but uc=True + headless=True can sometimes pass, 
    # though on Linux it usually requires Xvfb - we are on Windows now so let's test pure headless)
    print("Testing uc=True headless=True on Windows...")
    try:
        with SB(uc=True, headless=True) as sb:
            sb.open(url)
            print("Opened URL.")
            # wait a bit for CF to process
            time.sleep(5)
            
            # Check if we are blocked
            source = sb.get_page_source()
            if "just a moment" in source.lower() or "cf-chl" in source.lower():
                print("STILL BLOCKED BY CLOUDFLARE in headless mode.")
            else:
                print("SUCCESSFULLY BYPASSED CLOUDFLARE in headless mode!")
                
            print("Title:", sb.get_title())
            
            # Get cookies
            cookies = sb.driver.get_cookies()
            print("Cookies count:", len(cookies))
            has_cf = any(c['name'] == 'cf_clearance' for c in cookies)
            print("Has cf_clearance:", has_cf)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    test_cf()
