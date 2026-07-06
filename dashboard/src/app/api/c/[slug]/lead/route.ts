import { NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { fetchLead, fetchCampaignSequence, fetchEmails, getScopedCampaignIds, type RawEmail } from "@/lib/instantly";
import { firstMessage } from "@/lib/replies";
import { getVerified } from "@/lib/verified";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

const INTEREST_LABEL: Record<number, string> = {
  1: "Interessato",
  2: "Meeting",
  3: "Chiuso/Vinto",
  [-1]: "Non interessato",
  [-2]: "Persona sbagliata",
  [-3]: "Perso",
};

// Index of the last step reached, from status_summary.lastStep.stepID "seq_step_variant".
function lastStepIndex(raw: Record<string, unknown>): number {
  const ss = raw.status_summary as { lastStep?: { stepID?: string } } | undefined;
  const parts = String(ss?.lastStep?.stepID ?? "").split("_");
  return parts.length >= 2 ? parseInt(parts[1], 10) : -1;
}

// Render a subject template: fill {{firstName}}, drop any other {{placeholder}}.
function renderSubject(subject: string, firstName: string): string {
  return subject
    .replace(/\{\{\s*firstName\s*\}\}/gi, firstName || "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+(di|a|per|in|su|del|della|nel)\s*,/gi, ",") // orphaned prep from removed placeholder ("mercato di ," → "mercato,")
    .replace(/\s+([,.;:])/g, "$1") // drop space left before punctuation
    .replace(/^\s*[,.]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bodyText(e: RawEmail): string {
  const b = e.body as unknown;
  if (typeof b === "string") return b;
  if (b && typeof b === "object") {
    const o = b as { text?: string; html?: string };
    return (o.text || o.html || "")
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

// Per-person "call sheet": which emails a lead received, which approach they opened,
// which case-study link they clicked, and what they replied — so the caller is prepared.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 404 });

  const email = (new URL(req.url).searchParams.get("email") ?? "").toLowerCase().trim();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  if (!client.instantlyApiKey) {
    return NextResponse.json({ error: "no api key" }, { status: 404 });
  }

  try {
    const lead = await fetchLead(client.instantlyApiKey, email);
    if (!lead) return NextResponse.json({ error: "lead non trovato" }, { status: 404 });

    const campaignId = str(lead.campaign);
    const payload = (lead.payload as Record<string, unknown>) ?? {};
    const v = getVerified(email);
    const firstName = str(lead.first_name) || v?.firstName || "";

    const seq = campaignId ? await fetchCampaignSequence(client.instantlyApiKey, campaignId).catch(() => []) : [];
    const lastIdx = lastStepIndex(lead);

    const subjectAt = (stepIdx: number, variantIdx: number): string => {
      const st = seq.find((s) => s.step === stepIdx);
      const vr = st?.variants.find((x) => x.variant === variantIdx) ?? st?.variants[0];
      return renderSubject(vr?.subject ?? "", firstName);
    };

    const opens = num(lead.email_open_count);
    const clicks = num(lead.email_click_count);
    const replies = num(lead.email_reply_count);

    const openedStep = opens > 0 && lead.email_opened_step !== undefined ? num(lead.email_opened_step) : -1;
    const openedVar = num(lead.email_opened_variant);
    const clickedStep = clicks > 0 && lead.email_clicked_step !== undefined ? num(lead.email_clicked_step) : -1;
    const clickedVar = num(lead.email_clicked_variant);

    const opened = openedStep >= 0 ? { index: openedStep, subject: subjectAt(openedStep, openedVar) } : null;
    const clicked = clickedStep >= 0 ? { index: clickedStep, subject: subjectAt(clickedStep, clickedVar) } : null;

    // Sequence subjects (the approaches). For a step the lead engaged with, show the
    // exact A/B variant they received; otherwise fall back to variant 0.
    const sequence = seq.map((st) => {
      const vIdx = st.step === clickedStep ? clickedVar : st.step === openedStep ? openedVar : 0;
      return { index: st.step, subject: subjectAt(st.step, vIdx), sent: lastIdx < 0 ? false : st.step <= lastIdx };
    });

    // Reply text — scan ALL of the client's campaigns (a reply can land on the
    // step-4 campaign, not the one the lead currently sits in).
    let reply: { ts: string; text: string } | null = null;
    try {
      const scoped = await getScopedCampaignIds(client.instantlyApiKey, {
        accountKeywords: client.campaignAccountMatch,
        nameKeywords: client.campaignMatch,
      });
      const ids = scoped ? [...scoped] : campaignId ? [campaignId] : [];
      const perCampaign = await Promise.all(
        ids.map((id) => fetchEmails(client.instantlyApiKey!, { campaignId: id, maxEmails: 500 }).catch(() => [] as RawEmail[]))
      );
      const mine = perCampaign
        .flat()
        .filter((e) => Number(e.ue_type) === 2 && str(e.from_address_email).toLowerCase() === email)
        .sort((a, b) => str(b.timestamp_email).localeCompare(str(a.timestamp_email)));
      if (mine[0]) reply = { ts: str(mine[0].timestamp_email), text: firstMessage(bodyText(mine[0])).slice(0, 800) };
    } catch {
      // best-effort — reply is optional
    }

    const interestStatus = num(lead.lt_interest_status);
    const profile = {
      firstName,
      lastName: str(lead.last_name),
      company: v?.companyName || str(lead.company_name),
      role: str(lead.job_title) || v?.jobTitle || "",
      city: v?.city || str(payload.city),
      phone: v?.phone || str(payload.phone),
      website: v?.website || str(lead.website) || str(payload.website),
      email,
      interestStatus,
      interestLabel: INTEREST_LABEL[interestStatus] ?? "",
    };

    return NextResponse.json(
      { source: "instantly", profile, counts: { opens, clicks, replies }, sequence, opened, clicked, reply },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error(`[lead] failed for ${client.slug}/${email}:`, err);
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
