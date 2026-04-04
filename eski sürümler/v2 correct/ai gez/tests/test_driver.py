from seleniumbase import Driver
try:
    d = Driver(uc=True, headless=True)
    d.get("https://example.com")
    cookies = d.get_cookies()
    src = d.page_source
    ua = d.execute_script("return navigator.userAgent;")
    import time
    time.sleep(1)
    d.quit()
    print("SUCCESS")
except Exception as e:
    print(f"FAILED: {e}")
