import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const TARGET_URL =
  process.env.TARGET_URL || "https://www.sahibinden.com/ekran-karti-masaustu";
const AUTHORIZED_USER_ID = String(
  process.env.TELEGRAM_USER_ID || process.env.TELEGRAM_CHAT_ID || ""
).trim();
const PLAYWRIGHT_CHANNEL = String(process.env.PLAYWRIGHT_CHANNEL || "").trim();
const BOT_TOKENS = [
  process.env.TELEGRAM_BOT_TOKEN_1,
  process.env.TELEGRAM_BOT_TOKEN_2,
]
  .map((token) => String(token || "").trim())
  .filter(Boolean);

const ARTIFACTS_DIR = "artifacts";
const SCREENSHOT_PATH = `${ARTIFACTS_DIR}/sahibinden-ekran-karti.png`;
const HTML_PATH = `${ARTIFACTS_DIR}/page.html`;

function assertConfig() {
  if (!AUTHORIZED_USER_ID) {
    throw new Error("Missing TELEGRAM_USER_ID secret.");
  }

  if (BOT_TOKENS.length === 0) {
    throw new Error("Missing Telegram bot token secrets.");
  }
}

function isTriggerText(text) {
  const normalized = text.trim().toLowerCase();
  const firstWord = normalized.split(/\s+/)[0].replace(/@\w+$/, "");
  const exactCommands = new Set([
    "/shot",
    "/ss",
    "/screen",
    "/ekran",
    "/bak",
    "/kontrol",
    "/sahibinden",
    "shot",
    "ss",
    "screen",
    "ekran",
    "bak",
    "kontrol",
    "sahibinden",
  ]);

  return (
    exactCommands.has(firstWord) ||
    normalized.includes("ekran") ||
    normalized.includes("shot") ||
    normalized.includes("kontrol") ||
    normalized.includes("sahibinden")
  );
}

async function telegramApi(token, method, { json, form } = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: form ? undefined : { "content-type": "application/json" },
    body: form ? form : JSON.stringify(json || {}),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${method} HTTP ${response.status}: ${body}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`${method} failed: ${data.description || "Unknown error"}`);
  }

  return data.result;
}

async function loadBotUpdates(token, index) {
  const webhookInfo = await telegramApi(token, "getWebhookInfo");
  if (webhookInfo.url) {
    throw new Error(
      `Bot ${index + 1} has an active webhook. getUpdates cannot be used until the webhook is removed.`
    );
  }

  const updates = await telegramApi(token, "getUpdates", {
    json: {
      limit: 100,
      timeout: 0,
      allowed_updates: ["message"],
    },
  });

  return {
    token,
    index,
    updates,
    maxUpdateId:
      updates.length > 0
        ? Math.max(...updates.map((update) => update.update_id))
        : null,
  };
}

async function acknowledgeUpdates(token, maxUpdateId) {
  if (maxUpdateId == null) {
    return;
  }

  await telegramApi(token, "getUpdates", {
    json: {
      offset: maxUpdateId + 1,
      limit: 1,
      timeout: 0,
      allowed_updates: ["message"],
    },
  });
}

const SCRAPEOPS_API_KEY = process.env.SCRAPEOPS_API_KEY || "4cd90769-9c97-492d-8d65-56e284c0afaa";

async function fetchViaScrapeOps(targetUrl) {
  const params = new URLSearchParams({
    api_key: SCRAPEOPS_API_KEY,
    url: targetUrl,
    bypass: "cloudflare_level_3",
    render_js: "true",
    residential: "true",
    wait: "5000",
  });

  const apiUrl = `https://proxy.scrapeops.io/v1/?${params}`;
  console.log("ScrapeOps API proxy ile sayfa aliniyor...");

  const response = await fetch(apiUrl, {
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ScrapeOps proxy HTTP ${response.status}: ${body}`);
  }

  return await response.text();
}

async function captureArtifacts() {
  await mkdir(ARTIFACTS_DIR, { recursive: true });

  // 1) ScrapeOps API proxy ile sahibinden HTML'ini al
  let html;
  let fetchMethod = "scrapeops";
  try {
    html = await fetchViaScrapeOps(TARGET_URL);
    console.log(`ScrapeOps basarili, ${html.length} byte HTML alindi.`);
  } catch (err) {
    console.error(`ScrapeOps basarisiz: ${err.message}`);
    console.log("Dogrudan Playwright ile deneniyor...");
    fetchMethod = "direct";
  }

  // 2) Playwright ile render et ve screenshot al
  const launchOptions = { headless: true };
  if (PLAYWRIGHT_CHANNEL) {
    launchOptions.channel = PLAYWRIGHT_CHANNEL;
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    viewport: { width: 1440, height: 1100 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  let title;
  if (fetchMethod === "scrapeops" && html) {
    // ScrapeOps'tan alinan HTML'i Playwright'a yukle
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    title = await page.title();
    await writeFile(HTML_PATH, html, "utf8");
  } else {
    // Dogrudan Playwright ile sayfaya git (fallback)
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(4000);
    title = await page.title();
    html = await page.content();
    await writeFile(HTML_PATH, html, "utf8");
  }

  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
  console.log(`Screenshot alindi. Baslik: ${title || "bulunamadi"} (yontem: ${fetchMethod})`);

  await context.close();
  await browser.close();

  return { title };
}

function formatNow() {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Istanbul",
  }).format(new Date());
}

async function sendPhoto(token, chatId, caption) {
  const imageBytes = await readFile(SCREENSHOT_PATH);
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption.slice(0, 1024));
  form.set(
    "photo",
    new Blob([imageBytes], { type: "image/png" }),
    "sahibinden-ekran-karti.png"
  );

  await telegramApi(token, "sendPhoto", { form });
}

async function sendMessage(token, chatId, text) {
  await telegramApi(token, "sendMessage", {
    json: {
      chat_id: String(chatId),
      text: text.slice(0, 4096),
    },
  });
}

function pickLatestCommand(botStates) {
  const candidates = [];

  for (const state of botStates) {
    for (const update of state.updates) {
      const message = update.message;
      if (!message || String(message.from?.id) !== AUTHORIZED_USER_ID) {
        continue;
      }

      const text = String(message.text || "").trim();
      if (!text || !isTriggerText(text)) {
        continue;
      }

      candidates.push({
        token: state.token,
        botIndex: state.index,
        chatId: message.chat.id,
        updateId: update.update_id,
        text,
      });
    }
  }

  candidates.sort((a, b) => b.updateId - a.updateId);
  return candidates[0] || null;
}

async function main() {
  assertConfig();

  const botStates = [];
  const loadErrors = [];

  for (const [index, token] of BOT_TOKENS.entries()) {
    try {
      const state = await loadBotUpdates(token, index);
      console.log(
        `Bot ${index + 1}: ${state.updates.length} pending update(s) checked.`
      );
      botStates.push(state);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown bot loading error.";
      console.error(`Bot ${index + 1} skipped: ${message}`);
      loadErrors.push(`Bot ${index + 1}: ${message}`);
    }
  }

  if (botStates.length === 0) {
    throw new Error(
      `No usable Telegram bots found. ${loadErrors.join(" | ")}`
    );
  }

  const latestCommand = pickLatestCommand(botStates);

  try {
    if (!latestCommand) {
      console.log("No matching Telegram command found.");
      return;
    }

    console.log(
      `Processing command from bot ${latestCommand.botIndex + 1}: ${latestCommand.text}`
    );

    const { title } = await captureArtifacts();
    const caption = [
      "GitHub sunucusu sahibinden ekran karti sayfasina girdi.",
      `Saat: ${formatNow()}`,
      `Baslik: ${title || "bulunamadi"}`,
    ].join("\n");

    await sendPhoto(latestCommand.token, latestCommand.chatId, caption);
    console.log("Screenshot sent to Telegram.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown screenshot error.";
    console.error(message);

    if (latestCommand) {
      await sendMessage(
        latestCommand.token,
        latestCommand.chatId,
        `GitHub sunucusu ekran goruntusunu alamadi: ${message}`
      ).catch(() => {});
    }

    throw error;
  } finally {
    for (const state of botStates) {
      try {
        await acknowledgeUpdates(state.token, state.maxUpdateId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown acknowledge error.";
        console.error(
          `Bot ${state.index + 1} updates could not be acknowledged: ${message}`
        );
      }
    }
  }
}

await main();
