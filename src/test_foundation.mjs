/**
 * ═══════════════════════════════════════════════════════════
 *  KREDİ OPTİMİZASYON TESTİ
 *  En ucuz çalışan ScrapeOps parametresini bulur
 *  Her kombinasyonu dener: ucuzdan pahalıya
 * ═══════════════════════════════════════════════════════════
 */
import 'dotenv/config';

const API_KEY = process.env.SCRAPEOPS_API_KEY || '';
const TARGET = 'https://www.sahibinden.com/ekran-karti-masaustu?pagingOffset=0&pagingSize=50';
const ENDPOINT = 'https://proxy.scrapeops.io/v1/';

if (!API_KEY) { console.log('❌ SCRAPEOPS_API_KEY yok!'); process.exit(1); }

// Ucuzdan pahalıya sıralı strateji listesi
const strategies = [
  {
    name: '1️⃣  Düz istek (bypass yok)',
    credits: '~1 kredi',
    params: {}
  },
  {
    name: '2️⃣  bypass=generic_level_1',
    credits: '~5 kredi',
    params: { bypass: 'generic_level_1' }
  },
  {
    name: '3️⃣  bypass=cloudflare_level_1',
    credits: '~10 kredi',
    params: { bypass: 'cloudflare_level_1' }
  },
  {
    name: '4️⃣  bypass=cloudflare_level_3',
    credits: '~15 kredi',
    params: { bypass: 'cloudflare_level_3' }
  },
  {
    name: '5️⃣  render_js=true',
    credits: '~10 kredi',
    params: { render_js: 'true' }
  },
  {
    name: '6️⃣  render_js + bypass=cloudflare_level_1',
    credits: '~15 kredi',
    params: { render_js: 'true', bypass: 'cloudflare_level_1' }
  },
  {
    name: '7️⃣  render_js + bypass=cloudflare_level_3',
    credits: '~25 kredi',
    params: { render_js: 'true', bypass: 'cloudflare_level_3' }
  },
  {
    name: '8️⃣  residential + bypass=cloudflare_level_3',
    credits: '~30 kredi',
    params: { residential: 'true', bypass: 'cloudflare_level_3' }
  },
  {
    name: '9️⃣  render_js + residential',
    credits: '~40 kredi',
    params: { render_js: 'true', residential: 'true' }
  },
  {
    name: '🔟  FULL: render_js + residential + CF_L3',
    credits: '~65 kredi',
    params: { render_js: 'true', residential: 'true', bypass: 'cloudflare_level_3' }
  },
];

function checkContent(html) {
  const hasListings = html.includes('searchResultsItem') || html.includes('classifiedTitle');
  const isCF = html.includes('Just a moment') || html.includes('challenge-platform');
  const isLogin = html.includes('loginForm') || (html.includes('login') && html.includes('password'));
  const isError = html.includes('error-page-container');

  const totalMatch = html.match(/([\d.]+)\s*ilan/i);
  const total = totalMatch ? totalMatch[1] : '0';
  const rows = (html.match(/searchResultsItem/g) || []).length;

  return { hasListings, isCF, isLogin, isError, total, rows, size: (html.length / 1024).toFixed(0) };
}

console.log('');
console.log('  ═══════════════════════════════════════════════════');
console.log('  🔬 ScrapeOps KREDİ OPTİMİZASYON TESTİ');
console.log('  ═══════════════════════════════════════════════════');
console.log(`  🔑 Key: ...${API_KEY.slice(-6)}`);
console.log(`  🎯 Hedef: Sahibinden ekran kartı`);
console.log(`  📋 ${strategies.length} strateji test edilecek (ucuzdan pahalıya)`);
console.log('');

let winner = null;

for (const strat of strategies) {
  console.log(`  ── ${strat.name} ──`);
  console.log(`     💰 Tahmini: ${strat.credits}`);

  const params = new URLSearchParams({ api_key: API_KEY, url: TARGET, ...strat.params });
  const url = `${ENDPOINT}?${params}`;

  try {
    const t = Date.now();
    const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
    const elapsed = ((Date.now() - t) / 1000).toFixed(1);

    if (!resp.ok) {
      console.log(`     ❌ HTTP ${resp.status} (${elapsed}s)`);
      console.log('');
      continue;
    }

    const html = await resp.text();
    const r = checkContent(html);

    console.log(`     📊 Status: 200 | ${r.size}KB | ${elapsed}s`);

    if (r.hasListings) {
      console.log(`     ✅ İLAN BULUNDU! ${r.rows} satır, toplam: ${r.total}`);
      console.log('');
      winner = { ...strat, rows: r.rows, total: r.total, elapsed };
      break;  // En ucuzu bulduk, dur
    } else if (r.isCF) {
      console.log(`     🚫 Cloudflare challenge — geçilemedi`);
    } else if (r.isLogin) {
      console.log(`     🚫 Login sayfası — yurt dışı IP`);
    } else if (r.isError) {
      console.log(`     🚫 Sahibinden hata sayfası`);
    } else {
      console.log(`     ⚠️ Bilinmeyen içerik (ilk 200ch): ${html.substring(0, 200)}`);
    }
  } catch (err) {
    console.log(`     ❌ Hata: ${err.message}`);
  }

  console.log('');
  // İstekler arası kısa bekleme
  await new Promise(r => setTimeout(r, 2000));
}

console.log('  ═══════════════════════════════════════════════════');
if (winner) {
  console.log(`  🏆 KAZANAN STRATEJİ: ${winner.name}`);
  console.log(`  💰 Sayfa başı maliyet: ${winner.credits}`);
  console.log(`  📊 Test sonucu: ${winner.rows} ilan satırı`);
  console.log('');

  // Maliyet hesabı
  const creditsPerPage = parseInt(winner.credits.replace(/[^0-9]/g, '')) || 5;
  const pagesFor10K = Math.ceil(10000 / 50); // 200 sayfa
  const totalCredits = creditsPerPage * pagesFor10K;
  console.log(`  📐 10.000 ilan için tahmini maliyet:`);
  console.log(`     ${pagesFor10K} sayfa × ${creditsPerPage} kredi = ${totalCredits.toLocaleString()} kredi`);
  console.log(`     Haftada 1 kez: Aylık ~${(totalCredits * 4).toLocaleString()} kredi`);
  console.log(`     Haftada 2 kez: Aylık ~${(totalCredits * 8).toLocaleString()} kredi`);
} else {
  console.log(`  ❌ HİÇBİR STRATEJİ ÇALIŞMADI!`);
  console.log(`  💡 ScrapeOps hesabında kredi kalmamış olabilir.`);
  console.log(`  💡 https://app.scrapeops.io adresinden kontrol edin.`);
}
console.log('  ═══════════════════════════════════════════════════');
