import { env } from 'node:process';

const FLARESOLVERR_URL = String(env.FLARESOLVERR_URL || 'http://flaresolverr:8191/v1').trim();
const FLARESOLVERR_TIMEOUT = parseInt(env.FLARESOLVERR_TIMEOUT_MS || '90000', 10);

export async function solveUrlWithFlareSolverr(targetUrl) {
  const res = await fetch(FLARESOLVERR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: 'request.get',
      url: targetUrl,
      maxTimeout: FLARESOLVERR_TIMEOUT,
    }),
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
