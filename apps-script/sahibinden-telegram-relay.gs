const TELEGRAM_BOT_TOKEN = "PASTE_TELEGRAM_BOT_TOKEN";
const TELEGRAM_CHAT_ID = "PASTE_TELEGRAM_CHAT_ID";
const GMAIL_QUERY =
  'is:unread (from:sahibinden.com OR from:no-reply@sahibinden.com OR from:noreply@sahibinden.com)';
const PROCESSED_LABEL = "sahibinden-forwarded";
const SUBJECT_KEYWORDS = ["yorum", "mesaj", "soru", "ilan", "favori arama"];
const ACCOUNT_ALIASES = {
  "merkez+hesap1@gmail.com": "Hesap 1",
  "merkez+hesap2@gmail.com": "Hesap 2",
};

function relaySahibindenAlerts() {
  const label = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(`${GMAIL_QUERY} -label:${PROCESSED_LABEL}`, 0, 10);

  if (threads.length === 0) {
    Logger.log("No new sahibinden alert emails found.");
    return;
  }

  for (const thread of threads) {
    const messages = thread.getMessages();
    const message = messages[messages.length - 1];
    const subject = clean_(message.getSubject());
    if (!matchesSubject_(subject)) {
      thread.addLabel(label);
      continue;
    }

    const plainBody = clean_(message.getPlainBody()).slice(0, 2500);
    const firstUrl = extractFirstUrl_(plainBody);
    const accountName = detectAccountName_(message);
    const lines = [
      "Yeni sahibinden bildirimi geldi.",
      `Hesap: ${accountName}`,
      `Konu: ${subject || "bos"}`,
    ];

    if (firstUrl) {
      lines.push(`Link: ${firstUrl}`);
    }

    if (plainBody) {
      lines.push("");
      lines.push(plainBody);
    }

    sendTelegramMessage_(lines.join("\n"));
    thread.addLabel(label);
    thread.markRead();
  }
}

function setupEveryFiveMinutesTrigger() {
  deleteExistingTriggers_("relaySahibindenAlerts");
  ScriptApp.newTrigger("relaySahibindenAlerts").timeBased().everyMinutes(5).create();
}

function deleteExistingTriggers_(handlerName) {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function sendTelegramMessage_(text) {
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: text.slice(0, 4096),
    disable_web_page_preview: false,
  };

  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    }
  );

  const body = response.getContentText();
  if (response.getResponseCode() >= 400) {
    throw new Error(`Telegram sendMessage failed: ${body}`);
  }
}

function clean_(value) {
  return String(value || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractFirstUrl_(text) {
  const match = String(text || "").match(/https?:\/\/\S+/i);
  return match ? match[0] : "";
}

function matchesSubject_(subject) {
  const normalized = clean_(subject).toLowerCase();
  if (!normalized) {
    return true;
  }

  return SUBJECT_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function detectAccountName_(message) {
  const recipients = [message.getTo(), message.getCc(), message.getBcc()]
    .map((value) => clean_(value).toLowerCase())
    .filter(Boolean)
    .join(" ");

  for (const alias in ACCOUNT_ALIASES) {
    if (recipients.includes(alias.toLowerCase())) {
      return ACCOUNT_ALIASES[alias];
    }
  }

  return "Bilinmeyen hesap";
}
