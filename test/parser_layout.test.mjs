import test from 'node:test';
import assert from 'node:assert/strict';

import { hasLikelyListingSignals, parseListingPage } from '../src/parser.mjs';

test('parses modern card-style listing markup and extracts total count', () => {
  const html = `
    <main>
      <h1>Aramanizda 1.234 sonuc bulundu</h1>
      <section class="listing-grid">
        <article class="listing-card" data-id="1319988776">
          <a
            href="/ilan/ikinci-el-ve-sifir-alisveris-bilgisayar-masaustu-msi-rtx-4070-super-1319988776/detay"
            title="MSI RTX 4070 Super Gaming X"
          >
            <img src="https://i0.shbdn.com/photos/99/88/77/lthmb_1319988776abc.jpg" alt="" />
          </a>
          <div class="listing-meta">
            <span class="price">24.750 TL</span>
            <span class="location">Istanbul / Kadikoy</span>
            <time>Bugun</time>
          </div>
        </article>
      </section>
    </main>
  `;

  const { listings, totalCount } = parseListingPage(html, '20.000-30.000 TL');
  assert.equal(totalCount, 1234);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].ilan_id, '1319988776');
  assert.equal(listings[0].baslik, 'MSI RTX 4070 Super Gaming X');
  assert.equal(listings[0].fiyat, 24750);
  assert.equal(listings[0].konum, 'Istanbul / Kadikoy');
  assert.equal(listings[0].segment, '20.000-30.000 TL');
});

test('detects card-style markup as a valid listings page signal', () => {
  const html = `
    <div class="results">
      <h1>Aramanizda 245 sonuc bulundu</h1>
      <article class="listing-card">
        <a href="/ilan/test-1314455667/detay" title="RTX 3060 Ti"></a>
        <span class="price">8.900 TL</span>
      </article>
    </div>
  `;

  assert.equal(hasLikelyListingSignals(html), true);
});
