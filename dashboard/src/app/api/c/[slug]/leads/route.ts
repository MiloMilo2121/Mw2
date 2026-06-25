import { NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { fetchLeads, getScopedCampaignIds } from "@/lib/instantly";
import { mockCampaigns, mockLeads } from "@/lib/mock";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// On-demand contact/engagement feed for the Contacts tab. Kept separate from the
// main snapshot so the rest of the dashboard stays fast. Scoped to the client's
// own campaigns when the client is configured with a campaignMatch filter.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 404 });

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") ?? "all"; // all|opened|clicked|replied
  const campaign = url.searchParams.get("campaign") ?? "";
  const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();

  let leads: Lead[];
  let source: "instantly" | "mock" = "mock";

  if (client.instantlyApiKey) {
    try {
      source = "instantly";
      if (campaign) {
        // Specific campaign selected in the UI.
        leads = await fetchLeads(client.instantlyApiKey, { campaignId: campaign, maxLeads: 1000 });
      } else {
        // "All" within this client's scope: gather leads per scoped campaign.
        const scopedIds = await getScopedCampaignIds(client.instantlyApiKey, {
          accountKeywords: client.campaignAccountMatch,
          nameKeywords: client.campaignMatch,
        });
        if (scopedIds) {
          const per = await Promise.all(
            [...scopedIds].map((id) =>
              fetchLeads(client.instantlyApiKey!, { campaignId: id, maxLeads: 500 })
            )
          );
          leads = per.flat();
        } else {
          leads = await fetchLeads(client.instantlyApiKey, { maxLeads: 1000 });
        }
      }
    } catch (err) {
      console.error(`[leads] Instantly fetch failed for ${client.slug}:`, err);
      source = "mock";
      leads = mockLeads(client.slug, mockCampaigns(client.slug, 30));
    }
  } else {
    leads = mockLeads(client.slug, mockCampaigns(client.slug, 30));
  }

  let rows = leads;
  if (filter === "opened") rows = rows.filter((l) => l.opens > 0);
  else if (filter === "clicked") rows = rows.filter((l) => l.clicks > 0);
  else if (filter === "replied") rows = rows.filter((l) => l.replies > 0);
  if (q) {
    rows = rows.filter(
      (l) =>
        l.email.toLowerCase().includes(q) ||
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
        l.company.toLowerCase().includes(q)
    );
  }

  // Most engaged first: clicks, then replies, then opens.
  rows.sort((a, b) => b.clicks - a.clicks || b.replies - a.replies || b.opens - a.opens);

  const engaged = {
    opened: leads.filter((l) => l.opens > 0).length,
    clicked: leads.filter((l) => l.clicks > 0).length,
    replied: leads.filter((l) => l.replies > 0).length,
  };

  return NextResponse.json(
    { source, total: leads.length, shown: rows.length, engaged, leads: rows.slice(0, 500) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
