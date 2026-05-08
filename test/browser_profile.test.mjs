import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PROFILE_DIR,
  PERSISTENT_CONTEXT_ENV_VAR,
  PROFILE_DIR_ENV_VAR,
  resolvePersistentProfileDir,
  shouldUsePersistentContext,
} from '../src/browser_profile.mjs';

test('uses persistent context by default', () => {
  assert.equal(shouldUsePersistentContext({}), true);
});

test('allows persistent context to be disabled by env', () => {
  assert.equal(shouldUsePersistentContext({ [PERSISTENT_CONTEXT_ENV_VAR]: 'false' }), false);
});

test('resolves custom profile directory from env', () => {
  assert.equal(resolvePersistentProfileDir({ [PROFILE_DIR_ENV_VAR]: '.cache/profile' }), '.cache/profile');
});

test('falls back to default profile directory', () => {
  assert.equal(resolvePersistentProfileDir({}), DEFAULT_PROFILE_DIR);
});
