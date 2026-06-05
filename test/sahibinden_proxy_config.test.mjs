import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlaywrightProxyFromUrl,
  resolveSahibindenProxyConfig,
} from '../src/scrapeops.mjs';

test('parses proxy URLs with credentials for Playwright', () => {
  assert.deepEqual(
    buildPlaywrightProxyFromUrl('http://user:pa%24s@proxy.example.com:8080'),
    {
      server: 'http://proxy.example.com:8080',
      username: 'user',
      password: 'pa$s',
    },
  );
});

test('uses Sahibinden proxy before Dolap fallback', () => {
  assert.deepEqual(
    resolveSahibindenProxyConfig({
      SAHIBINDEN_PROXY_SERVER: 'socks5://127.0.0.1:40000',
      DOLAP_PROXY_SERVER: 'http://proxy.example.com:8080',
    }),
    {
      source: 'SAHIBINDEN_PROXY_SERVER',
      server: 'socks5://127.0.0.1:40000',
    },
  );
});

test('accepts Dolap proxy variable as a fallback for Sahibinden', () => {
  assert.deepEqual(
    resolveSahibindenProxyConfig({
      DOLAP_PROXY_SERVER: 'http://proxy.example.com:8080',
    }),
    {
      source: 'DOLAP_PROXY_SERVER',
      server: 'http://proxy.example.com:8080',
    },
  );
});

test('returns null when no explicit scraper proxy is configured', () => {
  assert.equal(resolveSahibindenProxyConfig({}), null);
});
