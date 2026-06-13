"""Camoufox Playwright WebSocket server.
Monkey-patches launch_server to add bypass:* when no proxy is needed.
"""
import os
import camoufox.server

headless = os.environ.get('CAMOUFOX_HEADLESS', 'true').lower() == 'true'

_original_launch_server = camoufox.server.launch_server

def _patched_launch_server(headless=False, proxy=None, **kwargs):
    if proxy is None or proxy == {}:
        proxy = {"server": "http://127.0.0.1:0", "bypass": "*"}
    return _original_launch_server(headless=headless, proxy=proxy, **kwargs)

camoufox.server.launch_server = _patched_launch_server

camoufox.server.launch_server(headless=headless)
