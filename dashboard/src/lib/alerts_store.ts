// ─────────────────────────────────────────────────────────────────────────────
// alerts_store.ts — best-effort persistence + dedup for sent alerts.
//
// Keeps the detectors in alerts.ts pure (no I/O). The cron uses this to:
//   • suppress daily repeats of a PERSISTENT condition (transition-only), and
//   • write an audit trail of what was notified (the §6 "alerts" table).
//
// Both are best-effort: without Supabase configured they degrade gracefully
// (no dedup, no persistence) and never throw — alerting must not break its cron.
// ─────────────────────────────────────────────────────────────────────────────

import type { Alert } from "./alerts";
import type { NotifyResult } from "./notify";
import { getSupabase } from "./supabase";

/**
 * Suppress an identical alert (same client + title) seen within this window.
 * Set just above the 24h cron cadence so a persistent condition alerts once (on
 * transition) instead of every morning, but re-alerts if it clears and recurs.
 */
export const DEDUP_WINDOW_HOURS = 26;

/**
 * True if an identical alert (same client_slug + title) was already recorded
 * within the dedup window. Without a store we cannot dedup → return false and
 * let the alert through (degrades to a daily reminder).
 */
export async function recentlyNotified(
  clientSlug: string,
  title: string,
  windowHours = DEDUP_WINDOW_HOURS
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const since = new Date(Date.now() - windowHours * 3600000).toISOString();
    const { data, error } = await sb
      .from("alerts")
      .select("id")
      .eq("client_slug", clientSlug)
      .eq("title", title)
      .gte("created_at", since)
      .limit(1);
    if (error) return false;
    return !!(data && data.length);
  } catch {
    return false;
  }
}

/** Append an alert to the audit history. Logs (not swallows) insert errors so a
 *  broken audit trail is at least visible; never throws. */
export async function recordAlert(clientSlug: string, alert: Alert, result: NotifyResult): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from("alerts").insert({
      client_slug: clientSlug,
      level: alert.level,
      title: alert.title,
      body: alert.body,
      channel: result.channel ?? null,
      delivered: result.ok,
    });
    if (error) console.error(`[alerts_store] insert ${clientSlug}/${alert.title}: ${error.message}`);
  } catch (err) {
    console.error(`[alerts_store] insert ${clientSlug}/${alert.title}:`, err);
  }
}
