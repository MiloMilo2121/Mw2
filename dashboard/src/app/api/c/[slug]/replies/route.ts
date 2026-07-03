import { NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { fetchEmails, getScopedCampaignIds, type RawEmail } from "@/lib/instantly";
import { categorizeReply, firstMessage, AUTO_SUPPRESS, type ReplyCategory } from "@/lib/replies";
import { getVerified } from "@/lib/verified";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const str = (v: unknown) => (typeof v === "string" ? v : "");

// Pull the reply text out of the email body (which may be {text, html} or a string).
function bodyText(e: RawEmail): string {
  const b = e.body as unknown;
  if (typeof b === "string") return b;
  if (b && typeof b === "object") {
    const o = b as { text?: string; html?: string };
    const raw = o.text || o.html || "";
    return raw
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

// Live feed of inbound replies (ue_type===2) across the client's campaigns, each
// auto-categorised so the agency sees hot leads, opt-outs and noise at a glance.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 404 });

  if (!client.instantlyApiKey) {
    return NextResponse.json(
      { source: "mock", total: 0, counts: {}, items: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  let items: {
    id: string;
    ts: string;
    from: string;
    agency: string;
    subject: string;
    snippet: string;
    category: ReplyCategory;
    autoSuppress: boolean;
  }[] = [];
  let source: "instantly" | "mock" = "instantly";

  try {
    const scopedIds = await getScopedCampaignIds(client.instantlyApiKey, {
      accountKeywords: client.campaignAccountMatch,
      nameKeywords: client.campaignMatch,
    });
    const ids = scopedIds ? [...scopedIds] : [];
    const perCampaign = await Promise.all(
      ids.map((id) =>
        fetchEmails(client.instantlyApiKey!, { campaignId: id, maxEmails: 500 }).catch(() => [] as RawEmail[])
      )
    );
    const emails = perCampaign.flat().filter((e) => Number(e.ue_type) === 2);

    // Dedupe by message/id, newest first.
    const seen = new Set<string>();
    const rows = [];
    for (const e of emails) {
      const id = str(e.id) || str(e.message_id) || `${str(e.from_address_email)}-${str(e.timestamp_email)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(e);
    }
    rows.sort((a, b) => str(b.timestamp_email).localeCompare(str(a.timestamp_email)));

    items = rows.map((e) => {
      const from = str(e.from_address_email);
      const subject = str(e.subject);
      const full = bodyText(e);
      const category = categorizeReply({ from, subject, body: full });
      const verified = getVerified(from);
      const agency = verified?.companyName || from.split("@")[1] || "";
      const id = str(e.id) || str(e.message_id) || `${from}-${str(e.timestamp_email)}`;
      return {
        id,
        ts: str(e.timestamp_email) || str(e.timestamp_created),
        from,
        agency,
        subject,
        snippet: firstMessage(full).slice(0, 260),
        category,
        autoSuppress: AUTO_SUPPRESS.includes(category),
      };
    });
  } catch (err) {
    console.error(`[replies] Instantly fetch failed for ${client.slug}:`, err);
    source = "mock";
    items = [];
  }

  const counts: Record<string, number> = {};
  for (const it of items) counts[it.category] = (counts[it.category] ?? 0) + 1;

  return NextResponse.json(
    { source, total: items.length, counts, items },
    { headers: { "Cache-Control": "no-store" } }
  );
}
