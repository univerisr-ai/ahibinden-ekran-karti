import { env } from 'node:process';

const FLARESOLVERR_URL = String(env.FLARESOLVERR_URL || 'http://flaresolverr:8191/v1').trim();
const FLARESOLVERR_TIMEOUT = parseInt(env.FLARESOLVERR_TIMEOUT_MS || '90000', 10);

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

export async function solveUrlWithFlareSolverr(targetUrl) {
  const cookies = loadSahibindenCookiesForFlareSolverr();
  const body = {
    cmd: 'request.get',
    url: targetUrl,
    maxTimeout: FLARESOLVERR_TIMEOUT,
  };
  if (cookies.length > 0) {
    body.cookies = cookies;
    console.log(`  FlareSolverr istegine ${cookies.length} adet SAHIBINDEN_COOKIES eklendi.`);
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
