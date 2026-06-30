"""Camoufox Playwright WebSocket server with WARP/proxy support.

This wrapper replicates camoufox.server.launch_server but removes a null
`proxy` key before sending the config to Camoufox. Firefox/Camoufox rejects
`proxy: null` with "expected object, got null".
"""
import os
import base64
import subprocess
from pathlib import Path

import orjson
from playwright._impl._driver import compute_driver_executable

from camoufox.utils import launch_options
from camoufox.server import to_camel_case_dict
from camoufox.pkgman import LOCAL_DATA

LAUNCH_SCRIPT: Path = LOCAL_DATA / "launchServer.js"


def get_nodejs() -> str:
    """Get the bundled Node.js executable (handles old & new Playwright APIs)."""
    _nodejs = compute_driver_executable()[0]
    if isinstance(_nodejs, tuple):
        return _nodejs[0]
    return _nodejs


headless = os.environ.get('CAMOUFOX_HEADLESS', 'false').lower() == 'true'
proxy_url = os.environ.get('CAMOUFOX_PROXY', '').strip()
fingerprint_json = os.environ.get('CAMOUFOX_FINGERPRINT', '').strip()

kwargs = {
    'headless': headless,
    'locale': 'tr-TR',
    'window': (1920, 1080),
    'humanize': True,
    'disable_coop': True,
    'i_know_what_im_doing': True,
}

if fingerprint_json:
    import json
    kwargs['fingerprint'] = json.loads(fingerprint_json)

if proxy_url:
    kwargs['proxy'] = {'server': proxy_url}
    # geoip, proxy IP'sinin cografi konumunu bir IP servisinden cozmeye calisir.
    # GitHub runner'larinda proxy gercekte baglanmadiginda bu "InvalidIP: Failed to
    # get IP address" ile TUM kosuyu cokertiyordu. Artik opt-in (CAMOUFOX_GEOIP=true).
    if os.environ.get('CAMOUFOX_GEOIP', 'false').strip().lower() == 'true':
        kwargs['geoip'] = True

try:
    config = launch_options(**kwargs)
    # Camoufox/Playwright firefox.launch rejects proxy: null.
    if config.get('proxy') is None:
        del config['proxy']

    nodejs = get_nodejs()
    data = orjson.dumps(to_camel_case_dict(config))

    process = subprocess.Popen(
        [nodejs, str(LAUNCH_SCRIPT)],
        cwd=Path(nodejs).parent / "package",
        stdin=subprocess.PIPE,
        text=True,
    )
    if process.stdin:
        process.stdin.write(base64.b64encode(data).decode())
        process.stdin.close()

    print("Launching server...")
    process.wait()
    raise RuntimeError("Server process terminated unexpectedly")
except Exception as e:
    print(f"Server error: {e}")
    raise
