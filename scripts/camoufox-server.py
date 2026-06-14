"""Camoufox WebSocket server using Playwright Python directly.

Launches Camoufox/Firefox via Playwright's firefox.launch with full
fingerprint config from Camoufox, then prints the WebSocket endpoint
URL so Node.js can connect to it.
"""
import os, sys, json, base64, time, signal, atexit
from pathlib import Path

from camoufox.utils import launch_options
from camoufox.server import to_camel_case_dict
from playwright.sync_api import sync_playwright

headless = os.environ.get('CAMOUFOX_HEADLESS', 'false').lower() == 'true'
proxy_url = os.environ.get('CAMOUFOX_PROXY', '').strip()

kwargs = {
    'headless': headless,
    'locale': 'tr-TR',
    'window': (1920, 1080),
    'humanize': True,
    'disable_coop': True,
    'i_know_what_im_doing': True,
}

if proxy_url:
    kwargs['proxy'] = {'server': proxy_url}
    kwargs['geoip'] = True

config = launch_options(**kwargs)
if config.get('proxy') is None:
    del config['proxy']

browser = None
pw = None

def cleanup():
    global browser, pw
    if browser:
        try: browser.close()
        except: pass
    if pw:
        try: pw.stop()
        except: pass

atexit.register(cleanup)
signal.signal(signal.SIGTERM, lambda *_: cleanup())

try:
    pw = sync_playwright().start()
    # Launch with Camoufox binary path
    camoufox_bin = os.environ.get('CAMOUFOX_BIN', '')
    if camoufox_bin:
        config['executable_path'] = camoufox_bin
    browser = pw.firefox.launch(**config)
    # Get the WebSocket endpoint from the browser's connect options
    ws_endpoint = browser._channel._channel._transport._ws_endpoint
    print(f"Websocket endpoint: {ws_endpoint}")
    sys.stdout.flush()
    # Keep running until interrupted
    while True:
        time.sleep(10)
except KeyboardInterrupt:
    pass
finally:
    cleanup()
