// ─────────────────────────────────────────────────────────────────────────────
// alerts.ts — P0.2: pure detection of the three vital alerts.
//
// These functions take already-fetched, normalised data and return Alert[].
// They are deliberately side-effect free (no fetch, no notify) so the logic is
// unit-testable offline — including the DoD: a simulated 550 must produce an
// alert. The cron (api/cron/automations) fetches the data, runs these, and
// hands each Alert to notify().
// ─────────────────────────────────────────────────────────────────────────────

import type { AccountHealth } from "./types";
import type { CampaignLite } from "./instantly";
import type { AlertLevel } from "./notify";

export type Alert = { level: AlertLevel; title: string; body: string };

// Thresholds (root CLAUDE.md §4 · P0.2).
export const OPEN_RATE_FLOOR = 0.1; // open_unici/inviate below this → alert
export const OPEN_RATE_MIN_SENT = 20; // only when the day sent at least this many
export const QUOTA_HEADROOM = 0.1; // flag when load > cap − 10%

/**
 * (a) Account send errors — the 550 class. Any account in a negative status is
 * surfaced with its status_message VERBATIM (that's where Google's "550 …" text
 * lives). status -3 (Errore invio) is the send-blocking case → crit.
 */
export function detectAccountAlerts(accounts: AccountHealth[], clientName: string): Alert[] {
  const alerts: Alert[] = [];
  for (const a of accounts) {
    if (a.status >= 0) continue;
    const level: AlertLevel = a.status <= -3 ? "crit" : "warn";
    const msg = (a.statusMessage ?? "").trim();
    alerts.push({
      level,
      title: `[${clientName}] Account in errore: ${a.email}`,
      body:
        `Stato: ${a.statusLabel} (${a.status}).` +
        (msg ? `\nMessaggio: ${msg}` : "\nMessaggio: (non fornito da Instantly)"),
    });
  }
  return alerts;
}

/** (a-bis) Campaigns sitting in a negative status (paused-on-error / errored). */
export function detectCampaignAlerts(campaigns: CampaignLite[], clientName: string): Alert[] {
  const alerts: Alert[] = [];
  for (const c of campaigns) {
    if (c.status >= 0) continue;
    alerts.push({
      level: "crit",
      title: `[${clientName}] Campagna in stato negativo`,
      body: `${c.name} — status ${c.status}.`,
    });
  }
  return alerts;
}

/**
 * (b) Yesterday's open rate collapsed. Fires only with a meaningful volume
 * (sent ≥ OPEN_RATE_MIN_SENT) so a tiny day can't trip it.
 *
 * NOTE: the daily analytics endpoint exposes total opens per day, not unique.
 * We treat `opens` as the numerator; being an upper bound, this is conservative
 * (it never over-alerts). Swap to unique opens if/when a per-day unique series
 * is available.
 */
export function detectOpenRateAlert(
  point: { sent: number; opens: number },
  dateLabel: string,
  clientName: string
): Alert | null {
  if (point.sent < OPEN_RATE_MIN_SENT) return null;
  const rate = point.opens / point.sent;
  if (rate >= OPEN_RATE_FLOOR) return null;
  return {
    level: "warn",
    title: `[${clientName}] Open rate crollato (${dateLabel})`,
    body:
      `Aperture ${point.opens} / inviate ${point.sent} = ${(rate * 100).toFixed(1)}% ` +
      `(soglia ${OPEN_RATE_FLOOR * 100}%). Possibile problema deliverability o tracking.`,
  };
}

/**
 * (c) Quota guard — per mailbox, campaign+warmup load approaching the cap.
 * Pure over { email, cap, load }; the cron supplies cap/load per account.
 */
export function detectQuotaAlerts(
  mailboxes: { email: string; cap: number; load: number }[],
  clientName: string
): Alert[] {
  const alerts: Alert[] = [];
  for (const m of mailboxes) {
    if (m.cap <= 0) continue;
    if (m.load > m.cap * (1 - QUOTA_HEADROOM)) {
      alerts.push({
        level: "warn",
        title: `[${clientName}] Casella vicina al cap: ${m.email}`,
        body: `Carico ${m.load} / cap ${m.cap} (margine < ${QUOTA_HEADROOM * 100}%).`,
      });
    }
  }
  return alerts;
}
