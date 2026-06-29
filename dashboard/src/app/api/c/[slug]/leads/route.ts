import { NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { fetchLeads, getScopedCampaignIds } from "@/lib/instantly";
import { mockCampaigns, mockLeads } from "@/lib/mock";
import { getVerified } from "@/lib/verified";
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

  // Enrich with verified Drive data (phone, quality, result, clean fields) by email.
  leads = leads.map((l) => {
    const v = getVerified(l.email);
    if (!v) return l;
    return {
      ...l,
      firstName: l.firstName || v.firstName,
      company: v.companyName || l.company,
      city: v.city || l.city,
      jobTitle: v.jobTitle || l.jobTitle,
      website: v.website || l.website,
      phone: v.phone || l.phone,
      quality: v.quality,
      result: v.result,
      verified: true,
    };
  });

  // Dedupe by email — a person can be in several campaigns; merge their
  // engagement into one row (sum opens/clicks/replies, keep the best interest).
  const byEmail = new Map<string, Lead>();
  for (const l of leads) {
    const k = l.email.toLowerCase();
    const ex = byEmail.get(k);
    if (!ex) {
      byEmail.set(k, { ...l });
      continue;
    }
    ex.opens += l.opens;
    ex.clicks += l.clicks;
    ex.replies += l.replies;
    if (l.interestStatus > ex.interestStatus) {
      ex.interestStatus = l.interestStatus;
      ex.interestLabel = l.interestLabel;
    }
    if (!ex.phone && l.phone) ex.phone = l.phone;
    if (!ex.verified && l.verified) {
      ex.verified = true;
      ex.quality = l.quality;
      ex.result = l.result;
    }
    if ((l.lastOpen || "") > (ex.lastOpen || "")) ex.lastOpen = l.lastOpen;
  }
  leads = [...byEmail.values()];

  let rows = leads;
  if (filter === "opened") rows = rows.filter((l) => l.opens > 0);
  else if (filter === "clicked") rows = rows.filter((l) => l.clicks > 0);
  else if (filter === "replied") rows = rows.filter((l) => l.replies > 0);
  else if (filter === "interested") rows = rows.filter((l) => l.interestStatus > 0);
  if (q) {
    rows = rows.filter(
      (l) =>
        l.email.toLowerCase().includes(q) ||
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
        l.company.toLowerCase().includes(q)
    );
  }

  // Call priority ("chi chiamare"): rank the people Geriko should phone first.
  // Interested > replied > clicked > opened; a contact with a phone number is
  // bubbled above an equally-hot but unreachable one — the top of the list is an
  // actionable call sheet. Score is attached so the UI can show a priority badge.
  for (const l of rows) l.callScore = callScore(l);
  rows.sort((a, b) => (b.callScore ?? 0) - (a.callScore ?? 0) || (b.lastOpen || "").localeCompare(a.lastOpen || ""));

  const engaged = {
    opened: leads.filter((l) => l.opens > 0).length,
    clicked: leads.filter((l) => l.clicks > 0).length,
    replied: leads.filter((l) => l.replies > 0).length,
    interested: leads.filter((l) => l.interestStatus > 0).length,
  };

  const enriched = leads.filter((l) => l.verified).length;
  return NextResponse.json(
    { source, total: leads.length, shown: rows.length, engaged, enriched, leads: rows.slice(0, 500) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// How "callable" a lead is, highest = call first. Tiers (interest, reply, click,
// open) dominate the score; having a phone number adds a strong boost so reachable
// leads sit above equally-warm but un-callable ones.
function callScore(l: Lead): number {
  let s = 0;
  if (l.interestStatus > 0) s += 6000 + l.interestStatus * 1000;
  s += Math.min(l.replies, 5) * 800;
  s += Math.min(l.clicks, 10) * 120;
  s += Math.min(l.opens, 30) * 12;
  if (l.phone) s += 4000;
  return s;
}
