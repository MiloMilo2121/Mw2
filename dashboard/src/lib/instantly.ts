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

export type CampaignLite = { id: string; name: string; status: number; accounts: string[] };

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
 * Current (live) campaigns in this client's scope — by sending account OR by
 * name. Includes drafts/paused (which have no analytics rows yet), so the
 * dashboard can list every campaign that belongs to the client.
 */
export async function getScopedLiteCampaigns(
  apiKey: string,
  opts: { accountKeywords?: string[]; nameKeywords?: string[] }
): Promise<CampaignLite[] | null> {
  const hasAcct = !!(opts.accountKeywords && opts.accountKeywords.length);
  const hasName = !!(opts.nameKeywords && opts.nameKeywords.length);
  if (!hasAcct && !hasName) return null;
  const camps = await fetchCampaignsLite(apiKey);
  return camps.filter(
    (c) =>
      (hasAcct && c.accounts.some((a) => matchesKeywords(a, opts.accountKeywords))) ||
      (hasName && matchesKeywords(c.name, opts.nameKeywords))
  );
}

/**
 * Resolve the set of campaign IDs this client is scoped to — the UNION of:
 *  - campaigns that SEND from a matching account (accountKeywords), and
 *  - campaigns whose NAME matches (nameKeywords), over a wide window so
 *    historical / duplicated ("copy") campaigns are included too.
 * Returns null when there is no scope (all campaigns).
 */
export async function getScopedCampaignIds(
  apiKey: string,
  opts: { accountKeywords?: string[]; nameKeywords?: string[] }
): Promise<Set<string> | null> {
  const hasAcct = !!(opts.accountKeywords && opts.accountKeywords.length);
  const hasName = !!(opts.nameKeywords && opts.nameKeywords.length);
  if (!hasAcct && !hasName) return null;

  const ids = new Set<string>();
  if (hasAcct) {
    const camps = await fetchCampaignsLite(apiKey);
    for (const c of camps) {
      if (c.accounts.some((a) => matchesKeywords(a, opts.accountKeywords))) ids.add(c.id);
    }
  }
  if (hasName) {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const camps = await fetchCampaignAnalytics(apiKey, start, end);
    for (const c of camps) {
      if (matchesKeywords(c.name, opts.nameKeywords)) ids.add(c.id);
    }
  }
  return ids;
}

type RawAccount = Record<string, unknown>;

function accountStatusLabel(status: number): string {
  switch (status) {
    case 1:
      return "Attivo";
    case 2:
      return "In pausa";
    case -1:
      return "Errore connessione";
    case -2:
      return "Errore soft bounce";
    case -3:
      return "Errore invio";
    default:
      return "Sconosciuto";
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
      return "Attivo";
    case 2:
      return "Completato";
    case 3:
      return "Disiscritto";
    case -1:
      return "Rimbalzato";
    case -2:
      return "Fermato";
    default:
      return "—";
  }
}

type RawLead = Record<string, unknown>;

// Instantly lead interest status (lt_interest_status).
function interestLabel(v: number): string {
  switch (v) {
    case 1:
      return "Interessato";
    case 2:
      return "Meeting fissato";
    case 3:
      return "Meeting fatto";
    case 4:
      return "Chiuso / Vinto";
    case 0:
      return "Out of office";
    case -1:
      return "Non interessato";
    case -2:
      return "Persona sbagliata";
    case -3:
      return "Perso";
    default:
      return "";
  }
}

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
    interestStatus: num(raw.lt_interest_status),
    interestLabel: interestLabel(num(raw.lt_interest_status)),
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

// ── Automation helpers ───────────────────────────────────────────────────────

/** Raw lead objects for a campaign (keeps status_summary etc. for automations). */
export async function fetchRawCampaignLeads(
  apiKey: string,
  campaignId: string,
  maxLeads = 2000
): Promise<RawLead[]> {
  const out: RawLead[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < Math.ceil(maxLeads / 100); page++) {
    const body: Record<string, unknown> = { limit: 100, campaign: campaignId };
    if (cursor) body.starting_after = cursor;
    const res = await fetch(BASE_URL + "/leads/list", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) throw new InstantlyError(`/leads/list ${res.status}`, res.status);
    const data = (await res.json()) as { items?: RawLead[]; next_starting_after?: string };
    const items = data.items ?? [];
    out.push(...items);
    if (!data.next_starting_after || items.length === 0 || out.length >= maxLeads) break;
    cursor = data.next_starting_after;
  }
  return out;
}

/**
 * Add leads (by email + fields) to a destination campaign. LIVE write.
 *
 * Instantly's V2 create endpoint is `POST /leads` (one lead per call). We must
 * pass skip_if_in_campaign/skip_if_in_workspace = false, otherwise a lead that
 * already exists in the SOURCE campaign is skipped and never copied into the
 * target. To stay idempotent (the daily cron re-runs), we first read the emails
 * already in the target and only create the missing ones — so re-runs add zero.
 */
export async function addLeadsToCampaign(
  apiKey: string,
  campaignId: string,
  leads: Array<Record<string, unknown>>
): Promise<{ ok: boolean; added: number; skipped: number; errors: number }> {
  // Emails already in the target campaign → skip them (no duplicates on re-run).
  let existing = new Set<string>();
  try {
    const cur = await fetchRawCampaignLeads(apiKey, campaignId, 5000);
    existing = new Set(cur.map((l) => String(l.email ?? "").toLowerCase()).filter(Boolean));
  } catch {
    // If we can't read the target, fall through and rely on create-time dedup.
  }

  let added = 0, skipped = 0, errors = 0;
  for (const l of leads) {
    const email = String(l.email ?? "").toLowerCase();
    if (!email) { errors++; continue; }
    if (existing.has(email)) { skipped++; continue; }
    try {
      const res = await fetch(BASE_URL + "/leads", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign: campaignId,
          email: l.email,
          first_name: l.first_name ?? "",
          last_name: l.last_name ?? "",
          company_name: l.company_name ?? "",
          skip_if_in_campaign: false,
          skip_if_in_workspace: false,
        }),
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; campaign?: string };
      if (res.ok && j.id && j.campaign === campaignId) { added++; existing.add(email); }
      else errors++;
    } catch {
      errors++;
    }
  }
  return { ok: errors === 0, added, skipped, errors };
}

/** A raw email/message object from the Instantly unibox (`/emails`). */
export type RawEmail = Record<string, unknown>;

/**
 * Fetch emails for a campaign from the Instantly unibox. `ue_type === 2` marks an
 * inbound reply from the prospect (1 = a message we sent). Paginated like leads.
 */
export async function fetchEmails(
  apiKey: string,
  opts: { campaignId?: string; maxEmails?: number } = {}
): Promise<RawEmail[]> {
  const { campaignId, maxEmails = 1000 } = opts;
  const out: RawEmail[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < Math.ceil(maxEmails / 100); page++) {
    const data = await api<{ items?: RawEmail[]; next_starting_after?: string }>(
      apiKey,
      "/emails",
      { limit: 100, campaign_id: campaignId, starting_after: cursor }
    );
    const items = data.items ?? [];
    out.push(...items);
    if (!data.next_starting_after || items.length === 0 || out.length >= maxEmails) break;
    cursor = data.next_starting_after;
  }
  return out;
}

// Instantly's blocklist create endpoint isn't publicly documented under one stable
// path; these are tried in order until one accepts the write. The first success is
// cached for the process so later calls skip the probing.
const BLOCKLIST_PATHS = ["/leads/blocklist", "/block-lists", "/block-list-entries", "/blocklist"];
let blocklistPath: string | null = null;

/**
 * Add an email (or domain) to the Instantly blocklist so no campaign can contact
 * it again — used to honour opt-outs. `bl_value` is the field Instantly expects.
 */
export async function addToBlocklist(
  apiKey: string,
  value: string
): Promise<{ ok: boolean; path?: string; status?: number }> {
  const paths = blocklistPath ? [blocklistPath] : BLOCKLIST_PATHS;
  for (const path of paths) {
    try {
      const res = await fetch(BASE_URL + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ bl_value: value }),
        cache: "no-store",
      });
      // 2xx = created; 409/422 with an "already exists" style body also means the
      // value is effectively blocked — treat as success on the working path.
      if (res.ok) {
        blocklistPath = path;
        return { ok: true, path, status: res.status };
      }
      if (res.status === 409 || res.status === 422) {
        blocklistPath = path;
        const body = await res.text().catch(() => "");
        if (/exist|already|duplicate/i.test(body)) return { ok: true, path, status: res.status };
      }
      // 404 → wrong path, try the next candidate. Other errors on a known-good path stop.
      if (res.status !== 404 && blocklistPath) return { ok: false, path, status: res.status };
    } catch {
      // network hiccup — try next candidate
    }
  }
  return { ok: false };
}

export { InstantlyError };
