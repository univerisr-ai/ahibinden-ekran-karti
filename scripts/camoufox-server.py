"""Camoufox Playwright WebSocket server with WARP proxy support.
"""
import os
from camoufox.server import launch_server

headless = os.environ.get('CAMOUFOX_HEADLESS', 'false').lower() == 'true'
proxy_url = os.environ.get('CAMOUFOX_PROXY', '').strip()

kwargs = {
    'headless': headless,
    'locale': 'tr-TR',
    'window': (1920, 1080),
    'humanize': True,
    'disable_coop': True,
}

if proxy_url:
    kwargs['proxy'] = {'server': proxy_url}
    kwargs['geoip'] = True

launch_server(**kwargs)
