"""Camoufox Playwright WebSocket server.
Launches a remote browser server that Node.js/Playwright connects to.
"""
import os
from camoufox.server import launch_server

headless = os.environ.get('CAMOUFOX_HEADLESS', 'true').lower() == 'true'

launch_server(headless=headless)