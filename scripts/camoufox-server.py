"""Camoufox Playwright server with proxy support.
Uses Playwright's Firefox binary by default (no Camoufox custom build needed).
Set CAMOUFOX_BROWSER_PATH to override.
"""
import os, sys, json
from camoufox.server import launch_server

headless = os.environ.get('CAMOUFOX_HEADLESS', 'true').lower() == 'true'
proxy_url = os.environ.get('CAMOUFOX_PROXY', '').strip()
browser_path = os.environ.get('CAMOUFOX_BROWSER_PATH', '').strip()

kwargs = {
    'headless': headless,
    'locale': 'tr-TR',
    'humanize': True,
    'disable_coop': True,
    'i_know_what_im_doing': True,
}

if browser_path:
    kwargs['executable_path'] = browser_path

if proxy_url:
    kwargs['proxy'] = {'server': proxy_url}
    kwargs['geoip'] = True

launch_server(**kwargs)