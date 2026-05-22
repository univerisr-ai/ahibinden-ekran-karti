import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAnalyzerDispatchPayload } from '../src/analyzer_dispatch_payload.mjs';

test('repository dispatch payload stays within GitHub client_payload limit', () => {
  const payload = buildAnalyzerDispatchPayload(
    {
      artifactName: 'scraper-results-cpu-123',
      productType: 'cpu',
      productLabel: 'Islemci',
      categoryUrl: 'https://www.sahibinden.com/islemci-masaustu',
      scrapeStatus: 'SCRAPE_COMPLETED',
      listingCount: 3980,
      startedAt: '2026-05-22T18:00:00.000Z',
      finishedAt: '2026-05-22T18:03:23.000Z',
      pipelineMessage: 'CPU scraper tamamlandi.',
      isFallback: false,
    },
    {
      env: {
        GITHUB_RUN_ID: '123',
        GITHUB_REPOSITORY: 'univerisr-ai/ahibinden-ekran-karti',
      },
      analyzerDispatchEvent: 'telegram_file_ready',
      productType: 'gpu',
      productLabel: 'Ekran Karti',
      baseUrl: 'https://www.sahibinden.com/ekran-karti-masaustu',
      productArtifactPrefix: 'scraper-results',
    },
  );

  assert.equal(payload.event_type, 'telegram_file_ready');
  assert.ok(Object.keys(payload.client_payload).length <= 10);
  assert.equal(payload.client_payload.product_type, 'cpu');
  assert.equal(payload.client_payload.artifact_name, 'scraper-results-cpu-123');
  assert.equal(
    payload.client_payload.source_run_url,
    'https://github.com/univerisr-ai/ahibinden-ekran-karti/actions/runs/123',
  );
  assert.equal(payload.client_payload.listing_count, 3980);
  assert.equal(payload.client_payload.scrape_status, 'SCRAPE_COMPLETED');
  assert.ok(!('started_at' in payload.client_payload));
  assert.ok(!('finished_at' in payload.client_payload));
  assert.ok(!('is_fallback' in payload.client_payload));
});

test('repository dispatch payload falls back to active product artifact name', () => {
  const payload = buildAnalyzerDispatchPayload(
    {},
    {
      env: {
        GITHUB_RUN_ID: '456',
        GITHUB_REPOSITORY: 'univerisr-ai/ahibinden-ekran-karti',
      },
      analyzerDispatchEvent: '',
      productType: 'cpu',
      productLabel: 'Islemci',
      baseUrl: 'https://www.sahibinden.com/islemci-masaustu',
      productArtifactPrefix: 'scraper-results-cpu',
    },
  );

  assert.equal(payload.event_type, 'telegram_file_ready');
  assert.equal(payload.client_payload.artifact_name, 'scraper-results-cpu-456');
  assert.equal(payload.client_payload.product_type, 'cpu');
  assert.equal(payload.client_payload.category_url, 'https://www.sahibinden.com/islemci-masaustu');
});
