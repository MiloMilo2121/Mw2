// ─────────────────────────────────────────────────────────────────────────────
// notify.ts — P0.1: the single outbound alert channel for MW2.
//
// Pluggable provider: Telegram (default), a generic webhook (Slack/Discord/…),
// email (Resend), or `console` for zero-credential local testing. The recipient
// is env-driven so it can be re-pointed WITHOUT a deploy — the "presidio agosto"
// requirement: an alert with no configurable recipient is an alert that doesn't
// exist.
//
// Guardrail parity with the cron (root CLAUDE.md §3.4): when nothing is
// configured, notify() is a logged no-op that returns { skipped: true } and
// never throws. Alerting must never break its caller — a down channel must not
// take the 07:00 automations cron with it. Every request is also time-bounded
// so a hung endpoint can't stall the shared cron budget.
//
// Env (configure ONE channel; auto-detected, or force with ALERT_CHANNEL):
//   ALERT_CHANNEL           — telegram | email | webhook | console (optional)
//   TELEGRAM_BOT_TOKEN      — Telegram bot token (@BotFather)
//   TELEGRAM_CHAT_ID        — Telegram recipient (or ALERT_RECIPIENT)
//   ALERT_WEBHOOK_URL       — Slack/Discord/webhook.site incoming webhook
//   ALERT_RESEND_API_KEY    — Resend API key (email channel)
//   ALERT_EMAIL_FROM        — verified sender (email channel)
//   ALERT_RECIPIENT         — email address / Telegram chat id (channel-dependent)
// ─────────────────────────────────────────────────────────────────────────────

export type AlertLevel = "info" | "warn" | "crit";
export type AlertChannel = "telegram" | "email" | "webhook" | "console";

export type NotifyResult = {
  ok: boolean;
  skipped: boolean;
  channel?: AlertChannel;
  error?: string;
};

const LEVEL_PREFIX: Record<AlertLevel, string> = {
  info: "ℹ️",
  warn: "⚠️",
  crit: "🚨",
};

/** Abort a notification request after this many ms so a hung endpoint can't
 *  stall the cron (one maxDuration budget is shared across all clients). */
const NOTIFY_TIMEOUT_MS = 10_000;

function telegram(): { token?: string; chatId?: string } {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID || process.env.ALERT_RECIPIENT,
  };
}

/**
 * Resolve the active channel from env. Explicit ALERT_CHANNEL wins; otherwise
 * auto-detect from whichever credentials are present. Returns null when nothing
 * is configured (→ notify() is a no-op).
 */
export function activeChannel(): AlertChannel | null {
  const explicit = (process.env.ALERT_CHANNEL || "").trim().toLowerCase();
  if (explicit === "telegram" || explicit === "email" || explicit === "webhook" || explicit === "console") {
    return explicit;
  }
  if (process.env.ALERT_WEBHOOK_URL) return "webhook";
  const { token, chatId } = telegram();
  if (token && chatId) return "telegram";
  if (process.env.ALERT_RESEND_API_KEY && process.env.ALERT_EMAIL_FROM && process.env.ALERT_RECIPIENT) {
    return "email";
  }
  return null;
}

/** True when at least one channel is configured. */
export function isNotifyConfigured(): boolean {
  return activeChannel() !== null;
}

/** Pure formatter — no I/O, unit-tested. Plain text (no Markdown): alert bodies
 *  carry verbatim SMTP messages ("550 …") whose chars would break parsing. */
export function formatAlertText(level: AlertLevel, title: string, body: string): string {
  return `${LEVEL_PREFIX[level]} ${title}\n\n${body}`.slice(0, 4000);
}

/**
 * Send one alert through the configured channel.
 * - Not configured → { ok:false, skipped:true } (logged, no network call).
 * - Sent           → { ok:true, skipped:false, channel }.
 * - Transport/API  → { ok:false, skipped:false, channel, error } (logged, not thrown).
 */
export async function notify(level: AlertLevel, title: string, body: string): Promise<NotifyResult> {
  const channel = activeChannel();
  if (!channel) {
    console.warn(`[notify] channel not configured — skipped alert: ${title}`);
    return { ok: false, skipped: true };
  }
  const text = formatAlertText(level, title, body);
  try {
    switch (channel) {
      case "console":
        console.error(`[alert] ${text}`);
        return { ok: true, skipped: false, channel };
      case "telegram":
        return await sendTelegram(text);
      case "webhook":
        return await sendWebhook(text, level, title);
      case "email":
        return await sendEmail(level, title, text);
    }
  } catch (err) {
    console.error(`[notify] ${channel} transport error: ${(err as Error).message}`);
    return { ok: false, skipped: false, channel, error: (err as Error).message };
  }
}

async function sendTelegram(text: string): Promise<NotifyResult> {
  const { token, chatId } = telegram();
  if (!token || !chatId) return { ok: false, skipped: false, channel: "telegram", error: "telegram not configured" };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[notify] Telegram ${res.status}: ${detail.slice(0, 200)}`);
    return { ok: false, skipped: false, channel: "telegram", error: `Telegram ${res.status}` };
  }
  return { ok: true, skipped: false, channel: "telegram" };
}

async function sendWebhook(text: string, level: AlertLevel, title: string): Promise<NotifyResult> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return { ok: false, skipped: false, channel: "webhook", error: "ALERT_WEBHOOK_URL unset" };
  // `text` (Slack) + `content` (Discord) so one generic webhook works for both.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content: text, alert: { level, title } }),
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  });
  return res.ok
    ? { ok: true, skipped: false, channel: "webhook" }
    : { ok: false, skipped: false, channel: "webhook", error: `webhook ${res.status}` };
}

async function sendEmail(level: AlertLevel, title: string, text: string): Promise<NotifyResult> {
  const key = process.env.ALERT_RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;
  const to = process.env.ALERT_RECIPIENT;
  if (!key || !from || !to) return { ok: false, skipped: false, channel: "email", error: "email not configured" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: `${LEVEL_PREFIX[level]} [MW2] ${title}`, text }),
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  });
  return res.ok
    ? { ok: true, skipped: false, channel: "email" }
    : { ok: false, skipped: false, channel: "email", error: `resend ${res.status}` };
}
