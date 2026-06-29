import { getClient } from "@/lib/clients";
import { buildSnapshot } from "@/lib/metrics";
import { campaignStatusLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

// CSV export of per-campaign performance for the selected range.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return new Response("Unknown client", { status: 404 });

  const url = new URL(req.url);
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days")) || 30));
  const snap = await buildSnapshot(client, days);

  const header = [
    "Campagna",
    "Stato",
    "Lead",
    "Contattati",
    "Email inviate",
    "Aperture",
    "Tasso apertura",
    "Risposte",
    "Tasso risposta",
    "Click",
    "Bounce",
    "Tasso bounce",
    "Opportunità",
    "Valore pipeline (EUR)",
  ];
  const rows = snap.campaigns.map((c) => [
    csv(c.name),
    campaignStatusLabel(c.status),
    c.leads,
    c.contacted,
    c.emailsSent,
    c.opens,
    pct(c.opens, c.emailsSent),
    c.replies,
    pct(c.replies, c.emailsSent),
    c.clicks,
    c.bounced,
    pct(c.bounced, c.emailsSent),
    c.opportunities,
    c.opportunityValue,
  ]);

  const body = [header, ...rows].map((r) => r.join(",")).join("\n");
  const filename = `${client.slug}-instantly-${snap.range.start}_to_${snap.range.end}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function csv(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(2)}%` : "0%";
}
