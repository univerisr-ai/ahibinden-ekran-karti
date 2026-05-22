import test from 'node:test';
import assert from 'node:assert/strict';

import { PRICE_SEGMENTS } from '../src/config.mjs';

test('uses granular contiguous Sahibinden price segments for dense GPU ranges', () => {
  assert.ok(PRICE_SEGMENTS.length >= 16);
  assert.deepEqual(PRICE_SEGMENTS.slice(0, 4), [
    [0, 500],
    [500, 1000],
    [1000, 1500],
    [1500, 2000],
  ]);
  assert.ok(PRICE_SEGMENTS.some(([min, max]) => min === 20000 && max === 22500));
  assert.ok(PRICE_SEGMENTS.some(([min, max]) => min === 25000 && max === 27500));

  for (let index = 1; index < PRICE_SEGMENTS.length; index += 1) {
    assert.equal(PRICE_SEGMENTS[index - 1][1], PRICE_SEGMENTS[index][0]);
  }
});
