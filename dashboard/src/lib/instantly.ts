// ─────────────────────────────────────────────────────────────────────────────
// Thin server-side client for the Instantly.ai V2 REST API.
//
// Docs: https://developer.instantly.ai/  (V2, Bearer auth)
// We only touch read endpoints needed by the dashboard. All calls are made
// server-side so the API key is never exposed to the browser.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AccountHealth,
  CampaignAnalytics,
  DailyPoint,
} from "./types";

const BASE_URL = "https://api.instantly.ai/api/v2";

class InstantlyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(
  apiKey: string,
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(BASE_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    // Always fetch fresh — this powers a "live" dashboard.
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new InstantlyError(
      `Instantly ${path} → ${res.status} ${res.statusText} ${text.slice(0, 200)}`,
      res.status
    );
  }
  return (await res.json()) as T;
}

// The V2 analytics endpoint returns snake_case fields; some keys vary by plan,
// so we read defensively and normalise to our CampaignAnalytics shape.
type RawCampaignAnalytics = Record<string, unknown>;

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : 0;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function normCampaign(raw: RawCampaignAnalytics): CampaignAnalytics {
  return {
    id: str(raw.campaign_id ?? raw.id, ""),
    name: str(raw.campaign_name ?? raw.name, "Untitled campaign"),
    status: num(raw.campaign_status ?? raw.status),
    leads: num(raw.leads_count),
    contacted: num(raw.contacted_count),
    emailsSent: num(raw.emails_sent_count),
    opens: num(raw.open_count),
    replies: num(raw.reply_count),
    clicks: num(raw.link_click_count),
    bounced: num(raw.bounced_count),
    unsubscribed: num(raw.unsubscribed_count),
    completed: num(raw.completed_count),
    opportunities: num(raw.total_opportunities),
    opportunityValue: num(raw.total_opportunity_value),
  };
}

/** GET /campaigns/analytics — one row per campaign for the date range. */
export async function fetchCampaignAnalytics(
  apiKey: string,
  startDate?: string,
  endDate?: string
): Promise<CampaignAnalytics[]> {
  const data = await api<RawCampaignAnalytics[] | { items: RawCampaignAnalytics[] }>(
    apiKey,
    "/campaigns/analytics",
    { start_date: startDate, end_date: endDate }
  );
  const rows = Array.isArray(data) ? data : data.items ?? [];
  return rows.map(normCampaign).filter((c) => c.id);
}

/** GET /campaigns/analytics/daily — aggregated daily series across campaigns. */
export async function fetchDailyAnalytics(
  apiKey: string,
  startDate?: string,
  endDate?: string
): Promise<DailyPoint[]> {
  const data = await api<RawCampaignAnalytics[] | { items: RawCampaignAnalytics[] }>(
    apiKey,
    "/campaigns/analytics/daily",
    { start_date: startDate, end_date: endDate }
  );
  const rows = Array.isArray(data) ? data : data.items ?? [];
  return rows
    .map((r) => ({
      date: str(r.date),
      sent: num(r.sent),
      opens: num(r.opened ?? r.open_count ?? r.opens),
      replies: num(r.replies ?? r.reply_count),
      clicks: num(r.clicks ?? r.link_click_count),
      bounced: num(r.bounced ?? r.bounced_count),
    }))
    .filter((d) => d.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

type RawAccount = Record<string, unknown>;

function accountStatusLabel(status: number): string {
  switch (status) {
    case 1:
      return "Active";
    case 2:
      return "Paused";
    case -1:
      return "Connection error";
    case -2:
      return "Soft bounce error";
    case -3:
      return "Sending error";
    default:
      return "Unknown";
  }
}

function providerFromEmail(email: string): string {
  const domain = email.split("@")[1] ?? "";
  if (/gmail|googlemail/.test(domain)) return "Google";
  if (/outlook|hotmail|office365|microsoft/.test(domain)) return "Microsoft";
  return domain || "Custom";
}

function normAccount(raw: RawAccount): AccountHealth {
  const email = str(raw.email);
  const status = num(raw.status);
  const warmupScore = num(raw.stat_warmup_score ?? raw.warmup_score);
  const bounceRate = num(raw.bounce_rate);
  const sentToday = num(raw.sent_today ?? raw.emails_sent);
  const dailyLimit = num(raw.daily_limit ?? raw.warmup_limit) || 0;
  // Derive a single 0-100 health score from the strongest signals available.
  const statusPenalty = status < 0 ? 40 : status === 2 ? 15 : 0;
  const bouncePenalty = Math.min(40, bounceRate * 100 * 4);
  const warmupComponent = warmupScore * 0.6;
  const healthScore = Math.max(
    0,
    Math.min(100, Math.round(40 + warmupComponent - statusPenalty - bouncePenalty))
  );
  return {
    email,
    status,
    statusLabel: accountStatusLabel(status),
    warmupStatus: num(raw.warmup_status),
    warmupScore,
    dailyLimit,
    sentToday,
    bounceRate,
    healthScore,
    provider: providerFromEmail(email),
  };
}

/** GET /accounts — paginated; we walk pages up to a sane cap. */
export async function fetchAccounts(apiKey: string): Promise<AccountHealth[]> {
  const out: AccountHealth[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const data = await api<{ items?: RawAccount[]; next_starting_after?: string }>(
      apiKey,
      "/accounts",
      { limit: 100, starting_after: cursor }
    );
    const items = data.items ?? [];
    out.push(...items.map(normAccount));
    if (!data.next_starting_after || items.length === 0) break;
    cursor = data.next_starting_after;
  }
  return out.filter((a) => a.email);
}

export { InstantlyError };
