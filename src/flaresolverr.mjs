import { env } from 'node:process';

const FLARESOLVERR_URL = String(env.FLARESOLVERR_URL || 'http://flaresolverr:8191/v1').trim();
const FLARESOLVERR_TIMEOUT = parseInt(env.FLARESOLVERR_TIMEOUT_MS || '90000', 10);
const FLARESOLVERR_BATCH_SIZE = parseInt(env.FLARESOLVERR_BATCH_SIZE || '5', 10);

export { FLARESOLVERR_URL, FLARESOLVERR_TIMEOUT, FLARESOLVERR_BATCH_SIZE };

let flareSolverrSessionId = null;

function loadSahibindenCookiesForFlareSolverr() {
  const raw = String(env.SAHIBINDEN_COOKIES || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.log('  SAHIBINDEN_COOKIES array formatinda degil, FlareSolverr icin atlaniyor.');
      return [];
    }
    return parsed
      .filter((c) => c && typeof c === 'object' && typeof c.name === 'string' && typeof c.value === 'string')
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || undefined,
      }))
      .filter((c) => c.name && c.value);
  } catch (err) {
    console.log(`  SAHIBINDEN_COOKIES parse hatasi (FlareSolverr): ${err.message}`);
    return [];
  }
}

let freshPlaywrightCookies = [];

export function setFreshCookies(cookies) {
  freshPlaywrightCookies = cookies || [];
}

export async function solveUrlWithFlareSolverr(targetUrl) {
  const storedCookies = loadSahibindenCookiesForFlareSolverr();
  const cookies = [...storedCookies];
  // Add fresh cookies from browser login (convert to FlareSolverr format)
  for (const c of freshPlaywrightCookies) {
    cookies.push({
      name: c.name,
      value: c.value,
      domain: c.domain || '.sahibinden.com',
    });
  }
  const body = {
    cmd: 'request.get',
    url: targetUrl,
    maxTimeout: FLARESOLVERR_TIMEOUT,
  };
  if (cookies.length > 0) {
    body.cookies = cookies;
    console.log(`  FlareSolverr istegine ${cookies.length} adet cookie eklendi.`);
  }

  const res = await fetch(FLARESOLVERR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`FlareSolverr HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  if (data.status !== 'ok' || !data.solution) {
    throw new Error(`FlareSolverr error: ${data.message || JSON.stringify(data)}`);
  }

  return data.solution;
}

export function flareSolverrCookiesToPlaywright(cookies) {
  if (!Array.isArray(cookies)) return [];
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.expires ? Math.round(c.expires) : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: c.sameSite || 'Lax',
  }));
}

export async function createFlareSolverrSession(playwrightCookies) {
  const sessionId = `sahibinden-${Date.now()}`;
  const cookies = playwrightCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain || '.sahibinden.com',
    path: c.path || '/',
    secure: c.secure || false,
    httpOnly: c.httpOnly || false,
    sameSite: c.sameSite || 'Lax',
  }));

  const body = {
    cmd: 'sessions.create',
    session: sessionId,
    cookies,
  };

  console.log(`  FlareSolverr session olusturuluyor: ${sessionId} (${cookies.length} cookie)`);
  const res = await fetch(FLARESOLVERR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.log(`  FlareSolverr session olusturulamadi: HTTP ${res.status}`);
    return null;
  }

  const data = await res.json();
  if (data.status !== 'ok') {
    console.log(`  FlareSolverr session olusturulamadi: ${data.message}`);
    return null;
  }

  flareSolverrSessionId = sessionId;
  console.log(`  FlareSolverr session hazir: ${sessionId}`);
  return sessionId;
}

export function getFlareSolverrSessionId() {
  return flareSolverrSessionId;
}

export function getFlareSolverrBatchSize() {
  return FLARESOLVERR_BATCH_SIZE;
}
