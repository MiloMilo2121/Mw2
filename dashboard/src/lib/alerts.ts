// ─────────────────────────────────────────────────────────────────────────────
// alerts.ts — MW2 P0.2: evaluate a client's live Instantly data and produce
// AlertEvents. Split into PURE evaluators (unit-tested, no I/O) plus a thin
// orchestrator (gatherAlerts) and best-effort persistence/dedup helpers.
//
// gatherAlerts reuses buildSnapshot() (metrics.ts) rather than re-deriving reads:
// the snapshot already scopes accounts (accountMatch), campaigns and the daily
// series to THIS client, and overrides campaign status with the authoritative
// /campaigns value. Re-implementing the reads here previously dropped all of
// that scoping and read a status field that is never negative — so the alerts
// silently missed the exact incidents they exist to catch.
//
// No new Instantly writes: only existing read endpoints from instantly.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { AccountHealth, CampaignAnalytics, ClientConfig } from "./types";
import type { AlertEvent, NotifyResult } from "./notify";
import { fetchCampaignAnalytics, matchesKeywords } from "./instantly";
import { buildSnapshot } from "./metrics";
import { getSupabase } from "./supabase";

/** Yesterday's UNIQUE-opens-over-sent below this ⇒ alert (P0.2 b). */
export const LOW_OPEN_RATE_THRESHOLD = 0.1;
/** Only alert on open-rate when at least this many were sent (avoid noise). */
export const MIN_SENT_FOR_OPEN_ALERT = 20;
/**
 * Suppress an identical alert (same client+kind+title) seen within this window.
 * Set just above the 24h cron cadence so a PERSISTENT condition alerts once (on
 * transition) instead of every morning, but re-alerts if it clears and recurs.
 */
export const DEDUP_WINDOW_HOURS = 26;

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

/**
 * (a) Campaigns in a negative/error status. Input is expected pre-scoped to the
 * client (buildSnapshot does this); the campaignMatch filter is a harmless
 * belt-and-braces for callers that pass an unscoped list.
 */
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

/** Aggregated yesterday figures for the open-rate check (unique opens). */
export type OpenRateDay = { date: string; sent: number; opensUnique: number };

/** (b) Yesterday's UNIQUE open rate collapsed below threshold (with volume). */
export function evalOpenRate(client: ClientConfig, day: OpenRateDay | null): AlertEvent[] {
  if (!day || day.sent < MIN_SENT_FOR_OPEN_ALERT) return [];
  const rate = day.opensUnique / day.sent;
  if (rate >= LOW_OPEN_RATE_THRESHOLD) return [];
  return [
    {
      clientSlug: client.slug,
      kind: "low_open_rate",
      severity: "warning",
      title: `${client.name} · open rate crollato (${pct(rate)} il ${day.date})`,
      body:
        `Il ${day.date}: ${day.opensUnique} aperture uniche su ${day.sent} invii = ${pct(rate)} ` +
        `(soglia ${pct(LOW_OPEN_RATE_THRESHOLD)}).\n` +
        `Possibile problema di deliverability o di tracking.`,
      context: { date: day.date, sent: day.sent, opensUnique: day.opensUnique, rate },
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
 * The live Instantly read failed and buildSnapshot fell back to mock data — we
 * are BLIND for this client this run. That silence is itself the signal P0 must
 * surface, so we alert instead of evaluating fake data.
 */
export function instantlyUnreachable(client: ClientConfig): AlertEvent {
  return {
    clientSlug: client.slug,
    kind: "instantly_unreachable",
    severity: "critical",
    title: `${client.name} · Instantly non raggiungibile`,
    body:
      `Le letture Instantly del cron sono fallite (fallback su dati mock). ` +
      `Impossibile valutare account/campagne/aperture per ${client.slug} in questo run — ` +
      `verifica la chiave API e lo stato del servizio.`,
    context: { source: "mock" },
  };
}

/**
 * (c) Quota guard — DEFERRED within P0. "Σ per casella (campagne+warmup) > cap−10%"
 * needs per-mailbox daily send volume, which the current read endpoints don't
 * expose (/accounts gives the cap/daily_limit but not today's actual sends).
 * Left as a documented stub so the framework is ready.
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

export type GatherOpts = { automationSummary?: unknown; now?: Date };

/** Read the client's live data (via buildSnapshot) and produce its alert events. */
export async function gatherAlerts(client: ClientConfig, opts: GatherOpts = {}): Promise<AlertEvent[]> {
  const key = client.instantlyApiKey;
  if (!key) return [];
  const now = opts.now ?? new Date();

  // buildSnapshot scopes accounts/campaigns/daily to this client and applies the
  // authoritative campaign status — reuse it instead of re-deriving reads.
  const snapshot = await buildSnapshot(client);

  // buildSnapshot swallows Instantly errors and falls back to mock. For a live
  // client that means the read failed → don't evaluate fake data; alert blind.
  if (snapshot.source === "mock") {
    return [instantlyUnreachable(client), ...evalAutomationFailure(client, opts.automationSummary)];
  }

  const events: AlertEvent[] = [
    ...evalAccountErrors(client, snapshot.accounts),
    ...evalCampaignStatus(client, snapshot.campaigns),
    ...evalAutomationFailure(client, opts.automationSummary),
    ...evalQuotaGuard(client, snapshot.accounts),
  ];

  // Yesterday's UNIQUE open rate, scoped to this client's campaigns. The daily
  // series carries only non-unique opens, so read per-campaign analytics for the
  // single day and sum unique opens / sent across the client's scoped campaigns.
  const y = isoDay(new Date(now.getTime() - 86400000));
  const yCampaigns = await safe<CampaignAnalytics[] | null>(() => fetchCampaignAnalytics(key, y, y), null);
  if (yCampaigns) {
    const scoped = new Set(snapshot.campaigns.map((c) => c.id));
    const mine = yCampaigns.filter((c) => scoped.has(c.id));
    const sent = mine.reduce((s, c) => s + c.emailsSent, 0);
    const opensUnique = mine.reduce((s, c) => s + c.opensUnique, 0);
    events.push(...evalOpenRate(client, sent ? { date: y, sent, opensUnique } : null));
  }

  return events;
}

/**
 * True if an identical alert (same client+kind+title) was already recorded
 * within DEDUP_WINDOW_HOURS — used to suppress daily repeats of a persistent
 * condition. Without a store (Supabase unset) we cannot dedup, so we return
 * false and let the alert through (degrades to a daily reminder).
 */
export async function recentlyAlerted(event: AlertEvent, windowHours = DEDUP_WINDOW_HOURS): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const since = new Date(Date.now() - windowHours * 3600000).toISOString();
    const { data, error } = await sb
      .from("alerts")
      .select("id")
      .eq("client_slug", event.clientSlug)
      .eq("kind", event.kind)
      .eq("title", event.title)
      .gte("created_at", since)
      .limit(1);
    if (error) return false;
    return !!(data && data.length);
  } catch {
    return false;
  }
}

/**
 * Best-effort persistence of a sent alert (audit/history). Never blocks or
 * throws; a failed insert is logged (not silently swallowed) so a broken audit
 * trail is at least visible in the logs.
 */
export async function persistAlert(event: AlertEvent, result: NotifyResult): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from("alerts").insert({
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
    if (error) console.error(`[persistAlert] ${event.kind}/${event.clientSlug}: ${error.message}`);
  } catch (err) {
    console.error(`[persistAlert] ${event.kind}/${event.clientSlug}:`, err);
  }
}
