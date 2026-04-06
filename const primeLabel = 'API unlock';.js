  const primeLabel = 'API unlock';
  let unlockHtml = null;
  const maxRetries = 3;

  for (let i = 0; i < maxRetries; i++) {
    unlockHtml = await fetchViaApi(BASE_URL, `${primeLabel} (Deneme ${i + 1}/${maxRetries})`, key, {
      unlock: true,
      haltOnFailure: false,
    });

    if (unlockHtml) {
      console.log(`  🔓 API session primed (tek sefer pahali unlock tamamlandi - deneme ${i + 1}).`);
      apiSessionPrimed = true;
      return 'API_SESSION_PRIMED';
    }

    if (i < maxRetries - 1) {
      console.log(`  ⏳ Unlock başarısız oldu, ${REQUEST_DELAY_MS}ms bekleniyor ve tekrar deneniyor...`);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const apiProbeHtml = await fetchViaApi(BASE_URL, 'API probe', key, {
    unlock: false,
    haltOnFailure: false,
  });