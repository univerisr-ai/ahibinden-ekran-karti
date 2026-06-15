"""Output Camoufox launch config as JSON for Node.js to consume."""

import os, json, sys
from camoufox.utils import launch_options

headless = os.environ.get("CAMOUFOX_HEADLESS", "true").lower() == "true"
proxy_url = os.environ.get("CAMOUFOX_PROXY", "").strip()

kwargs = {
    "headless": headless,
    "locale": "tr-TR",
    "window": (1920, 1080),
    "humanize": True,
    "disable_coop": True,
    "i_know_what_im_doing": True,
}

if proxy_url:
    kwargs["proxy"] = {"server": proxy_url}
    kwargs["geoip"] = True

try:
    config = launch_options(**kwargs)
except Exception:
    if "geoip" in kwargs:
        del kwargs["geoip"]
        try:
            config = launch_options(**kwargs)
        except Exception as e:
            print(f"Config generation failed: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        raise
# Only keep Camoufox-specific env vars, not entire inherited env
CAMOUFOX_ENV_KEYS = {
    "CAMOU_CONFIG_1",
    "CAMOU_CONFIG_2",
    "FONTCONFIG_PATH",
    "CAMOUFOX_PROXY",
    "CAMOUFOX_HEADLESS",
}
if "env" in config and isinstance(config["env"], dict):
    config["env"] = {
        k: str(v) for k, v in config["env"].items() if k in CAMOUFOX_ENV_KEYS
    }
    if not config["env"]:
        del config["env"]
# Convert tuple window → list for JSON
if "window" in config:
    config["window"] = list(config["window"])
# Remove None values
config = {k: v for k, v in config.items() if v is not None}

json.dump(config, sys.stdout, indent=2)
print()
