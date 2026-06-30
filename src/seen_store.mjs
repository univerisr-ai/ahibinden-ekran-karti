/**
 * SEEN_STORE.MJS — Run'lar arasi "gorulen ilan" hafizasi (incremental scraping)
 *
 * Amac: her kosuda ayni ~10.000 ilani bastan cekmek yerine, daha once gorulen
 * ilan ID'lerini kalici bir JSON state dosyasinda tutmak. Boylece:
 *   - date_desc siralamada bir segmentin sayfalari tamamen "gorulmus" ilanlardan
 *     olusuyorsa o segmentte daha derine inmeyi birakiriz (sayfa/sure/CI dakikasi tasarrufu),
 *   - yeni ilanlari (is_new) ayirt edebiliriz.
 *
 * State dosyasi GitHub Actions cache (veya repo commit) ile kosular arasi tasinir.
 * Bicim: { updatedAt: <epoch_ms>, ids: { "<ilan_id>": <lastSeenEpochMs> } }
 */
import fs from 'fs';
import path from 'path';

const ttlDays = () => parseInt(process.env.SEEN_TTL_DAYS || '45', 10);
const maxEntries = () => parseInt(process.env.SEEN_MAX_ENTRIES || '80000', 10);

export function getSeenStateFile(productType = 'gpu') {
  if (process.env.SEEN_STATE_FILE) return process.env.SEEN_STATE_FILE;
  const dir = process.env.SEEN_STATE_DIR || 'state';
  return path.join(dir, `seen-${productType}.json`);
}

/**
 * State dosyasini okur, suresi gecmis (TTL) kayitlari ayiklar.
 * @returns {{ ids: Map<string, number>, file: string, loaded: number }}
 */
export function loadSeen(productType = 'gpu') {
  const file = getSeenStateFile(productType);
  const ids = new Map();
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const now = Date.now();
      const ttlMs = ttlDays() * 86400 * 1000;
      const entries = raw && raw.ids && typeof raw.ids === 'object' ? raw.ids : {};
      for (const [id, ts] of Object.entries(entries)) {
        const t = Number(ts) || 0;
        if (ttlMs <= 0 || now - t <= ttlMs) ids.set(String(id), t);
      }
    }
  } catch (err) {
    console.log(`  ⚠️ seen-store okunamadi (${file}): ${err.message} — bos baslaniyor.`);
  }
  return { ids, file, loaded: ids.size };
}

/**
 * Verilen ID'leri "gorulmus" olarak isaretler (su anki zaman damgasiyla),
 * TTL/limit uygular ve dosyaya yazar.
 */
export function saveSeen(productType, seenMap, freshIds = []) {
  const file = getSeenStateFile(productType);
  const now = Date.now();
  for (const id of freshIds) {
    if (id) seenMap.set(String(id), now);
  }

  // Limit: en yeni gorulen MAX_ENTRIES kaydi tut.
  let entries = Array.from(seenMap.entries());
  const cap = maxEntries();
  if (entries.length > cap) {
    entries.sort((a, b) => b[1] - a[1]);
    entries = entries.slice(0, cap);
  }

  const payload = { updatedAt: now, ids: Object.fromEntries(entries) };
  try {
    const dir = path.dirname(file);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload), 'utf-8');
    console.log(`  💾 seen-store yazildi: ${file} (${entries.length} ID)`);
  } catch (err) {
    console.log(`  ⚠️ seen-store yazilamadi (${file}): ${err.message}`);
  }
  return entries.length;
}

export default { getSeenStateFile, loadSeen, saveSeen };
