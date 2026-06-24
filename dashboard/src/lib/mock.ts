// ─────────────────────────────────────────────────────────────────────────────
// Deterministic mock data generator.
//
// Used when no Instantly API key is configured so the dashboard is fully usable
// for demos and design review without any credentials. The numbers are seeded
// from the client slug so a given client always looks the same between reloads,
// while the most recent day jitters slightly to convey "live".
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AccountHealth,
  CampaignAnalytics,
  CampaignStep,
  DailyPoint,
  Lead,
} from "./types";

export function mockSteps(campaignId: string): CampaignStep[] {
  const rng = makeRng(campaignId + ":steps");
  const out: CampaignStep[] = [];
  const nSteps = 3;
  for (let step = 0; step < nSteps; step++) {
    for (const variant of ["0", "1"]) {
      const sent = Math.floor((120 - step * 30) * (0.8 + rng() * 0.4));
      const opened = Math.floor(sent * (0.45 + rng() * 0.3));
      out.push({
        step,
        variant,
        sent,
        opened,
        uniqueOpened: Math.floor(opened * (0.6 + rng() * 0.2)),
        replies: Math.floor(sent * (0.01 + rng() * 0.04)),
        clicks: Math.floor(opened * (0.03 + rng() * 0.08)),
      });
    }
  }
  return out;
}

function makeRng(seedStr: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAMPAIGN_NAMES = [
  "Q2 Outbound — SaaS Founders",
  "Agency Owners — Cold Sequence",
  "E-commerce DTC — Reactivation",
  "Enterprise CTOs — ABM",
  "Webinar Follow-up — June",
  "LinkedIn Scraped — Series A",
];

export function mockCampaigns(slug: string, days: number): CampaignAnalytics[] {
  const rng = makeRng(slug + ":campaigns");
  const count = 4 + Math.floor(rng() * 2);
  const out: CampaignAnalytics[] = [];
  for (let i = 0; i < count; i++) {
    const leads = 600 + Math.floor(rng() * 2400);
    const contacted = Math.floor(leads * (0.55 + rng() * 0.4));
    const emailsSent = Math.floor(contacted * (1.6 + rng() * 1.2));
    const openRate = 0.32 + rng() * 0.4;
    const opens = Math.floor(emailsSent * openRate);
    const replyRate = 0.015 + rng() * 0.06;
    const replies = Math.floor(emailsSent * replyRate);
    const clicks = Math.floor(opens * (0.04 + rng() * 0.12));
    const bounced = Math.floor(emailsSent * (0.005 + rng() * 0.03));
    const unsubscribed = Math.floor(replies * (0.05 + rng() * 0.2));
    const opportunities = Math.floor(replies * (0.1 + rng() * 0.3));
    const status = i === count - 1 ? 2 : i === 0 ? 1 : rng() > 0.3 ? 1 : 3;
    out.push({
      id: `mock-${slug}-${i}`,
      name: CAMPAIGN_NAMES[i % CAMPAIGN_NAMES.length],
      status,
      leads,
      contacted,
      emailsSent,
      opens,
      opensUnique: Math.floor(opens * (0.62 + rng() * 0.15)),
      replies,
      repliesUnique: replies,
      clicks,
      clicksUnique: Math.floor(clicks * (0.8 + rng() * 0.2)),
      bounced,
      unsubscribed,
      completed: Math.floor(contacted * (0.3 + rng() * 0.4)),
      opportunities,
      opportunityValue: opportunities * (1500 + Math.floor(rng() * 6000)),
    });
  }
  return out;
}

export function mockDaily(slug: string, days: number): DailyPoint[] {
  const rng = makeRng(slug + ":daily");
  const out: DailyPoint[] = [];
  const today = new Date();
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(today);
    date.setDate(today.getDate() - d);
    const iso = date.toISOString().slice(0, 10);
    const weekday = date.getDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.25 : 1;
    // Slight upward trend over time + daily noise.
    const trend = 1 + (days - d) / (days * 2);
    const base = (900 + rng() * 700) * weekendFactor * trend;
    const sent = Math.floor(base);
    const opens = Math.floor(sent * (0.34 + rng() * 0.3));
    const replies = Math.floor(sent * (0.02 + rng() * 0.04));
    const clicks = Math.floor(opens * (0.05 + rng() * 0.1));
    const bounced = Math.floor(sent * (0.005 + rng() * 0.02));
    out.push({ date: iso, sent, opens, replies, clicks, bounced });
  }
  // Jitter the latest day a little on each call to feel live.
  const last = out[out.length - 1];
  if (last) {
    const live = makeRng(slug + ":" + Math.floor(Date.now() / 60000));
    last.sent += Math.floor(live() * 40);
    last.opens += Math.floor(live() * 15);
    last.replies += Math.floor(live() * 3);
  }
  return out;
}

const FIRST = ["Luca", "Marco", "Sara", "Giulia", "Andrea", "Chiara", "Matteo", "Elena", "Davide", "Francesca", "Paolo", "Marta", "Stefano", "Anna", "Roberto", "Laura"];
const LAST = ["Rossi", "Bianchi", "Lando", "Ferrari", "Esposito", "Romano", "Greco", "Conti", "Bruno", "Gallo", "Costa", "Rizzo", "Moretti", "Barbieri", "Fontana", "Marino"];
const COMP = ["Comunello Group", "Geriko SRL", "Nordtech", "Vela Digital", "Acme Foods", "Brera Studio", "Metodo Lab", "Polaris SpA", "Quadra", "Sintesi", "Vivace Retail", "Orizzonte"];
const ROLES = ["CEO", "Founder", "Head of Sales", "Marketing Manager", "CTO", "Operations Lead", "Procurement", "Owner", "Growth Lead", "COO"];
const CITIES = ["Verona", "Milano", "Brescia", "Vicenza", "Padova", "Bergamo", "Treviso", "Bologna", "Mantova", "Trento"];

export function mockLeads(slug: string, campaigns: { id: string; name: string }[]): Lead[] {
  const rng = makeRng(slug + ":leads");
  const count = 60 + Math.floor(rng() * 40);
  const out: Lead[] = [];
  for (let i = 0; i < count; i++) {
    const fn = FIRST[Math.floor(rng() * FIRST.length)];
    const ln = LAST[Math.floor(rng() * LAST.length)];
    const comp = COMP[Math.floor(rng() * COMP.length)];
    const domain = comp.toLowerCase().replace(/[^a-z]/g, "").slice(0, 10) + ".com";
    // Engagement: most leads do little, a tail engages a lot.
    const r = rng();
    const opens = r > 0.45 ? Math.floor(rng() * 6) : 0;
    const clicks = opens && rng() > 0.55 ? Math.floor(rng() * 3) + 1 : 0;
    const replies = clicks && rng() > 0.6 ? 1 : opens && rng() > 0.9 ? 1 : 0;
    const status = replies ? 2 : r > 0.85 ? 3 : 1;
    const camp = campaigns[Math.floor(rng() * campaigns.length)] || { id: "", name: "" };
    const daysAgo = Math.floor(rng() * 30);
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    out.push({
      id: `lead-${slug}-${i}`,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}@${domain}`,
      firstName: fn,
      lastName: ln,
      company: comp,
      jobTitle: ROLES[Math.floor(rng() * ROLES.length)],
      website: "https://" + domain,
      city: CITIES[Math.floor(rng() * CITIES.length)],
      linkedin: opens ? "https://linkedin.com/in/" + fn.toLowerCase() + "-" + ln.toLowerCase() : "",
      opens,
      clicks,
      replies,
      status,
      statusLabel: status === 1 ? "Active" : status === 2 ? "Completed" : "Unsubscribed",
      campaignId: camp.id,
      lastContact: d.toISOString(),
      lastOpen: opens ? d.toISOString() : null,
    });
  }
  return out;
}

const PROVIDERS = ["Google", "Microsoft", "Custom"];

export function mockAccounts(slug: string): AccountHealth[] {
  const rng = makeRng(slug + ":accounts");
  const count = 8 + Math.floor(rng() * 8);
  const domains = ["outreach", "growth", "hello", "team", "sales"];
  const tld = slug.replace(/[^a-z0-9]/gi, "") || "client";
  const out: AccountHealth[] = [];
  for (let i = 0; i < count; i++) {
    const provider = PROVIDERS[Math.floor(rng() * PROVIDERS.length)];
    const email = `${domains[i % domains.length]}${i}@${tld}-mail${(i % 3) + 1}.com`;
    const roll = rng();
    const status = roll > 0.9 ? -2 : roll > 0.82 ? 2 : 1;
    const warmupScore = Math.floor(70 + rng() * 30) - (status < 0 ? 25 : 0);
    const dailyLimit = 30 + Math.floor(rng() * 30);
    const statusPenalty = status < 0 ? 45 : status === 2 ? 15 : 0;
    const healthScore = Math.max(
      0,
      Math.min(100, Math.round(35 + warmupScore * 0.65 - statusPenalty))
    );
    out.push({
      email,
      status,
      statusLabel:
        status === 1 ? "Active" : status === 2 ? "Paused" : "Soft bounce error",
      warmupStatus: status === 1 ? 1 : 0,
      warmupScore,
      dailyLimit,
      healthScore,
      provider,
    });
  }
  return out;
}
