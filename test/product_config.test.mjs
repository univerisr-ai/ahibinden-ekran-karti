import test from 'node:test';
import assert from 'node:assert/strict';

async function loadConfig(caseName, env = {}) {
  const previous = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  try {
    return await import(`../src/config.mjs?case=${caseName}-${Date.now()}`);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('defaults to the existing GPU Sahibinden category profile', async () => {
  const config = await loadConfig('default-gpu', {
    SAHIBINDEN_PRODUCT_TYPE: undefined,
    PRODUCT_TYPE: undefined,
    SAHIBINDEN_BASE_URL: undefined,
  });

  assert.equal(config.PRODUCT_TYPE, 'gpu');
  assert.equal(config.PRODUCT_LABEL, 'Ekran Karti');
  assert.equal(config.BASE_URL, 'https://www.sahibinden.com/ekran-karti-masaustu');
  assert.ok(config.PRICE_SEGMENTS.length >= 16);
});

test('supports an isolated CPU Sahibinden category profile', async () => {
  const config = await loadConfig('cpu-profile', {
    SAHIBINDEN_PRODUCT_TYPE: 'cpu',
    PRODUCT_TYPE: undefined,
    SAHIBINDEN_BASE_URL: undefined,
  });

  assert.equal(config.PRODUCT_TYPE, 'cpu');
  assert.equal(config.PRODUCT_LABEL, 'Islemci');
  assert.equal(config.BASE_URL, 'https://www.sahibinden.com/islemci-masaustu');
  assert.deepEqual(config.PRICE_SEGMENTS[0], [0, 500]);
  assert.ok(config.PRICE_SEGMENTS.some(([min, max]) => min === 14000 && max === 18000));
});

test('allows explicit category URL override without changing the selected product label', async () => {
  const config = await loadConfig('cpu-override', {
    SAHIBINDEN_PRODUCT_TYPE: 'cpu',
    PRODUCT_TYPE: undefined,
    SAHIBINDEN_BASE_URL: 'https://www.sahibinden.com/en/processors-desktops',
  });

  assert.equal(config.PRODUCT_TYPE, 'cpu');
  assert.equal(config.PRODUCT_LABEL, 'Islemci');
  assert.equal(config.BASE_URL, 'https://www.sahibinden.com/en/processors-desktops');
});
