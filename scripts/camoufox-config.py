"""Output Camoufox launch config as JSON for Node.js to consume."""
import os, json, sys
from camoufox.utils import launch_options

headless = os.environ.get('CAMOUFOX_HEADLESS', 'true').lower() == 'true'
proxy_url = os.environ.get('CAMOUFOX_PROXY', '').strip()

kwargs = {
    'headless': headless,
    'locale': 'tr-TR',
    'window': (1920, 1080),
    'humanize': True,
    'disable_coop': True,
    'i_know_what_im_doing': True,
}

if proxy_url:
    kwargs['proxy'] = {'server': proxy_url}
    kwargs['geoip'] = True

config = launch_options(**kwargs)
# Serialise env vars (CAMOU_CONFIG_1 etc.) as plain dict
if 'env' in config and isinstance(config['env'], dict):
    config['env'] = {k: str(v) for k, v in config['env'].items()}
# Convert tuple window → list for JSON
if 'window' in config:
    config['window'] = list(config['window'])
# Remove None values
config = {k: v for k, v in config.items() if v is not None}

json.dump(config, sys.stdout, indent=2)
print()
