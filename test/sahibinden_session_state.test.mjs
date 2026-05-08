import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_STATE_B64_ENV_VAR,
  STORAGE_STATE_ENV_VAR,
  filterSahibindenStorageState,
  loadSahibindenStorageState,
} from '../src/session_state.mjs';

test('keeps only sahibinden cookies and origins from a Playwright storage state', () => {
  const result = filterSahibindenStorageState(
    {
      cookies: [
        {
          name: 'sid',
          value: 'active',
          domain: '.sahibinden.com',
          path: '/',
          expires: 2000,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
        {
          name: 'expired',
          value: 'old',
          domain: '.sahibinden.com',
          path: '/',
          expires: 999,
        },
        {
          name: 'external',
          value: 'private',
          domain: '.example.com',
          path: '/',
          expires: 2000,
        },
      ],
      origins: [
        {
          origin: 'https://www.sahibinden.com',
          localStorage: [{ name: 'searchPrefs', value: 'gpu' }],
        },
        {
          origin: 'https://accounts.example.com',
          localStorage: [{ name: 'token', value: 'private' }],
        },
      ],
    },
    { nowSec: 1000 },
  );

  assert.equal(result.inputCookieCount, 3);
  assert.equal(result.cookieCount, 1);
  assert.equal(result.droppedExpired, 1);
  assert.equal(result.droppedUnrelated, 1);
  assert.deepEqual(
    result.storageState.cookies.map((cookie) => cookie.name),
    ['sid'],
  );
  assert.deepEqual(result.storageState.origins, [
    {
      origin: 'https://www.sahibinden.com',
      localStorage: [{ name: 'searchPrefs', value: 'gpu' }],
    },
  ]);
});

test('loads base64 GitHub secret storage state before raw env or local file', () => {
  const b64State = JSON.stringify({
    cookies: [
      {
        name: 'sid',
        value: 'from-b64',
        domain: '.sahibinden.com',
        path: '/',
        expires: -1,
      },
    ],
    origins: [],
  });
  const rawState = JSON.stringify({
    cookies: [
      {
        name: 'sid',
        value: 'from-raw',
        domain: '.sahibinden.com',
        path: '/',
        expires: -1,
      },
    ],
    origins: [],
  });

  const result = loadSahibindenStorageState({
    env: {
      [STORAGE_STATE_B64_ENV_VAR]: Buffer.from(b64State, 'utf8').toString('base64'),
      [STORAGE_STATE_ENV_VAR]: rawState,
      SAHIBINDEN_STORAGE_STATE_FILE: 'auth.json',
    },
    existsSync: () => true,
    readFileSync: () =>
      JSON.stringify({
        cookies: [
          {
            name: 'sid',
            value: 'from-file',
            domain: '.sahibinden.com',
            path: '/',
            expires: -1,
          },
        ],
        origins: [],
      }),
    nowSec: 1000,
  });

  assert.equal(result.source, 'env-b64');
  assert.equal(result.cookieCount, 1);
  assert.equal(result.storageState.cookies[0].value, 'from-b64');
});

test('rejects malformed storage state cookies', () => {
  assert.throws(
    () => filterSahibindenStorageState({ cookies: 'not-array', origins: [] }),
    /cookies array olmali/,
  );
});
