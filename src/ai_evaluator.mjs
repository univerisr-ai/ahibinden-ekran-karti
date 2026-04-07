/**
 * ═══════════════════════════════════════════════════════════════
 *  AI_EVALUATOR.MJS — Yapay Zeka Fırsat Analiz Motoru
 *  Google Gemini / OpenRouter entegrasyonu
 *  Chunk tabanlı paralel analiz + Structured JSON Output
 * ═══════════════════════════════════════════════════════════════
 */
import {
  AI_PROVIDER,
  GEMINI_API_KEY,
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL,
  AI_CHUNK_SIZE,
  AI_DELAY_BETWEEN_CHUNKS_MS,
  AI_TOP_RESULTS,
} from './config.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Array'i chunk'lara böl ──────────────────────────────────
export function chunkArray(arr, size = AI_CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── AI System Prompt ────────────────────────────────────────
const SYSTEM_PROMPT = `Sen bir ekran kartı (GPU) ikinci el piyasa uzmanısın. Türkiye'deki Sahibinden.com ilanlarını analiz ediyorsun.

Görevin:
1. Sana verilen GPU ilan listesini incele.
2. Her ilana 1-100 arası bir "fırsat puanı" ver.
3. Puanlama kriterleri:
   - Piyasa değerinin %15 veya daha altında fiyat → yüksek puan (70-100)
   - Normal piyasa fiyatında → orta puan (40-60)
   - Pahalı → düşük puan (0-30)
   - Açıklamada "arızalı", "parça", "tamir", "bozuk" kelimeleri varsa → 0 puan
   - Başıkta "mining", "madenci" varsa → düşük puan
   - Param güvende / kargo özelliği olan → +10 bonus puan
   - RTX 3000/4000/5000, RX 6000/7000/9000 serisi → bonus (talep yüksek)
   - Çok eski ilan (30+ gün) → -10 puan

4. SADECE puan 65 ve üzeri olan ilanları döndür.
5. Yanıtını SADECE geçerli JSON formatında ver, başka hiçbir metin ekleme.

Yanıt formatı:
{
  "results": [
    {
      "ilan_id": "12345678",
      "baslik": "...",
      "puan": 87,
      "gercek_deger_tahmini": 18000,
      "kar_marji_yuzde": 16,
      "aciklama": "RTX 4070 piyasada 18K, burada 15.5K. Temiz ilan."
    }
  ]
}

Eğer hiçbir ilan 65 puan almıyorsa boş array döndür: {"results": []}`;

// ─── Gemini API Çağrısı ─────────────────────────────────────
async function callGemini(userPrompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY tanımlı değil!');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${SYSTEM_PROMPT}\n\n---\n\nAnaliz edilecek ilanlar:\n${userPrompt}` }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini HTTP ${resp.status}: ${errText.substring(0, 200)}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{"results":[]}';

  return parseAIResponse(text);
}

// ─── OpenRouter API Çağrısı ─────────────────────────────────
async function callOpenRouter(userPrompt) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY tanımlı değil!');
  }

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 8192,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenRouter HTTP ${resp.status}: ${errText.substring(0, 200)}`);
  }

  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || '{"results":[]}';

  return parseAIResponse(text);
}

// ─── AI Yanıtını JSON'a Çevir (Güvenli) ─────────────────────
function parseAIResponse(text) {
  try {
    // Bazen AI ```json ... ``` içine koyar, temizle
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
    }
    const parsed = JSON.parse(cleaned);
    return parsed.results || [];
  } catch (err) {
    console.log(`  ⚠️ AI yanıtı JSON parse edilemedi: ${err.message}`);
    console.log(`  📝 Ham yanıt (ilk 200 karakter): ${text.substring(0, 200)}`);
    return [];
  }
}

// ─── Tek Chunk'ı AI'a Gönder ────────────────────────────────
async function evaluateChunk(chunk, chunkIndex, totalChunks) {
  const label = `Chunk ${chunkIndex + 1}/${totalChunks}`;

  // Chunk'ı kompakt JSON'a çevir (token tasarrufu)
  const compactData = chunk.map(item => ({
    id: item.ilan_id,
    baslik: item.baslik,
    fiyat: item.fiyat,
    konum: item.konum,
    tarih: item.tarih,
    url: item.url,
  }));

  const userPrompt = JSON.stringify(compactData, null, 0);

  try {
    let results;
    if (AI_PROVIDER === 'gemini') {
      results = await callGemini(userPrompt);
    } else if (AI_PROVIDER === 'openrouter') {
      results = await callOpenRouter(userPrompt);
    } else {
      throw new Error(`Bilinmeyen AI_PROVIDER: ${AI_PROVIDER}`);
    }

    console.log(`  🤖 ${label}: ${results.length} fırsatlı ilan bulundu`);
    return results;
  } catch (err) {
    console.log(`  ❌ ${label} AI hatası: ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
//  ANA FONKSİYON — Tüm ilanları chunk'lara bölüp AI'a gönder
// ═══════════════════════════════════════════════════════════════
export async function evaluateAllListings(listings) {
  console.log('');
  console.log('  ════════════════════════════════════════════');
  console.log('  🤖 YAPAY ZEKA ANALİZİ BAŞLIYOR');
  console.log('  ════════════════════════════════════════════');
  console.log(`  📊 Toplam ilan: ${listings.length.toLocaleString('tr')}`);
  console.log(`  📦 Chunk boyutu: ${AI_CHUNK_SIZE}`);

  const chunks = chunkArray(listings, AI_CHUNK_SIZE);
  console.log(`  📨 Toplam chunk: ${chunks.length}`);
  console.log(`  🕐 Tahmini süre: ~${Math.ceil(chunks.length * AI_DELAY_BETWEEN_CHUNKS_MS / 1000 / 60)} dakika`);
  console.log('');

  const allResults = [];

  for (let i = 0; i < chunks.length; i++) {
    const results = await evaluateChunk(chunks[i], i, chunks.length);

    // Referans verileri geri ekle (AI sadece ID ve puan döndürüyor)
    for (const result of results) {
      const original = listings.find(l => l.ilan_id === result.ilan_id);
      if (original) {
        result.url = original.url;
        result.konum = original.konum;
        result.fiyat = original.fiyat;
        result.fiyat_str = original.fiyat_str;
        result.baslik = result.baslik || original.baslik;
      }
    }

    allResults.push(...results);

    // Rate limiting — chunk arası bekleme
    if (i < chunks.length - 1) {
      await sleep(AI_DELAY_BETWEEN_CHUNKS_MS);
    }
  }

  console.log(`\n  ✅ AI analizi tamamlandı. ${allResults.length} fırsatlı ilan bulundu.`);

  return allResults;
}

// ═══════════════════════════════════════════════════════════════
//  EN İYİ FIRSATLARI SEÇ (Puana göre sırala, Top N al)
// ═══════════════════════════════════════════════════════════════
export function selectTopOpportunities(results, topN = AI_TOP_RESULTS) {
  return results
    .sort((a, b) => (b.puan || 0) - (a.puan || 0))
    .slice(0, topN);
}

// ═══════════════════════════════════════════════════════════════
//  FALLBACK — AI olmadan, sadece en ucuz ilanları seç
// ═══════════════════════════════════════════════════════════════
export function fallbackSelection(listings, topN = AI_TOP_RESULTS) {
  console.log('  ⚠️ AI kullanılamıyor, fiyat bazlı fallback devrede...');

  return listings
    .filter(l => l.fiyat > 0)
    .sort((a, b) => a.fiyat - b.fiyat)
    .slice(0, topN)
    .map(item => ({
      ilan_id: item.ilan_id,
      baslik: item.baslik,
      fiyat: item.fiyat,
      fiyat_str: item.fiyat_str,
      konum: item.konum,
      url: item.url,
      puan: 50,
      gercek_deger_tahmini: null,
      kar_marji_yuzde: null,
      aciklama: 'AI analizi yapılamadı — fiyat sıralamasına göre seçildi.',
    }));
}

export default {
  chunkArray,
  evaluateAllListings,
  selectTopOpportunities,
  fallbackSelection,
};
