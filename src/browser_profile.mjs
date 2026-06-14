export const PROFILE_DIR_ENV_VAR = 'SAHIBINDEN_USER_DATA_DIR';
export const PERSISTENT_CONTEXT_ENV_VAR = 'SAHIBINDEN_PERSISTENT_CONTEXT';
export const DEFAULT_PROFILE_DIR = '.playwright/sahibinden-profile';

export function shouldUsePersistentContext(env = process.env) {
  return String(env[PERSISTENT_CONTEXT_ENV_VAR] || 'true').trim().toLowerCase() !== 'false';
}

export function resolvePersistentProfileDir(env = process.env) {
  const configured = String(env[PROFILE_DIR_ENV_VAR] || '').trim();
  return configured || DEFAULT_PROFILE_DIR;
}
