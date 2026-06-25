// Aggregation + snapshot assembly. This is the single place that decides
// whether to pull from Instantly or fall back to mock data.

import {
  fetchAccounts,
  fetchCampaignAnalytics,
  fetchDailyAnalytics,
  fetchDailyForCampaigns,
  getScopedCampaignIds,
  matchesKeywords,
} from "./instantly";
import { mockAccounts, mockCampaigns, mockDaily } from "./mock";
import type {
  CampaignAnalytics,
  ClientConfig,
  DailyPoint,
  DashboardSnapshot,
  Totals,
} from "./types";

export function emptyTotals(): Totals {
  return {
    leads: 0,
    contacted: 0,
    emailsSent: 0,
    opens: 0,
    opensUnique: 0,
    replies: 0,
    repliesUnique: 0,
    clicks: 0,
    clicksUnique: 0,
    bounced: 0,
    unsubscribed: 0,
    completed: 0,
    opportunities: 0,
    opportunityValue: 0,
    openRate: 0,
    replyRate: 0,
    clickRate: 0,
    bounceRate: 0,
  };
}

export function totalsFromCampaigns(campaigns: CampaignAnalytics[]): Totals {
  const t = emptyTotals();
  for (const c of campaigns) {
    t.leads += c.leads;
    t.contacted += c.contacted;
    t.emailsSent += c.emailsSent;
    t.opens += c.opens;
    t.opensUnique += c.opensUnique;
    t.replies += c.replies;
    t.repliesUnique += c.repliesUnique;
    t.clicks += c.clicks;
    t.clicksUnique += c.clicksUnique;
    t.bounced += c.bounced;
    t.unsubscribed += c.unsubscribed;
    t.completed += c.completed;
    t.opportunities += c.opportunities;
    t.opportunityValue += c.opportunityValue;
  }
  // Rates use UNIQUE counts to match Instantly's native dashboard (one person =
  // one open), so the headline numbers line up with what the client sees there.
  t.openRate = t.emailsSent ? t.opensUnique / t.emailsSent : 0;
  t.replyRate = t.emailsSent ? t.repliesUnique / t.emailsSent : 0;
  t.clickRate = t.emailsSent ? t.clicksUnique / t.emailsSent : 0;
  t.bounceRate = t.emailsSent ? t.bounced / t.emailsSent : 0;
  return t;
}

/** Totals over a slice of the daily series (used for period-over-period). */
function totalsFromDaily(daily: DailyPoint[]): Totals {
  const t = emptyTotals();
  for (const d of daily) {
    t.emailsSent += d.sent;
    t.opens += d.opens;
    t.replies += d.replies;
    t.clicks += d.clicks;
    t.bounced += d.bounced;
  }
  t.openRate = t.emailsSent ? t.opens / t.emailsSent : 0;
  t.replyRate = t.emailsSent ? t.replies / t.emailsSent : 0;
  t.clickRate = t.emailsSent ? t.clicks / t.emailsSent : 0;
  t.bounceRate = t.emailsSent ? t.bounced / t.emailsSent : 0;
  return t;
}

/** Per-metric factor between two daily half-periods, clamped to a sane band. */
function factor(prev: number, curr: number): number {
  if (!curr) return 1;
  return Math.max(0.5, Math.min(1.6, prev / curr));
}

/**
 * Estimate the previous period's totals by scaling the current (campaign-derived)
 * totals by the first-half/second-half ratio of each metric in the daily series.
 */
function estimatePrevious(current: Totals, first: Totals, second: Totals): Totals {
  const fSent = factor(first.emailsSent, second.emailsSent);
  const fOpens = factor(first.opens, second.opens);
  const fReplies = factor(first.replies, second.replies);
  const fClicks = factor(first.clicks, second.clicks);
  const fBounced = factor(first.bounced, second.bounced);

  const emailsSent = Math.round(current.emailsSent * fSent);
  const opens = Math.round(current.opens * fOpens);
  const replies = Math.round(current.replies * fReplies);
  const clicks = Math.round(current.clicks * fClicks);
  const bounced = Math.round(current.bounced * fBounced);

  return {
    leads: Math.round(current.leads * fSent),
    contacted: Math.round(current.contacted * fSent),
    emailsSent,
    opens,
    opensUnique: Math.round(current.opensUnique * fOpens),
    replies,
    repliesUnique: Math.round(current.repliesUnique * fReplies),
    clicks,
    clicksUnique: Math.round(current.clicksUnique * fClicks),
    bounced,
    unsubscribed: Math.round(current.unsubscribed * fReplies),
    completed: Math.round(current.completed * fSent),
    opportunities: Math.round(current.opportunities * fReplies),
    opportunityValue: Math.round(current.opportunityValue * fReplies),
    openRate: emailsSent ? Math.round(current.opensUnique * fOpens) / emailsSent : 0,
    replyRate: emailsSent ? Math.round(current.repliesUnique * fReplies) / emailsSent : 0,
    clickRate: emailsSent ? Math.round(current.clicksUnique * fClicks) / emailsSent : 0,
    bounceRate: emailsSent ? bounced / emailsSent : 0,
  };
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build a complete dashboard snapshot for a client over the trailing `days`.
 * Falls back to mock data when there's no API key or the API call fails.
 */
export async function buildSnapshot(
  client: ClientConfig,
  days = 30
): Promise<DashboardSnapshot> {
  const end = isoDaysAgo(0);
  const start = isoDaysAgo(days - 1);
  let campaigns: CampaignAnalytics[];
  let daily: DailyPoint[];
  let accounts;
  let source: "instantly" | "mock" = "mock";

  if (client.instantlyApiKey) {
    try {
      // Scope to this client's campaigns (by sending account) + accounts.
      const [scopedIds, allCampaigns, allAccounts] = await Promise.all([
        getScopedCampaignIds(client.instantlyApiKey, {
          accountKeywords: client.campaignAccountMatch,
          nameKeywords: client.campaignMatch,
        }),
        fetchCampaignAnalytics(client.instantlyApiKey, start, end),
        fetchAccounts(client.instantlyApiKey),
      ]);
      campaigns = scopedIds ? allCampaigns.filter((c) => scopedIds.has(c.id)) : allCampaigns;
      accounts = allAccounts.filter((a) => matchesKeywords(a.email, client.accountMatch));
      // Trend: when scoped, sum the per-campaign daily series; else workspace-wide.
      daily = scopedIds
        ? await fetchDailyForCampaigns(
            client.instantlyApiKey,
            campaigns.map((c) => c.id),
            start,
            end
          )
        : await fetchDailyAnalytics(client.instantlyApiKey, start, end);
      source = "instantly";
    } catch (err) {
      console.error(`[snapshot] Instantly fetch failed for ${client.slug}:`, err);
      campaigns = mockCampaigns(client.slug, days);
      daily = mockDaily(client.slug, days);
      accounts = mockAccounts(client.slug);
    }
  } else {
    campaigns = mockCampaigns(client.slug, days);
    daily = mockDaily(client.slug, days);
    accounts = mockAccounts(client.slug);
  }

  // Current totals are the authoritative per-campaign numbers over the range
  // (these include opportunities & pipeline, which the daily series lacks).
  const currentTotals = totalsFromCampaigns(campaigns);

  // Previous-period estimate for deltas: compare the two halves of the daily
  // series (real data when live, seeded when mock) to derive per-metric factors,
  // then apply them to the current totals. Because opens/replies/etc. each carry
  // their own factor, the resulting rate deltas are meaningful rather than flat.
  const mid = Math.floor(daily.length / 2);
  const firstHalf = totalsFromDaily(daily.slice(0, mid));
  const secondHalf = totalsFromDaily(daily.slice(mid));
  const previousTotals = estimatePrevious(currentTotals, firstHalf, secondHalf);

  return {
    client: { slug: client.slug, name: client.name, accentColor: client.accentColor },
    generatedAt: new Date().toISOString(),
    source,
    range: { start, end },
    totals: currentTotals,
    previousTotals,
    campaigns: campaigns.sort((a, b) => b.emailsSent - a.emailsSent),
    daily,
    accounts: accounts.sort((a, b) => a.healthScore - b.healthScore),
  };
}
