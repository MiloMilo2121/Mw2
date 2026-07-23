import { NextResponse } from "next/server";
import { getClient, listClients } from "@/lib/clients";
import { getAutomations, runAutomation, runSuppression } from "@/lib/automations";
import {
  getScopedCampaignIds,
  getScopedLiteCampaigns,
  fetchAccounts,
  fetchCampaignAnalytics,
  fetchDailyAccountAnalytics,
  matchesKeywords,
} from "@/lib/instantly";
import { notify, activeChannel } from "@/lib/notify";
import {
  detectAccountAlerts,
  detectCampaignAlerts,
  detectOpenRateAlert,
  detectQuotaAlerts,
  type Alert,
} from "@/lib/alerts";
import { recentlyNotified, recordAlert } from "@/lib/alerts_store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Daily cron (see vercel.json) that runs every client's automations LIVE.
// Guarded by CRON_SECRET: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`
// automatically when the env var is set. Until CRON_SECRET is configured this
// endpoint returns 401 and does nothing — so the automation only goes live once
// you set the secret. The Carretta target campaigns are drafts, so no emails are
// sent until you activate them.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Channel self-test (P0 DoD): `?test=alert` fires one synthetic alert through
  // the configured channel — proves "un 550 simulato produce una notifica"
  // without waiting for real data. Not persisted (synthetic).
  if (new URL(req.url).searchParams.get("test") === "alert") {
    const result = await notify(
      "crit",
      "[test] Account in errore (550 simulato)",
      "Alert di prova (?test=alert). demo@example.com status -3 — SMTP 550 5.4.5 Daily user sending limit exceeded."
    );
    return NextResponse.json({ test: true, channel: activeChannel(), result });
  }

  const summary: Record<string, unknown> = {};
  const clients = await listClients();
  for (const c of clients) {
    const client = await getClient(c.slug);
    if (!client?.instantlyApiKey) continue;
    const out: Record<string, unknown> = {};

    // 1. Lead-move automations (Sassi → Carretta, etc.)
    for (const a of getAutomations(c.slug)) {
      try {
        const report = await runAutomation(client.instantlyApiKey, a, false, c.slug); // LIVE (no-op if !enabled)
        out[a.id] = {
          added: report.results.reduce((s, r) => s + (r.added ?? 0), 0),
          eligible: report.totalEligible,
          errors: report.results.filter((r) => r.error).map((r) => r.error),
        };
      } catch (err) {
        out[a.id] = { error: (err as Error).message };
      }
    }

    // 2. Auto-suppression: blocklist clear opt-outs from the replies.
    try {
      const scoped = await getScopedCampaignIds(client.instantlyApiKey, {
        accountKeywords: client.campaignAccountMatch,
        nameKeywords: client.campaignMatch,
      });
      if (scoped && scoped.size) {
        const sup = await runSuppression(client.instantlyApiKey, [...scoped], false); // LIVE
        out["suppression"] = { blocked: sup.blocked.length, candidates: sup.candidates.length, errors: sup.errors };
      }
    } catch (err) {
      out["suppression"] = { error: (err as Error).message };
    }

    // 3. Alerts (P0.2) — detect vital conditions and push them to the notify
    // channel. Wrapped in its own try/catch so a failing alert path can never
    // break the automations above; notify() itself no-ops when unconfigured.
    try {
      const alerts: Alert[] = [];
      const [accounts, liteCampaigns] = await Promise.all([
        fetchAccounts(client.instantlyApiKey),
        getScopedLiteCampaigns(client.instantlyApiKey, {
          accountKeywords: client.campaignAccountMatch,
          nameKeywords: client.campaignMatch,
        }),
      ]);

      // (a) account send errors (550 class) + campaigns in negative status.
      const scopedAccounts = client.accountMatch?.length
        ? accounts.filter((a) => matchesKeywords(a.email, client.accountMatch))
        : accounts;
      alerts.push(...detectAccountAlerts(scopedAccounts, client.name));
      alerts.push(...detectCampaignAlerts(liteCampaigns ?? [], client.name));

      // (b) yesterday's UNIQUE open rate over this client's campaigns. Per-day
      // unique opens aren't in the daily series, so read per-campaign analytics
      // for the single day and sum opensUnique/emailsSent over scoped campaigns.
      const ids = new Set((liteCampaigns ?? []).map((lc) => lc.id));
      if (ids.size) {
        const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const yCampaigns = await fetchCampaignAnalytics(client.instantlyApiKey, y, y);
        const mine = yCampaigns.filter((cc) => ids.has(cc.id));
        const sent = mine.reduce((s, cc) => s + cc.emailsSent, 0);
        const opensUnique = mine.reduce((s, cc) => s + cc.opensUnique, 0);
        if (sent > 0) {
          const openAlert = detectOpenRateAlert({ sent, opensUnique }, y, client.name);
          if (openAlert) alerts.push(openAlert);
        }
      }

      // (c) quota guard: per mailbox, today's load (campaigns+warmup) vs its cap.
      // Isolated so an unsupported per-account daily endpoint can't drop (a)/(b).
      try {
        const withCap = scopedAccounts.filter((a) => a.dailyLimit > 0);
        if (withCap.length) {
          const today = new Date().toISOString().slice(0, 10);
          const accountDaily = await fetchDailyAccountAnalytics(
            client.instantlyApiKey,
            today,
            today,
            withCap.map((a) => a.email)
          );
          const load = new Map<string, number>();
          for (const d of accountDaily) load.set(d.email, (load.get(d.email) ?? 0) + d.sent);
          const mailboxes = withCap.map((a) => ({
            email: a.email,
            cap: a.dailyLimit,
            load: load.get(a.email) ?? 0,
          }));
          alerts.push(...detectQuotaAlerts(mailboxes, client.name));
        }
      } catch (err) {
        console.error(`[alerts] quota guard skipped: ${(err as Error).message}`);
      }

      // Notify each alert, suppressing daily repeats of a persistent condition
      // (transition-only), and record every sent alert to the audit history.
      let notified = 0;
      for (const a of alerts) {
        if (await recentlyNotified(c.slug, a.title)) continue;
        const res = await notify(a.level, a.title, a.body);
        await recordAlert(c.slug, a, res);
        notified++;
      }
      out["alerts"] = {
        detected: alerts.length,
        notified,
        channel: activeChannel() ?? "unconfigured (no-op)",
      };
    } catch (err) {
      // The alert path itself failed (e.g. Instantly unreachable). That silence
      // is the failure mode P0 exists to surface — so notify instead of only
      // recording it in a summary nobody reads.
      out["alerts"] = { error: (err as Error).message };
      try {
        await notify(
          "crit",
          `[${client.name}] Alerting non eseguito`,
          `Il controllo alert del cron 07:00 è fallito: ${(err as Error).message}. ` +
            `Impossibile valutare account/campagne/aperture in questo run.`
        );
      } catch {
        /* notify must never break the cron */
      }
    }

    if (Object.keys(out).length) summary[c.slug] = out;
  }
  return NextResponse.json({ ranAt: new Date().toISOString(), summary });
}
