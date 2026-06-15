"""Start Camoufox WebSocket server and print the WS endpoint URL."""

import os, sys, time, socket, json, threading
from camoufox.utils import launch_options
from camoufox.server import launch_server

headless = True
proxy_url = os.environ.get("CAMOUFOX_PROXY", "").strip()
geoport = os.environ.get("CAMOUFOX_GEOPORT", "").strip()

kwargs = {
    "headless": headless,
    "locale": "tr-TR",
    "window": (1920, 1080),
    "humanize": True,
    "disable_coop": True,
    "i_know_what_im_doing": True,
    "port": 40100,
}

if proxy_url:
    kwargs["proxy"] = {"server": proxy_url}
    kwargs["geoip"] = True

if geoport:
    kwargs["geo_port"] = int(geoport)

try:
    # Launch server in background thread
    ws_url = [None]

    def _start():
        result = launch_server(**kwargs)
        ws_url[0] = result

    t = threading.Thread(target=_start, daemon=True)
    t.start()

    # Wait for WS endpoint (output from launch_server)
    time.sleep(5)

    for _ in range(30):
        if ws_url[0]:
            break
        time.sleep(1)

    if ws_url[0]:
        print(f"WS_ENDPOINT={ws_url[0]}")
        sys.stdout.flush()
        # Keep running
        while t.is_alive():
            time.sleep(1)
    else:
        print("ERROR: Could not get WebSocket endpoint", file=sys.stderr)
        sys.exit(1)

except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
