"""Camoufox Playwright WebSocket server.
Launches a remote browser server that Node.js/Playwright connects to.
"""
import os
from camoufox.server import launch_server

headless = os.environ.get('CAMOUFOX_HEADLESS', 'true').lower() == 'true'

# Playwright proxy validation'unu gecmek icin dummy proxy,
# Firefox tarafinda network.proxy.type=0 ile proxy tamamen devre disi
launch_server(
    headless=headless,
    proxy={"server": "http://0.0.0.0:0"},
    firefox_user_prefs={"network.proxy.type": 0},
)