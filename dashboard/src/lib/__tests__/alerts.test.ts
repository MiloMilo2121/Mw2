import { describe, it, expect, afterEach } from "vitest";
import { notify, isNotifyConfigured } from "../notify";
import {
  detectAccountAlerts,
  detectCampaignAlerts,
  detectOpenRateAlert,
  detectQuotaAlerts,
} from "../alerts";
import type { AccountHealth } from "../types";

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
  const saved = {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chat: process.env.TELEGRAM_CHAT_ID,
  };
  afterEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = saved.token;
    process.env.TELEGRAM_CHAT_ID = saved.chat;
  });

  it("no-ops (never throws, never fetches) when unconfigured", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    expect(isNotifyConfigured()).toBe(false);
    const res = await notify("crit", "title", "body");
    expect(res).toEqual({ ok: false, skipped: true });
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

describe("detectOpenRateAlert (b)", () => {
  it("fires when rate < 10% and sent ≥ 20", () => {
    const a = detectOpenRateAlert({ sent: 40, opens: 2 }, "2026-07-19", "Geriko");
    expect(a?.level).toBe("warn");
    expect(a?.body).toContain("5.0%");
  });

  it("ignores low-volume days (sent < 20)", () => {
    expect(detectOpenRateAlert({ sent: 10, opens: 0 }, "d", "Geriko")).toBeNull();
  });

  it("ignores a healthy open rate", () => {
    expect(detectOpenRateAlert({ sent: 100, opens: 25 }, "d", "Geriko")).toBeNull();
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
