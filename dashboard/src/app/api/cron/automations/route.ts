import { NextResponse } from "next/server";
import { getClient, listClients } from "@/lib/clients";
import { getAutomations, runAutomation, runSuppression } from "@/lib/automations";
import { getScopedCampaignIds } from "@/lib/instantly";
import { gatherAlerts, persistAlert, recentlyAlerted } from "@/lib/alerts";
import { alertChannel, sendAlert, type AlertEvent } from "@/lib/notify";

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

  // Demonstration hook (P0 DoD): `?test=alert` fires one synthetic alert through
  // the configured channel — proves "un 550 simulato produce una notifica"
  // without waiting for the real data. Not persisted (synthetic client).
  if (new URL(req.url).searchParams.get("test") === "alert") {
    const ev: AlertEvent = {
      clientSlug: "test",
      kind: "test",
      severity: "critical",
      title: "Test alert — casella in errore (550 simulato)",
      body:
        "Alert di prova (?test=alert). Account demo@example.com status -3 (Errore invio).\n" +
        "Messaggio provider: SMTP 550 5.4.5 Daily user sending limit exceeded.",
      context: { simulated: true },
    };
    const result = await sendAlert(ev);
    return NextResponse.json({ test: true, channel: alertChannel(), result });
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
        const report = await runAutomation(client.instantlyApiKey, a, false); // LIVE
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

    // 3. Alerts (P0): read-only deliverability/status checks → notify a human.
    // Wrapped so a notification failure can never break the automation cron.
    try {
      const events = await gatherAlerts(client, { automationSummary: out });
      let notified = 0;
      for (const ev of events) {
        // Suppress daily repeats of a persistent condition (transition-only).
        if (await recentlyAlerted(ev)) continue;
        const res = await sendAlert(ev);
        await persistAlert(ev, res);
        notified++;
      }
      if (events.length) {
        out["alerts"] = {
          active: events.map((e) => ({ kind: e.kind, severity: e.severity, title: e.title })),
          notified,
        };
      }
    } catch (err) {
      out["alertsError"] = (err as Error).message;
    }

    if (Object.keys(out).length) summary[c.slug] = out;
  }
  return NextResponse.json({ ranAt: new Date().toISOString(), summary });
}
