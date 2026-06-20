// ─────────────────────────────────────────────────────────────────────────────
// Shared domain types for the Instantly Live Dashboard.
// These mirror the fields returned by the Instantly.ai V2 API, normalised into
// a shape the UI can rely on regardless of which fields the API omits.
// ─────────────────────────────────────────────────────────────────────────────

export type ClientConfig = {
  slug: string;
  name: string;
  /** Instantly V2 API key — server-side only, never sent to the browser. */
  instantlyApiKey?: string;
  accentColor?: string;
};

/** Normalised per-campaign analytics row. */
export type CampaignAnalytics = {
  id: string;
  name: string;
  status: number; // 0 draft, 1 active, 2 paused, 3 completed
  leads: number;
  contacted: number;
  emailsSent: number;
  opens: number;
  replies: number;
  clicks: number;
  bounced: number;
  unsubscribed: number;
  completed: number;
  opportunities: number;
  opportunityValue: number;
};

/** A single day of aggregated sending activity. */
export type DailyPoint = {
  date: string; // YYYY-MM-DD
  sent: number;
  opens: number;
  replies: number;
  clicks: number;
  bounced: number;
};

/** Normalised email account / deliverability health row. */
export type AccountHealth = {
  email: string;
  status: number; // 1 active, 2 paused, -1/-2/-3 error states
  statusLabel: string;
  warmupStatus: number; // 1 active
  warmupScore: number; // 0-100
  dailyLimit: number;
  sentToday: number;
  bounceRate: number; // 0-1
  healthScore: number; // 0-100 derived
  provider: string;
};

export type FeedbackItem = {
  id: string;
  clientSlug: string;
  /** Entity the feedback is attached to: "campaign:<id>", "overview", etc. */
  target: string;
  targetLabel: string;
  author: string;
  kind: "comment" | "flag" | "question";
  body: string;
  createdAt: string; // ISO
  resolved: boolean;
};

/** Everything the dashboard needs for one client, in one payload. */
export type DashboardSnapshot = {
  client: { slug: string; name: string; accentColor?: string };
  generatedAt: string; // ISO
  source: "instantly" | "mock";
  range: { start: string; end: string };
  totals: Totals;
  previousTotals: Totals;
  campaigns: CampaignAnalytics[];
  daily: DailyPoint[];
  accounts: AccountHealth[];
};

export type Totals = {
  leads: number;
  contacted: number;
  emailsSent: number;
  opens: number;
  replies: number;
  clicks: number;
  bounced: number;
  unsubscribed: number;
  opportunities: number;
  opportunityValue: number;
  // derived rates (0-1)
  openRate: number;
  replyRate: number;
  clickRate: number;
  bounceRate: number;
};
