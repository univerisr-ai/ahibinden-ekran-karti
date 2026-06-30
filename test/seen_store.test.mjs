import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { loadSeen, saveSeen, getSeenStateFile } from '../src/seen_store.mjs';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seen-')), 'seen-test.json');
}

test('bos state -> bos Map', () => {
  process.env.SEEN_STATE_FILE = tmpFile();
  const { ids } = loadSeen('gpu');
  assert.equal(ids.size, 0);
});

test('save sonra load -> ID korunur', () => {
  process.env.SEEN_STATE_FILE = tmpFile();
  const { ids } = loadSeen('gpu');
  saveSeen('gpu', ids, ['111111', '222222']);
  const reloaded = loadSeen('gpu').ids;
  assert.ok(reloaded.has('111111'));
  assert.ok(reloaded.has('222222'));
  assert.equal(reloaded.size, 2);
});

test('TTL gecmis kayitlar ayiklanir', () => {
  const file = tmpFile();
  process.env.SEEN_STATE_FILE = file;
  process.env.SEEN_TTL_DAYS = '30';
  const old = Date.now() - 40 * 86400 * 1000; // 40 gun once
  const fresh = Date.now();
  fs.writeFileSync(file, JSON.stringify({ updatedAt: fresh, ids: { OLD: old, NEW: fresh } }));
  const { ids } = loadSeen('gpu');
  assert.ok(!ids.has('OLD'), 'eski kayit ayiklanmali');
  assert.ok(ids.has('NEW'), 'yeni kayit kalmali');
  delete process.env.SEEN_TTL_DAYS;
});

test('MAX_ENTRIES limiti en yeni kayitlari tutar', () => {
  process.env.SEEN_STATE_FILE = tmpFile();
  process.env.SEEN_MAX_ENTRIES = '2';
  const base = Date.now();
  const map = new Map();
  map.set('a', base - 2000);
  map.set('b', base - 1000);
  map.set('c', base); // en yeni
  const kept = saveSeen('gpu', map, []);
  assert.equal(kept, 2);
  const reloaded = loadSeen('gpu').ids;
  assert.ok(reloaded.has('c'), 'en yeni kalmali');
  assert.ok(!reloaded.has('a'), 'en eski dusmeli');
  delete process.env.SEEN_MAX_ENTRIES;
});

test('getSeenStateFile urun tipine gore isim verir', () => {
  delete process.env.SEEN_STATE_FILE;
  process.env.SEEN_STATE_DIR = 'state';
  assert.equal(getSeenStateFile('cpu'), path.join('state', 'seen-cpu.json'));
  assert.equal(getSeenStateFile('gpu'), path.join('state', 'seen-gpu.json'));
});
