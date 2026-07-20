import { describe, it, expect } from "vitest";
import type { AccountHealth, CampaignAnalytics, ClientConfig, DailyPoint } from "./types";
import {
  evalAccountErrors,
  evalCampaignStatus,
  evalOpenRate,
  evalAutomationFailure,
  evalQuotaGuard,
  collectErrors,
  pickYesterday,
  LOW_OPEN_RATE_THRESHOLD,
  MIN_SENT_FOR_OPEN_ALERT,
} from "./alerts";
import { formatAlert } from "./notify";

const client: ClientConfig = { slug: "geriko", name: "Geriko", instantlyApiKey: "x" };

function account(over: Partial<AccountHealth>): AccountHealth {
  return {
    email: "a@metodogeriko.it",
    status: 1,
    statusLabel: "Attivo",
    warmupStatus: 1,
    warmupScore: 90,
    dailyLimit: 40,
    healthScore: 90,
    provider: "Google",
    ...over,
  };
}

function campaign(over: Partial<CampaignAnalytics>): CampaignAnalytics {
  return {
    id: "c1",
    name: "Geriko CON NOME · Sassi 1-3",
    status: 1,
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
    ...over,
  };
}

function daily(over: Partial<DailyPoint>): DailyPoint {
  return { date: "2026-07-19", sent: 0, opens: 0, replies: 0, clicks: 0, bounced: 0, ...over };
}

describe("evalAccountErrors (P0.2 a)", () => {
  it("alerts on a -3 account and quotes the provider message verbatim", () => {
    const msg = "SMTP 550 5.4.5 Daily user sending limit exceeded";
    const events = evalAccountErrors(client, [
      account({ status: -3, statusLabel: "Errore invio", statusMessage: msg }),
      account({ email: "ok@metodogeriko.it", status: 1 }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("account_error");
    expect(events[0].severity).toBe("critical");
    expect(events[0].body).toContain(msg); // 550 verbatim
    expect(events[0].context?.statusMessage).toBe(msg);
  });

  it("is silent when all accounts are healthy", () => {
    expect(evalAccountErrors(client, [account({}), account({ status: 2 })])).toHaveLength(0);
  });
});

describe("evalCampaignStatus (P0.2 a)", () => {
  it("alerts on a negative campaign status", () => {
    const events = evalCampaignStatus(client, [campaign({ status: -2 }), campaign({ status: 1 })]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("campaign_status");
  });

  it("respects campaignMatch scoping", () => {
    const scoped: ClientConfig = { ...client, campaignMatch: ["geriko"] };
    const events = evalCampaignStatus(scoped, [
      campaign({ name: "Altro cliente X", status: -2 }), // out of scope
      campaign({ name: "Geriko GENERIC · Sassi 1-3", status: -2 }), // in scope
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].title).toContain("Geriko GENERIC");
  });
});

describe("evalOpenRate (P0.2 b)", () => {
  it("alerts when open rate is below threshold with enough volume", () => {
    const events = evalOpenRate(client, daily({ sent: 100, opens: 5 })); // 5% < 10%
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("low_open_rate");
    expect(events[0].context?.rate).toBeCloseTo(0.05);
  });

  it("stays silent below the minimum send volume", () => {
    expect(evalOpenRate(client, daily({ sent: MIN_SENT_FOR_OPEN_ALERT - 1, opens: 0 }))).toHaveLength(0);
  });

  it("stays silent at/above the threshold", () => {
    const rate = LOW_OPEN_RATE_THRESHOLD; // exactly 10% ⇒ not below ⇒ no alert
    expect(evalOpenRate(client, daily({ sent: 100, opens: 100 * rate }))).toHaveLength(0);
  });

  it("handles a missing day", () => {
    expect(evalOpenRate(client, null)).toHaveLength(0);
  });
});

describe("evalAutomationFailure (P0.2 d) + collectErrors", () => {
  it("surfaces string, array and numeric error shapes from the cron summary", () => {
    const summary = {
      "sassi-to-carretta": { added: 0, eligible: 3, errors: ["POST /leads 500"] },
      suppression: { blocked: 0, candidates: 2, errors: 1 },
      other: { error: "boom" },
    };
    expect(collectErrors(summary).length).toBe(3);
    const events = evalAutomationFailure(client, summary);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("automation_failure");
  });

  it("is silent on a clean summary", () => {
    const clean = { "sassi-to-carretta": { added: 2, eligible: 2, errors: [] }, suppression: { blocked: 0, candidates: 0, errors: 0 } };
    expect(evalAutomationFailure(client, clean)).toHaveLength(0);
    expect(evalAutomationFailure(client, undefined)).toHaveLength(0);
  });
});

describe("evalQuotaGuard (P0.2 c) — deferred stub", () => {
  it("returns nothing until per-account volume data exists", () => {
    expect(evalQuotaGuard(client, [account({})])).toHaveLength(0);
  });
});

describe("pickYesterday", () => {
  it("selects the (today-1) UTC row", () => {
    const now = new Date("2026-07-20T07:00:00Z");
    const series = [daily({ date: "2026-07-18" }), daily({ date: "2026-07-19", sent: 42 }), daily({ date: "2026-07-20" })];
    expect(pickYesterday(series, now)?.date).toBe("2026-07-19");
    expect(pickYesterday(series, now)?.sent).toBe(42);
  });

  it("returns null when yesterday is absent", () => {
    const now = new Date("2026-07-20T07:00:00Z");
    expect(pickYesterday([daily({ date: "2026-07-17" })], now)).toBeNull();
  });
});

describe("formatAlert", () => {
  it("prefixes the MW2 tag and includes the title", () => {
    const { subject, text } = formatAlert({
      clientSlug: "geriko",
      kind: "account_error",
      severity: "critical",
      title: "casella in errore",
      body: "dettagli",
    });
    expect(subject).toContain("[MW2]");
    expect(subject).toContain("casella in errore");
    expect(text).toContain("dettagli");
  });
});
