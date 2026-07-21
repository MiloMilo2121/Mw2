// ─────────────────────────────────────────────────────────────────────────────
// notify.ts — P0.1: the single outbound alert channel for MW2.
//
// Provider: Telegram Bot API. The recipient is env-driven (TELEGRAM_CHAT_ID) so
// it can be re-pointed WITHOUT a deploy — the "presidio agosto" requirement:
// an alert with no configurable recipient is an alert that doesn't exist.
//
// Guardrail parity with the cron (root CLAUDE.md §3.4): when the channel isn't
// configured (missing bot token or chat id), notify() is a logged no-op that
// returns { skipped: true } and never throws. Alerting must never break its
// caller — a down Telegram must not take the 07:00 automations cron with it.
//
// Env:
//   TELEGRAM_BOT_TOKEN  — bot token from @BotFather
//   TELEGRAM_CHAT_ID    — destination chat/channel id (the reconfigurable recipient)
// ─────────────────────────────────────────────────────────────────────────────

export type AlertLevel = "info" | "warn" | "crit";

export type NotifyResult = {
  ok: boolean;
  skipped: boolean;
  error?: string;
};

const LEVEL_PREFIX: Record<AlertLevel, string> = {
  info: "ℹ️",
  warn: "⚠️",
  crit: "🚨",
};

function readConfig(): { token?: string; chatId?: string } {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  };
}

/** True when both bot token and recipient chat id are set. */
export function isNotifyConfigured(): boolean {
  const { token, chatId } = readConfig();
  return Boolean(token && chatId);
}

/**
 * Send one alert to the configured Telegram chat.
 *
 * - Not configured  → { ok: false, skipped: true } (logged, no network call).
 * - Sent            → { ok: true, skipped: false }.
 * - Transport/API   → { ok: false, skipped: false, error } (logged, not thrown).
 *
 * Plain text (no parse_mode) on purpose: alert bodies carry verbatim SMTP
 * messages (e.g. "550 5.4.5 …"), whose characters would break Markdown parsing
 * and turn a real alert into a silent 400. Robustness beats formatting here.
 */
export async function notify(
  level: AlertLevel,
  title: string,
  body: string
): Promise<NotifyResult> {
  const { token, chatId } = readConfig();
  if (!token || !chatId) {
    console.warn(`[notify] channel not configured — skipped alert: ${title}`);
    return { ok: false, skipped: true };
  }

  const text = `${LEVEL_PREFIX[level]} ${title}\n\n${body}`.slice(0, 4000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[notify] Telegram ${res.status}: ${detail.slice(0, 200)}`);
      return { ok: false, skipped: false, error: `Telegram ${res.status}` };
    }
    return { ok: true, skipped: false };
  } catch (err) {
    console.error(`[notify] transport error: ${(err as Error).message}`);
    return { ok: false, skipped: false, error: (err as Error).message };
  }
}
