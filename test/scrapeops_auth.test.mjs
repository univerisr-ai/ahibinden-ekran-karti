import test from 'node:test';
import assert from 'node:assert/strict';

import { isAuthRequiredPage } from '../src/scrapeops.mjs';

test('does not classify a real listing page as auth-required because of generic login text', () => {
  const html = `
    <html>
      <body>
        <table>
          <tr class="searchResultsItem">
            <td class="searchResultsTitleValue">
              <a class="classifiedTitle" href="/ilan/test-123/detay">RTX 3060 ekran karti</a>
            </td>
            <td class="searchResultsPriceValue"><span>7.500 TL</span></td>
          </tr>
        </table>
        <footer>
          <a>Uye girisi</a>
          <span>Sifre yardimi</span>
        </footer>
      </body>
    </html>
  `;

  assert.equal(
    isAuthRequiredPage(html, 'https://www.sahibinden.com/bilgisayar-masaustu-donanim-ekran-karti'),
    false,
  );
});

test('classifies the dedicated login route as auth-required', () => {
  assert.equal(
    isAuthRequiredPage('<form>Uye girisi <input name="password" placeholder="Sifre"></form>', 'https://www.sahibinden.com/uyelik/giris'),
    true,
  );
});

test('does not classify card-style listing pages as auth-required because of footer login hints', () => {
  const html = `
    <html>
      <body>
        <main>
          <h1>Aramanizda 245 sonuc bulundu</h1>
          <article class="listing-card">
            <a href="/ilan/test-1314455667/detay" title="RTX 3060 Ti">RTX 3060 Ti</a>
            <span class="price">8.900 TL</span>
          </article>
        </main>
        <footer>
          <a>Uye girisi</a>
          <span>Sifre yardimi</span>
        </footer>
      </body>
    </html>
  `;

  assert.equal(
    isAuthRequiredPage(html, 'https://www.sahibinden.com/ekran-karti-masaustu'),
    false,
  );
});
