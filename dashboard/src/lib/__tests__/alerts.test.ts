import { describe, it, expect, afterEach } from "vitest";
import { notify, isNotifyConfigured, activeChannel, formatAlertText } from "../notify";
import {
  detectAccountAlerts,
  detectCampaignAlerts,
  detectOpenRateAlert,
  detectQuotaAlerts,
} from "../alerts";
import type { AccountHealth } from "../types";

const CHANNEL_ENV = [
  "ALERT_CHANNEL",
  "ALERT_WEBHOOK_URL",
  "ALERT_RESEND_API_KEY",
  "ALERT_EMAIL_FROM",
  "ALERT_RECIPIENT",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
] as const;

function acct(partial: Partial<AccountHealth>): AccountHealth {
  return {
    email: "x@metodogeriko.it",
    status: 1,
    statusLabel: "Attivo",
    warmupStatus: 1,
    warmupScore: 80,
    dailyLimit: 30,
    healthScore: 90,
    provider: "Custom",
    ...partial,
  };
}

describe("notify (P0.1)", () => {
  const saved: Record<string, string | undefined> = {};
  for (const k of CHANNEL_ENV) saved[k] = process.env[k];
  afterEach(() => {
    for (const k of CHANNEL_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("no-ops (never throws, never fetches) when unconfigured", async () => {
    for (const k of CHANNEL_ENV) delete process.env[k];
    expect(activeChannel()).toBeNull();
    expect(isNotifyConfigured()).toBe(false);
    const res = await notify("crit", "title", "body");
    expect(res).toEqual({ ok: false, skipped: true });
  });

  it("auto-detects channels and lets ALERT_CHANNEL override", () => {
    for (const k of CHANNEL_ENV) delete process.env[k];
    process.env.TELEGRAM_BOT_TOKEN = "t";
    process.env.TELEGRAM_CHAT_ID = "123";
    expect(activeChannel()).toBe("telegram");
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/x";
    expect(activeChannel()).toBe("webhook"); // webhook wins auto-detect
    process.env.ALERT_CHANNEL = "console";
    expect(activeChannel()).toBe("console"); // explicit override wins
  });
});

describe("formatAlertText", () => {
  it("prefixes the level and caps length", () => {
    const text = formatAlertText("crit", "Account in errore", "550 5.4.5");
    expect(text).toContain("🚨");
    expect(text).toContain("Account in errore");
    expect(text).toContain("550 5.4.5");
    expect(formatAlertText("info", "t", "x".repeat(9000)).length).toBe(4000);
  });
});

describe("detectAccountAlerts — 550 (DoD)", () => {
  it("flags a status -3 account with the 550 message verbatim, as crit", () => {
    const alerts = detectAccountAlerts(
      [
        acct({
          email: "rosa@metodogeriko.it",
          status: -3,
          statusLabel: "Errore invio",
          statusMessage: "550 5.4.5 Daily user sending limit exceeded",
        }),
      ],
      "Geriko"
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe("crit");
    expect(alerts[0].body).toContain("550 5.4.5 Daily user sending limit exceeded");
  });

  it("ignores healthy accounts", () => {
    expect(detectAccountAlerts([acct({ status: 1 })], "Geriko")).toHaveLength(0);
  });

  it("treats -1 / -2 as warn", () => {
    const alerts = detectAccountAlerts(
      [acct({ status: -1, statusLabel: "Errore connessione" })],
      "Geriko"
    );
    expect(alerts[0].level).toBe("warn");
  });
});

describe("detectCampaignAlerts", () => {
  it("flags negative-status campaigns only", () => {
    const alerts = detectCampaignAlerts(
      [
        { id: "1", name: "Geriko CON NOME · Sassi 1-3", status: -2, accounts: [] },
        { id: "2", name: "Geriko Rosa 4", status: 1, accounts: [] },
      ],
      "Geriko"
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toContain("Sassi");
  });
});

describe("detectOpenRateAlert (b) — unique opens", () => {
  it("fires when the UNIQUE rate < 10% and sent ≥ 20", () => {
    const a = detectOpenRateAlert({ sent: 40, opensUnique: 2 }, "2026-07-19", "Geriko");
    expect(a?.level).toBe("warn");
    expect(a?.body).toContain("5.0%");
    expect(a?.body).toContain("uniche");
  });

  it("ignores low-volume days (sent < 20)", () => {
    expect(detectOpenRateAlert({ sent: 10, opensUnique: 0 }, "d", "Geriko")).toBeNull();
  });

  it("ignores a healthy open rate", () => {
    expect(detectOpenRateAlert({ sent: 100, opensUnique: 25 }, "d", "Geriko")).toBeNull();
  });
});

describe("detectQuotaAlerts (c)", () => {
  it("flags mailboxes past cap − 10%, skips cap 0", () => {
    const alerts = detectQuotaAlerts(
      [
        { email: "a@x.it", cap: 100, load: 95 },
        { email: "b@x.it", cap: 100, load: 80 },
        { email: "c@x.it", cap: 0, load: 5 },
      ],
      "Geriko"
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("a@x.it");
  });
});
