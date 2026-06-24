import { NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { fetchCampaignSteps } from "@/lib/instantly";
import { mockSteps } from "@/lib/mock";

export const dynamic = "force-dynamic";

// Per-step (and A/B variant) performance for one campaign of the sequence.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 404 });

  const url = new URL(req.url);
  const campaign = url.searchParams.get("campaign") ?? "";
  if (!campaign) return NextResponse.json({ steps: [], source: "mock" });

  if (client.instantlyApiKey) {
    try {
      const steps = await fetchCampaignSteps(client.instantlyApiKey, campaign);
      return NextResponse.json({ steps, source: "instantly" }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      console.error(`[steps] Instantly fetch failed for ${client.slug}:`, err);
    }
  }
  return NextResponse.json({ steps: mockSteps(campaign), source: "mock" });
}
