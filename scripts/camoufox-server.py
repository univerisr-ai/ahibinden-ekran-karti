"""Camoufox Playwright server with proxy support.
Uses Playwright's Firefox binary by default (no Camoufox custom build needed).
Set CAMOUFOX_BROWSER_PATH to override.
"""
import os, sys, json
from camoufox.server import launch_server

headless = os.environ.get('CAMOUFOX_HEADLESS', 'true').lower() == 'true'
proxy_url = os.environ.get('CAMOUFOX_PROXY', '').strip()
browser_path = os.environ.get('CAMOUFOX_BROWSER_PATH', '').strip()

# Proxy ayari bossa veya "false"/"none" ise proxy kullanma
use_proxy = proxy_url and proxy_url.lower() not in ('false', 'none', '0', 'no')

kwargs = {
    'headless': headless,
    'locale': 'tr-TR',
    'humanize': True,
    'disable_coop': True,
    'i_know_what_im_doing': True,
}

if browser_path:
    kwargs['executable_path'] = browser_path

if use_proxy:
    kwargs['proxy'] = {'server': proxy_url}
    kwargs['geoip'] = True
else:
    # Bos dict = "proxy yok" - None gecersek Camoufox patliyor
    kwargs['proxy'] = {}

launch_server(**kwargs)