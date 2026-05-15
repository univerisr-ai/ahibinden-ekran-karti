import test from 'node:test';
import assert from 'node:assert/strict';

import { parseListingPage } from '../src/parser.mjs';

test('prefers a real lazy-loaded Sahibinden image over the placeholder src', () => {
  const html = `
    <table>
      <tr class="searchResultsItem">
        <td class="searchResultsLargeThumbnail">
          <img
            src="https://s0.shbdn.com/assets/images/no-image-camera:f201d60ff6bef9afd79ad108475e92df.png"
            data-src="//i0.shbdn.com/photos/04/68/72/lthmb_1315046872e97.jpg"
            alt=""
          />
        </td>
        <td class="searchResultsTitleValue">
          <a class="classifiedTitle" href="/ilan/ikinci-el-ve-sifir-alisveris-bilgisayar-masaustu-sifir-5060ti-ekran-karti-1315046872/detay">
            Sifir 5060Ti Ekran Karti
          </a>
        </td>
        <td class="searchResultsPriceValue"><span>17.000 TL</span></td>
      </tr>
    </table>
  `;

  const { listings } = parseListingPage(html, '14.000-20.000 TL');
  assert.equal(listings.length, 1);
  assert.equal(listings[0].ilan_id, '1315046872');
  assert.equal(listings[0].resim, 'https://i0.shbdn.com/photos/04/68/72/lthmb_1315046872e97.jpg');
});

test('falls back to image URLs embedded in row html when img attributes are placeholders', () => {
  const html = `
    <table>
      <tr class="searchResultsItem" data-preview="//i0.shbdn.com/photos/11/22/33/lthmb_131112233x7a.jpg">
        <td><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" /></td>
        <td class="searchResultsTitleValue">
          <a class="classifiedTitle" href="/ilan/test-131112233/detay">GTX 1660 Super</a>
        </td>
        <td class="searchResultsPriceValue"><span>5.500 TL</span></td>
      </tr>
    </table>
  `;

  const { listings } = parseListingPage(html);
  assert.equal(listings[0].resim, 'https://i0.shbdn.com/photos/11/22/33/lthmb_131112233x7a.jpg');
});
