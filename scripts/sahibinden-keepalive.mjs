import 'dotenv/config';

import {
  closeBrowser,
  initSession,
  saveChallengeProofScreenshot,
} from '../src/scrapeops.mjs';

async function main() {
  console.log('');
  console.log('  Sahibinden session keepalive basladi.');

  const session = await initSession();
  if (!session || !session.ok) {
    const code = session?.code || 'UNKNOWN_INIT_ERROR';
    await saveChallengeProofScreenshot('keepalive-failed');
    throw new Error(`Keepalive basarisiz: ${code}`);
  }

  const source = session.cookieSource || 'none';
  const count = Number.isFinite(Number(session.cookieCount)) ? Number(session.cookieCount) : 0;
  console.log(`  Keepalive OK. Session source: ${source} (${count} cookie).`);
}

main()
  .catch((err) => {
    console.error(`  Keepalive hata: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser();
  });
