export function buildAnalyzerDispatchPayload(dispatchMeta = {}, options = {}) {
  const env = options.env || process.env;
  const eventType =
    String(options.analyzerDispatchEvent || 'telegram_file_ready').trim() || 'telegram_file_ready';
  const productType = String(dispatchMeta?.productType || options.productType || 'gpu').trim() || 'gpu';
  const productLabel =
    String(dispatchMeta?.productLabel || options.productLabel || 'Ekran Karti').trim() || 'Ekran Karti';
  const categoryUrl = String(dispatchMeta?.categoryUrl || options.baseUrl || '').trim();
  const artifactPrefix = String(options.productArtifactPrefix || 'scraper-results').trim() || 'scraper-results';
  const githubRunId = String(env.GITHUB_RUN_ID || '').trim();
  const sourceRepository = String(env.GITHUB_REPOSITORY || '').trim();
  const sourceRunUrl =
    githubRunId && sourceRepository
      ? `https://github.com/${sourceRepository}/actions/runs/${githubRunId}`
      : '';
  const artifactName =
    String(dispatchMeta?.artifactName || '').trim() ||
    `${artifactPrefix}-${githubRunId || 'local'}`;
  const listingCount = Number.isFinite(Number(dispatchMeta?.listingCount))
    ? Number(dispatchMeta.listingCount)
    : 0;
  const pipelineMessage =
    String(
      dispatchMeta?.pipelineMessage ||
        dispatchMeta?.sourceMessage ||
        'Scraper tamamlandi; veri analiz edilmedi durumunda analyzer servisine gonderildi.',
    ).trim();

  return {
    event_type: eventType,
    client_payload: {
      github_run_id: githubRunId,
      source_repository: sourceRepository,
      source_run_url: sourceRunUrl,
      artifact_name: artifactName,
      product_type: productType,
      product_label: productLabel,
      category_url: categoryUrl,
      scrape_status: String(dispatchMeta?.scrapeStatus || 'SCRAPE_COMPLETED').trim() || 'SCRAPE_COMPLETED',
      listing_count: listingCount,
      pipeline_message: pipelineMessage,
    },
  };
}
