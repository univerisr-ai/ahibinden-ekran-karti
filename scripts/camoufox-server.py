"""Camoufox Playwright WebSocket server with proxy stripped.
Uses a custom launchServer.js that discards proxy before Playwright sees it.
"""
import os, subprocess, base64, orjson
from pathlib import Path
from camoufox.utils import launch_options
from camoufox.server import to_camel_case_dict, get_nodejs

headless = os.environ.get('CAMOUFOX_HEADLESS', 'true').lower() == 'true'

# Generate config via Camoufox (includes fingerprint generation etc.)
config = launch_options(headless=headless)
config.pop('proxy', None)

# Use our custom launchServer.js (ships in the repo)
launch_script = Path(__file__).parent / 'custom-launchServer.cjs'

nodejs = get_nodejs()
data = orjson.dumps(to_camel_case_dict(config))
process = subprocess.Popen(
    [nodejs, str(launch_script)],
    cwd=Path(nodejs).parent / "package",
    stdin=subprocess.PIPE, text=True,
)
if process.stdin:
    process.stdin.write(base64.b64encode(data).decode())
    process.stdin.close()
process.wait()
raise RuntimeError("Server process terminated unexpectedly")
