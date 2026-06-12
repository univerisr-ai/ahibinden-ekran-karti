"""Camoufox Playwright server with proxy support."""
import os, sys, json
from camoufox.server import launch_server

headless = os.environ.get('CAMOUFOX_HEADLESS', 'true').lower() == 'true'
proxy_url = os.environ.get('CAMOUFOX_PROXY', '').strip()

kwargs = {
    'headless': headless,
    'locale': 'tr-TR',
    'humanize': True,
    'disable_coop': True,
}

if proxy_url:
    kwargs['proxy'] = {'server': proxy_url}

launch_server(**kwargs)
