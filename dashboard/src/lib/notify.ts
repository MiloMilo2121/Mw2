// ─────────────────────────────────────────────────────────────────────────────
// notify.ts — MW2 P0.1/P0.3: a single, pluggable notification channel.
//
// Design goals (from the operating brief §P0):
//   • One human recipient, reconfigurable via env WITHOUT touching code
//     (change ALERT_RECIPIENT / ALERT_CHANNEL — no code change needed).
//   • Provider-agnostic: webhook (Slack/Discord/…), Telegram, email (Resend),
//     or `console` for zero-credential local testing.
//   • No-op when nothing is configured — same philosophy as the mock-data /
//     CRON_SECRET fallbacks elsewhere in the app. Never throws.
//
// This module only ever notifies a human operator (Marco). It sends nothing to
// leads and triggers no Instantly action — it is outside the write guardrails.
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertEvent = {
  clientSlug: string;
  /** Machine kind, e.g. "account_error" | "campaign_status" | "low_open_rate". */
  kind: string;
  severity: AlertSeverity;
  /** One-line human title. */
  title: string;
  /** Multi-line human body (Italian); may include verbatim evidence. */
  body: string;
  /** Structured evidence for audit/persistence. */
  context?: Record<string, unknown>;
};

export type AlertChannel = "telegram" | "email" | "webhook" | "console";

export type NotifyResult = {
  sent: boolean;
  channel?: AlertChannel;
  recipient?: string;
  reason?: string;
};

/**
 * Resolve the active channel from env. Explicit ALERT_CHANNEL wins; otherwise
 * auto-detect from whichever provider credentials are present. Returns null when
 * nothing is configured (→ sendAlert is a no-op).
 */
export function alertChannel(): AlertChannel | null {
  const explicit = (process.env.ALERT_CHANNEL || "").trim().toLowerCase();
  if (
    explicit === "telegram" ||
    explicit === "email" ||
    explicit === "webhook" ||
    explicit === "console"
  ) {
    return explicit;
  }
  if (process.env.ALERT_WEBHOOK_URL) return "webhook";
  if (process.env.ALERT_TELEGRAM_BOT_TOKEN && process.env.ALERT_RECIPIENT) return "telegram";
  if (
    process.env.ALERT_RESEND_API_KEY &&
    process.env.ALERT_EMAIL_FROM &&
    process.env.ALERT_RECIPIENT
  ) {
    return "email";
  }
  return null;
}

const SEV_PREFIX: Record<AlertSeverity, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🔴",
};

/** Pure formatter — no I/O, unit-tested. */
export function formatAlert(e: AlertEvent): { subject: string; text: string } {
  const subject = `${SEV_PREFIX[e.severity]} [MW2] ${e.title}`;
  const text = `${subject}\n\n${e.body}`;
  return { subject, text };
}

function recipient(): string | undefined {
  return (process.env.ALERT_RECIPIENT || "").trim() || undefined;
}

/**
 * Send one alert through the configured channel. Never throws: every failure is
 * captured into the returned NotifyResult so the caller (a cron) is never broken
 * by a notification error.
 */
export async function sendAlert(e: AlertEvent): Promise<NotifyResult> {
  const channel = alertChannel();
  if (!channel) return { sent: false, reason: "no channel configured" };
  const to = recipient();
  const { subject, text } = formatAlert(e);
  try {
    switch (channel) {
      case "console":
        // Zero-credential channel for local/demo verification of the pipeline.
        console.error(`[alert] ${text}`);
        return { sent: true, channel, recipient: to };
      case "webhook":
        return await sendWebhook(text, e);
      case "telegram":
        return await sendTelegram(text, to);
      case "email":
        return await sendEmail(subject, text, to);
    }
  } catch (err) {
    return { sent: false, channel, recipient: to, reason: (err as Error).message };
  }
}

async function sendWebhook(text: string, e: AlertEvent): Promise<NotifyResult> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return { sent: false, channel: "webhook", reason: "ALERT_WEBHOOK_URL unset" };
  // `text` (Slack) + `content` (Discord) so a single generic webhook works for both.
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text,
      content: text,
      alert: { kind: e.kind, severity: e.severity, title: e.title, clientSlug: e.clientSlug },
    }),
  });
  return {
    sent: res.ok,
    channel: "webhook",
    recipient: url,
    reason: res.ok ? undefined : `webhook HTTP ${res.status}`,
  };
}

async function sendTelegram(text: string, to?: string): Promise<NotifyResult> {
  const token = process.env.ALERT_TELEGRAM_BOT_TOKEN;
  if (!token) return { sent: false, channel: "telegram", reason: "ALERT_TELEGRAM_BOT_TOKEN unset" };
  if (!to) return { sent: false, channel: "telegram", reason: "ALERT_RECIPIENT (chat id) unset" };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: to, text, disable_web_page_preview: true }),
  });
  return {
    sent: res.ok,
    channel: "telegram",
    recipient: to,
    reason: res.ok ? undefined : `telegram HTTP ${res.status}`,
  };
}

async function sendEmail(subject: string, text: string, to?: string): Promise<NotifyResult> {
  const key = process.env.ALERT_RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;
  if (!key) return { sent: false, channel: "email", reason: "ALERT_RESEND_API_KEY unset" };
  if (!from) return { sent: false, channel: "email", reason: "ALERT_EMAIL_FROM unset" };
  if (!to) return { sent: false, channel: "email", reason: "ALERT_RECIPIENT (email) unset" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  return {
    sent: res.ok,
    channel: "email",
    recipient: to,
    reason: res.ok ? undefined : `resend HTTP ${res.status}`,
  };
}
