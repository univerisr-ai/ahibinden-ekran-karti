import sys
import json
from curl_cffi import requests

def fetch_page(target_url, proxy_url):
    proxies = None
    if proxy_url and proxy_url.strip() != "None":
        proxies = {
            "http": proxy_url,
            "https": proxy_url
        }

    headers = {
         "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
         "accept-language": "tr,tr-TR;q=0.9,en-US;q=0.8,en;q=0.7",
         "sec-ch-ua": "\"Google Chrome\";v=\"121\", \"Not A(Brand\";v=\"8\", \"Chromium\";v=\"121\"",
         "sec-ch-ua-mobile": "?0",
         "sec-ch-ua-platform": "\"Windows\"",
         "sec-fetch-dest": "document",
         "sec-fetch-mode": "navigate",
         "sec-fetch-site": "none",
         "sec-fetch-user": "?1",
         "upgrade-insecure-requests": "1"
    }

    try:
        resp = requests.get(
            target_url,
            headers=headers,
            impersonate="chrome120", # Using chrome120 to match standard modern chrome
            proxies=proxies,
            timeout=45
        )
        
        payload = {
            "status": resp.status_code,
            "html": resp.text
        }
        
    except Exception as e:
        payload = {
            "status": 0,
            "error": str(e),
            "html": ""
        }
        
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stdout.write(json.dumps({"status": 0, "error": "Missing arguments"}))
        sys.exit(1)
        
    target_url = sys.argv[1]
    proxy_url = sys.argv[2] if len(sys.argv) > 2 else None
    
    fetch_page(target_url, proxy_url)
