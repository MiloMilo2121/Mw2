// ─────────────────────────────────────────────────────────────────────────────
// alerts.ts — MW2 P0.2: evaluate the client's live Instantly data and produce
// AlertEvents. Split into PURE evaluators (unit-tested, no I/O) plus a thin
// orchestrator that does the reads and a best-effort persistence helper.
//
// No new Instantly writes: this only consumes existing read endpoints from
// instantly.ts (the choke point) and notifies via notify.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { AccountHealth, CampaignAnalytics, ClientConfig, DailyPoint } from "./types";
import type { AlertEvent, NotifyResult } from "./notify";
import { fetchAccounts, fetchCampaignAnalytics, fetchDailyAnalytics, matchesKeywords } from "./instantly";
import { getSupabase } from "./supabase";

/** Yesterday's unique-opens-over-sent below this ⇒ alert (P0.2 b). */
export const LOW_OPEN_RATE_THRESHOLD = 0.1;
/** Only alert on open-rate when at least this many were sent (avoid noise). */
export const MIN_SENT_FOR_OPEN_ALERT = 20;

function pct(x: number): string {
  return `${Math.round(x * 1000) / 10}%`;
}

// ── Pure evaluators ──────────────────────────────────────────────────────────

/** (a) Sending accounts in an error state (status < 0, e.g. -3 "Errore invio"). */
export function evalAccountErrors(client: ClientConfig, accounts: AccountHealth[]): AlertEvent[] {
  return accounts
    .filter((a) => a.status < 0)
    .map((a) => ({
      clientSlug: client.slug,
      kind: "account_error",
      severity: "critical" as const,
      title: `${client.name} · casella in errore: ${a.email} (${a.statusLabel})`,
      body:
        `Account ${a.email} — status ${a.status} (${a.statusLabel}).` +
        (a.statusMessage ? `\nMessaggio provider: ${a.statusMessage}` : "") +
        `\nGli invii da questa casella sono fermi finché non rientra.`,
      context: {
        email: a.email,
        status: a.status,
        statusLabel: a.statusLabel,
        statusMessage: a.statusMessage ?? null,
      },
    }));
}

/** (a) Campaigns in a negative/error status, scoped to the client's campaigns. */
export function evalCampaignStatus(client: ClientConfig, campaigns: CampaignAnalytics[]): AlertEvent[] {
  return campaigns
    .filter((c) => matchesKeywords(c.name, client.campaignMatch))
    .filter((c) => c.status < 0)
    .map((c) => ({
      clientSlug: client.slug,
      kind: "campaign_status",
      severity: "critical" as const,
      title: `${client.name} · campagna in errore: ${c.name}`,
      body: `Campagna "${c.name}" (${c.id}) è in status ${c.status} (negativo). Verifica account/deliverability.`,
      context: { id: c.id, name: c.name, status: c.status },
    }));
}

/** (b) Yesterday's open rate collapsed below threshold (with enough volume). */
export function evalOpenRate(client: ClientConfig, day: DailyPoint | null): AlertEvent[] {
  if (!day || day.sent < MIN_SENT_FOR_OPEN_ALERT) return [];
  const rate = day.opens / day.sent;
  if (rate >= LOW_OPEN_RATE_THRESHOLD) return [];
  return [
    {
      clientSlug: client.slug,
      kind: "low_open_rate",
      severity: "warning",
      title: `${client.name} · open rate crollato (${pct(rate)} il ${day.date})`,
      body:
        `Il ${day.date}: ${day.opens} aperture su ${day.sent} invii = ${pct(rate)} ` +
        `(soglia ${pct(LOW_OPEN_RATE_THRESHOLD)}).\n` +
        `Possibile problema di deliverability o di tracking. ` +
        `Nota: le aperture giornaliere non sono deduplicate.`,
      context: { date: day.date, sent: day.sent, opens: day.opens, rate },
    },
  ];
}

/** (d, bonus) The 07:00 automation cron reported errors — today these are silent. */
export function evalAutomationFailure(client: ClientConfig, summary: unknown): AlertEvent[] {
  const errors = collectErrors(summary);
  if (!errors.length) return [];
  return [
    {
      clientSlug: client.slug,
      kind: "automation_failure",
      severity: "warning",
      title: `${client.name} · errori nel cron automazioni (${errors.length})`,
      body: `Il cron automazioni (07:00) ha riportato errori:\n- ${errors.join("\n- ")}`,
      context: { errors },
    },
  ];
}

/**
 * (c) Quota guard — DEFERRED within P0. "Σ per casella (campagne+warmup) > cap−10%"
 * needs per-mailbox daily send volume, which the current read endpoints don't
 * expose (/accounts gives the cap/daily_limit but not today's actual sends).
 * Left as a documented stub so the framework is ready; implement once a
 * per-account daily-volume read exists.
 */
export function evalQuotaGuard(_client: ClientConfig, _accounts: AccountHealth[]): AlertEvent[] {
  return [];
}

/** Walk the cron per-client summary object for error strings/counts. */
export function collectErrors(summary: unknown): string[] {
  const out: string[] = [];
  if (!summary || typeof summary !== "object") return out;
  for (const [key, val] of Object.entries(summary as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    if (typeof v.error === "string") out.push(`${key}: ${v.error}`);
    if (Array.isArray(v.errors)) {
      for (const e of v.errors) if (e) out.push(`${key}: ${String(e)}`);
    } else if (typeof v.errors === "number" && v.errors > 0) {
      out.push(`${key}: ${v.errors} errori`);
    }
  }
  return out;
}

// ── Orchestration (I/O) ──────────────────────────────────────────────────────

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Pick the row for (today-1) in UTC, or null if absent. */
export function pickYesterday(daily: DailyPoint[], today: Date): DailyPoint | null {
  const y = isoDay(new Date(today.getTime() - 86400000));
  return daily.find((d) => d.date === y) ?? null;
}

export type GatherOpts = { automationSummary?: unknown; now?: Date };

/** Read the client's live data and produce all alert events for it. */
export async function gatherAlerts(client: ClientConfig, opts: GatherOpts = {}): Promise<AlertEvent[]> {
  const key = client.instantlyApiKey;
  if (!key) return [];
  const now = opts.now ?? new Date();
  const end = isoDay(now);
  const start7 = isoDay(new Date(now.getTime() - 7 * 86400000));
  const start3 = isoDay(new Date(now.getTime() - 3 * 86400000));

  const [accounts, campaigns, daily] = await Promise.all([
    safe(() => fetchAccounts(key), [] as AccountHealth[]),
    safe(() => fetchCampaignAnalytics(key, start7, end), [] as CampaignAnalytics[]),
    safe(() => fetchDailyAnalytics(key, start3, end), [] as DailyPoint[]),
  ]);

  return [
    ...evalAccountErrors(client, accounts),
    ...evalCampaignStatus(client, campaigns),
    ...evalOpenRate(client, pickYesterday(daily, now)),
    ...evalAutomationFailure(client, opts.automationSummary),
    ...evalQuotaGuard(client, accounts),
  ];
}

/**
 * Best-effort persistence of a sent alert (audit/history). Never blocks or
 * throws: the notification has already been delivered by the time we get here.
 */
export async function persistAlert(event: AlertEvent, result: NotifyResult): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("alerts").insert({
      client_slug: event.clientSlug,
      kind: event.kind,
      severity: event.severity,
      title: event.title,
      body: event.body,
      context: event.context ?? null,
      channel: result.channel ?? null,
      recipient: result.recipient ?? null,
      delivered: result.sent,
    });
  } catch {
    // swallow — persistence is secondary to delivery
  }
}
