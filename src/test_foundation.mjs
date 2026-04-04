import 'dotenv/config';
import { ProxyAgent } from 'undici';

const rawKeys = (process.env.SCRAPEOPS_API_KEYS || process.env.SCRAPEOPS_API_KEY || '').trim();
const keys = rawKeys.split(',').map((k) => k.trim()).filter(Boolean);

const proxyScheme = process.env.SCRAPEOPS_PROXY_SCHEME || 'http';
const proxyHost = process.env.SCRAPEOPS_PROXY_HOST || 'proxy.scrapeops.io';
const proxyPort = Number(process.env.SCRAPEOPS_PROXY_PORT || 8339);
const proxyUser = process.env.SCRAPEOPS_PROXY_USER || 'scrapeops';

const target = process.env.TEST_TARGET_URL || 'https://www.sahibinden.com/ekran-karti-masaustu?pagingOffset=0&pagingSize=50&sorting=date_desc';

if (keys.length === 0) {
  console.error('SCRAPEOPS_API_KEYS veya SCRAPEOPS_API_KEY tanimli degil.');
  process.exit(1);
}

function buildProxyUrl(key) {
  return `${proxyScheme}://${proxyUser}:${encodeURIComponent(key)}@${proxyHost}:${proxyPort}`;
}

function classify(html) {
  const body = html.toLowerCase();
  const hasListings = body.includes('searchresultsitem') || body.includes('classifiedtitle');
  const isChallenge =
    body.includes('just a moment') ||
    body.includes('challenge-platform') ||
    body.includes('error 1020') ||
    body.includes('cf-chl');

  const totalMatch = html.match(/([\d.]{1,9})\s*ilan/i);
  const total = totalMatch ? totalMatch[1] : '0';
  const rows = (html.match(/searchResultsItem/g) || []).length;

  return { hasListings, isChallenge, total, rows };
}

console.log('Proxy-only temel test basliyor...');
console.log(`Hedef URL: ${target}`);

for (const key of keys) {
  const keyLabel = `${key.slice(0, 5)}...`;
  const dispatcher = new ProxyAgent(buildProxyUrl(key));

  try {
    const start = Date.now();
    const response = await fetch(target, {
      dispatcher,
      signal: AbortSignal.timeout(45000),
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    const html = await response.text();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const c = classify(html);

    console.log(`\nKey ${keyLabel}`);
    console.log(`HTTP ${response.status} | ${elapsed}s | ${Math.round(html.length / 1024)}KB`);
    if (c.hasListings) {
      console.log(`OK: listing markup bulundu | rows=${c.rows} | toplam=${c.total}`);
    } else if (c.isChallenge) {
      console.log('Challenge sayfasi dondu (CF).');
    } else {
      console.log('Beklenmeyen govde dondu (ne challenge ne listing).');
    }
  } catch (err) {
    console.log(`\nKey ${keyLabel}`);
    console.log(`Hata: ${err.message}`);
  }
}
