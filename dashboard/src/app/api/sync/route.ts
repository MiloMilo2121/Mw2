import { NextResponse } from "next/server";
import { listClients, getClient } from "@/lib/clients";
import { buildSnapshot } from "@/lib/metrics";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cron endpoint (Vercel Cron → see vercel.json). Pulls a fresh snapshot for
// every client and upserts the trailing daily series into `metric_snapshots`,
// building up history/trends that outlive Instantly's own retention window.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const sb = getSupabase();
  const clients = await listClients();
  const results: Record<string, string> = {};

  for (const summary of clients) {
    const client = await getClient(summary.slug);
    if (!client) continue;
    try {
      const snap = await buildSnapshot(client, 30);
      if (sb) {
        const rows = snap.daily.map((d) => ({
          client_slug: client.slug,
          day: d.date,
          emails_sent: d.sent,
          opens: d.opens,
          replies: d.replies,
          clicks: d.clicks,
          bounced: d.bounced,
        }));
        const { error } = await sb
          .from("metric_snapshots")
          .upsert(rows, { onConflict: "client_slug,day" });
        results[client.slug] = error ? `error: ${error.message}` : `synced ${rows.length} days (${snap.source})`;
      } else {
        results[client.slug] = `ok (${snap.source}, no DB — nothing persisted)`;
      }
    } catch (err) {
      results[client.slug] = `failed: ${(err as Error).message}`;
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
