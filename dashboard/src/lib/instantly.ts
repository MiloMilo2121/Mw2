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
    opensUnique: num(raw.open_count_unique),
    replies: num(raw.reply_count),
    repliesUnique: num(raw.reply_count_unique),
    clicks: num(raw.link_click_count),
    clicksUnique: num(raw.link_click_count_unique),
    bounced: num(raw.bounced_count),
    unsubscribed: num(raw.unsubscribed_count),
    completed: num(raw.completed_count),
    opportunities: num(raw.total_opportunities),
    opportunityValue: num(raw.total_opportunity_value),
  };
}

/** GET /campaigns/analytics/steps — per-step + A/B variant performance. */
export async function fetchCampaignSteps(
  apiKey: string,
  campaignId: string,
  startDate?: string,
  endDate?: string
): Promise<import("./types").CampaignStep[]> {
  const data = await api<RawCampaignAnalytics[] | { items: RawCampaignAnalytics[] }>(
    apiKey,
    "/campaigns/analytics/steps",
    { campaign_id: campaignId, start_date: startDate, end_date: endDate }
  );
  const rows = Array.isArray(data) ? data : data.items ?? [];
  return rows
    .map((r) => ({
      step: num(r.step),
      variant: str(r.variant, "0"),
      sent: num(r.sent),
      opened: num(r.opened),
      uniqueOpened: num(r.unique_opened),
      replies: num(r.replies),
      clicks: num(r.clicks),
    }))
    .sort((a, b) => a.step - b.step || a.variant.localeCompare(b.variant));
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

/** GET /campaigns/analytics/daily — daily series (optionally one campaign). */
export async function fetchDailyAnalytics(
  apiKey: string,
  startDate?: string,
  endDate?: string,
  campaignId?: string
): Promise<DailyPoint[]> {
  const data = await api<RawCampaignAnalytics[] | { items: RawCampaignAnalytics[] }>(
    apiKey,
    "/campaigns/analytics/daily",
    { start_date: startDate, end_date: endDate, campaign_id: campaignId }
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

/** Sum daily series across several campaigns into a single per-date series. */
export async function fetchDailyForCampaigns(
  apiKey: string,
  campaignIds: string[],
  startDate?: string,
  endDate?: string
): Promise<DailyPoint[]> {
  const series = await Promise.all(
    campaignIds.map((id) => fetchDailyAnalytics(apiKey, startDate, endDate, id))
  );
  const byDate = new Map<string, DailyPoint>();
  for (const s of series) {
    for (const d of s) {
      const cur = byDate.get(d.date) ?? {
        date: d.date,
        sent: 0,
        opens: 0,
        replies: 0,
        clicks: 0,
        bounced: 0,
      };
      cur.sent += d.sent;
      cur.opens += d.opens;
      cur.replies += d.replies;
      cur.clicks += d.clicks;
      cur.bounced += d.bounced;
      byDate.set(d.date, cur);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Whether a campaign/lead name matches any of the client's keywords. */
export function matchesKeywords(name: string, keywords?: string[]): boolean {
  if (!keywords || keywords.length === 0) return true;
  const n = name.toLowerCase();
  return keywords.some((k) => n.includes(k.toLowerCase()));
}

type CampaignLite = { id: string; name: string; status: number; accounts: string[] };

/** GET /campaigns — light list incl. each campaign's sending accounts (email_list). */
export async function fetchCampaignsLite(apiKey: string): Promise<CampaignLite[]> {
  const out: CampaignLite[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const data = await api<{ items?: Record<string, unknown>[]; next_starting_after?: string }>(
      apiKey,
      "/campaigns",
      { limit: 100, starting_after: cursor }
    );
    const items = data.items ?? [];
    for (const c of items) {
      out.push({
        id: str(c.id),
        name: str(c.name),
        status: num(c.status),
        accounts: Array.isArray(c.email_list) ? (c.email_list as unknown[]).map((e) => String(e)) : [],
      });
    }
    if (!data.next_starting_after || items.length === 0) break;
    cursor = data.next_starting_after;
  }
  return out.filter((c) => c.id);
}

/**
 * Resolve the set of campaign IDs this client is scoped to.
 * Prefers matching by SENDING ACCOUNT (accountKeywords); falls back to campaign
 * NAME keywords; returns null when there is no scope (all campaigns).
 */
export async function getScopedCampaignIds(
  apiKey: string,
  opts: { accountKeywords?: string[]; nameKeywords?: string[] }
): Promise<Set<string> | null> {
  if (opts.accountKeywords && opts.accountKeywords.length) {
    const camps = await fetchCampaignsLite(apiKey);
    const ids = camps
      .filter((c) => c.accounts.some((a) => matchesKeywords(a, opts.accountKeywords)))
      .map((c) => c.id);
    return new Set(ids);
  }
  if (opts.nameKeywords && opts.nameKeywords.length) {
    const camps = await fetchCampaignAnalytics(apiKey);
    return new Set(camps.filter((c) => matchesKeywords(c.name, opts.nameKeywords)).map((c) => c.id));
  }
  return null;
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
  const dailyLimit = num(raw.daily_limit ?? raw.warmup_limit) || 0;
  // Instantly's /accounts endpoint does not expose a per-account bounce rate, so
  // we derive a 0-100 health score from warmup score + account status, which are
  // the strongest signals available there.
  const statusPenalty = status < 0 ? 45 : status === 2 ? 15 : 0;
  const healthScore = Math.max(
    0,
    Math.min(100, Math.round(35 + warmupScore * 0.65 - statusPenalty))
  );
  return {
    email,
    status,
    statusLabel: accountStatusLabel(status),
    warmupStatus: num(raw.warmup_status),
    warmupScore,
    dailyLimit,
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

// ── Leads (per-contact engagement) ───────────────────────────────────────────

function leadStatusLabel(status: number): string {
  switch (status) {
    case 1:
      return "Active";
    case 2:
      return "Completed";
    case 3:
      return "Unsubscribed";
    case -1:
      return "Bounced";
    case -2:
      return "Stopped";
    default:
      return "—";
  }
}

type RawLead = Record<string, unknown>;

function normLead(raw: RawLead): import("./types").Lead {
  const email = str(raw.email);
  const status = num(raw.status);
  const lc = raw.timestamp_last_contact;
  const lo = raw.timestamp_last_open;
  // Custom fields live in `payload` (varies per import).
  const p = (raw.payload && typeof raw.payload === "object" ? raw.payload : {}) as Record<
    string,
    unknown
  >;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = p[k] ?? (raw as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  return {
    id: str(raw.id, email),
    email,
    firstName: str(raw.first_name) || pick("firstName", "first_name"),
    lastName: str(raw.last_name) || pick("lastName", "last_name"),
    company: str(raw.company_name) || pick("companyName", "company_name", "company"),
    jobTitle: str(raw.job_title) || pick("jobTitle", "title", "role"),
    website: str(raw.website) || pick("website", "websiteUrl", "company_url"),
    city: pick("city", "location", "citta"),
    linkedin: pick("linkedIn", "linkedin", "linkedinUrl", "linkedin_url"),
    phone: pick("phone", "phoneNumber", "telefono"),
    quality: "",
    result: "",
    verified: false,
    opens: num(raw.email_open_count),
    clicks: num(raw.email_click_count),
    replies: num(raw.email_reply_count),
    status,
    statusLabel: leadStatusLabel(status),
    campaignId: str(raw.campaign),
    lastContact: typeof lc === "string" ? lc : null,
    lastOpen: typeof lo === "string" ? lo : null,
  };
}

/**
 * POST /leads/list — walk pages up to `maxLeads` and return normalised leads.
 * `campaignId` optionally scopes to one campaign.
 */
export async function fetchLeads(
  apiKey: string,
  opts: { maxLeads?: number; campaignId?: string } = {}
): Promise<import("./types").Lead[]> {
  const maxLeads = opts.maxLeads ?? 1000;
  const out: import("./types").Lead[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < Math.ceil(maxLeads / 100); page++) {
    const body: Record<string, unknown> = { limit: 100 };
    if (cursor) body.starting_after = cursor;
    if (opts.campaignId) body.campaign = opts.campaignId;
    const res = await fetch(BASE_URL + "/leads/list", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new InstantlyError(`Instantly /leads/list → ${res.status} ${text.slice(0, 200)}`, res.status);
    }
    const data = (await res.json()) as { items?: RawLead[]; next_starting_after?: string };
    const items = data.items ?? [];
    out.push(...items.map(normLead));
    if (!data.next_starting_after || items.length === 0 || out.length >= maxLeads) break;
    cursor = data.next_starting_after;
  }
  return out.filter((l) => l.email);
}

export { InstantlyError };
