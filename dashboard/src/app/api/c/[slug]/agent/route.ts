import { NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import {
  fetchEmails,
  fetchCampaignSteps,
  fetchCampaignSequence,
  fetchLead,
  fetchLeads,
  getScopedCampaignIds,
  isBlocklisted,
  type RawEmail,
  type SequenceStep,
} from "@/lib/instantly";
import { categorizeReply, firstMessage, type ReplyCategory } from "@/lib/replies";
import { getVerified } from "@/lib/verified";
import { buildSnapshot } from "@/lib/metrics";
import { buildSuggestions, type HotLead } from "@/lib/optimizer";
import { draftReply, DEFAULT_BRAND, type DraftResult } from "@/lib/agent";
import type { CampaignStep } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DRAFT_CAP = Number(process.env.AGENT_DRAFT_CAP) || 8;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

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

function renderSubject(subject: string, firstName: string): string {
  return subject
    .replace(/\{\{\s*firstName\s*\}\}/gi, firstName || "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Small concurrency limiter so we don't fan out dozens of LLM/Instantly calls at once.
async function pMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

function subjectFrom(seq: SequenceStep[], stepIdx: number, variantIdx: number, firstName: string): string {
  const st = seq.find((s) => s.step === stepIdx);
  const vr = st?.variants.find((x) => x.variant === variantIdx) ?? st?.variants[0];
  return renderSubject(vr?.subject ?? "", firstName);
}

type Candidate = { from: string; subject: string; body: string; ts: string; category: ReplyCategory; campaignId: string };

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client" }, { status: 404 });

  const wantEmail = (new URL(req.url).searchParams.get("email") ?? "").toLowerCase().trim();
  const noStore = { headers: { "Cache-Control": "no-store" } };

  const key = client.instantlyApiKey;
  if (!key) {
    return NextResponse.json(
      { source: "mock", suggestions: [], drafts: [], note: "Nessuna Instantly key per questo cliente." },
      noStore
    );
  }

  try {
    const snap = await buildSnapshot(client, 30);
    const scoped = await getScopedCampaignIds(key, {
      accountKeywords: client.campaignAccountMatch,
      nameKeywords: client.campaignMatch,
    });
    const ids = scoped ? [...scoped] : snap.campaigns.map((c) => c.id);
    const activeIds = snap.campaigns.filter((c) => c.status === 1).map((c) => c.id);

    // Steps A/B per campagna attiva (per l'optimizer).
    const stepsByCampaign: Record<string, CampaignStep[]> = {};
    await Promise.all(
      activeIds.map(async (cid) => {
        stepsByCampaign[cid] = await fetchCampaignSteps(key, cid).catch(() => [] as CampaignStep[]);
      })
    );

    // Risposte inbound su tutte le campagne dello scope.
    const perCampaign = await Promise.all(
      ids.map((cid) =>
        fetchEmails(key, { campaignId: cid, maxEmails: 200 })
          .then((emails) => emails.map((e) => ({ e, cid })))
          .catch(() => [] as { e: RawEmail; cid: string }[])
      )
    );
    const inbound = perCampaign
      .flat()
      .filter(({ e }) => Number(e.ue_type) === 2 && str(e.from_address_email))
      .map(({ e, cid }) => {
        const from = str(e.from_address_email).toLowerCase();
        const subject = str(e.subject);
        const body = bodyText(e);
        return {
          from,
          subject,
          body,
          ts: str(e.timestamp_email) || str(e.timestamp_created),
          category: categorizeReply({ from, subject, body }),
          campaignId: cid,
        } as Candidate;
      });

    const replies = inbound.map((r) => ({ category: r.category, from: r.from, ts: r.ts }));

    // Hot leads = CLICCATORI con telefono (per la regola Geriko: chi clicca si richiama).
    const leadPages = await Promise.all(
      activeIds.map((cid) => fetchLeads(key, { campaignId: cid, maxLeads: 500 }).catch(() => []))
    );
    const hotLeads: HotLead[] = leadPages
      .flat()
      .filter((l) => l.clicks > 0)
      .map((l) => {
        const v = getVerified(l.email);
        return {
          email: l.email,
          company: l.company || v?.companyName || "",
          interest: l.interestStatus,
          clicked: l.clicks > 0,
          lastContact: l.lastContact,
          phone: l.phone || v?.phone || "",
        };
      });

    const suggestions = buildSuggestions({
      campaigns: snap.campaigns,
      stepsByCampaign,
      replies,
      hotLeads,
      accounts: snap.accounts,
    });

    // ── Candidati bozza: dedup per mittente, esclude auto_reply/opt_out ─────────
    const byFrom = new Map<string, Candidate>();
    for (const r of inbound.sort((a, b) => a.ts.localeCompare(b.ts))) {
      byFrom.set(r.from, r); // l'ultimo (più recente) vince
    }
    let candidates = [...byFrom.values()]
      .filter((c) => c.category !== "auto_reply" && c.category !== "opt_out")
      .sort((a, b) => b.ts.localeCompare(a.ts));

    let note: string | undefined;
    if (wantEmail) {
      candidates = candidates.filter((c) => c.from === wantEmail);
      if (candidates.length === 0) note = `Nessuna risposta inbound trovata per ${wantEmail}.`;
    } else if (candidates.length > DRAFT_CAP) {
      note = `Mostro le ${DRAFT_CAP} risposte più recenti su ${candidates.length}: usa ?email= per una bozza specifica.`;
      candidates = candidates.slice(0, DRAFT_CAP);
    }

    const seqCache = new Map<string, SequenceStep[]>();
    const getSeq = async (cid: string): Promise<SequenceStep[]> => {
      if (!cid) return [];
      if (!seqCache.has(cid)) {
        seqCache.set(cid, await fetchCampaignSequence(key, cid).catch(() => [] as SequenceStep[]));
      }
      return seqCache.get(cid)!;
    };

    const drafts: DraftResult[] = await pMap(candidates, 3, async (c) => {
      // Contesto lead (nome/azienda/ruolo + approccio aperto/cliccato).
      const lead = await fetchLead(key, c.from).catch(() => null);
      const v = getVerified(c.from);
      const firstName = str(lead?.first_name) || v?.firstName || "";
      const company = str(lead?.company_name) || v?.companyName || "";
      const role = str(lead?.job_title) || v?.jobTitle || "";
      const seq = await getSeq(str(lead?.campaign) || c.campaignId);
      const opens = num(lead?.email_open_count);
      const clicks = num(lead?.email_click_count);
      const openedStep = opens > 0 && lead?.email_opened_step !== undefined ? num(lead.email_opened_step) : -1;
      const clickedStep = clicks > 0 && lead?.email_clicked_step !== undefined ? num(lead.email_clicked_step) : -1;
      const openedApproach = openedStep >= 0 ? subjectFrom(seq, openedStep, num(lead?.email_opened_variant), firstName) : "";
      const clickedApproach = clickedStep >= 0 ? subjectFrom(seq, clickedStep, num(lead?.email_clicked_variant), firstName) : "";

      // Guardrail blocklist (oltre all'opt-out già escluso a monte).
      const blocklisted = await isBlocklisted(key, c.from).catch(() => false);

      const d = await draftReply({
        reply: { from: c.from, subject: c.subject, body: c.body, category: c.category },
        lead: { firstName, company, role, openedApproach, clickedApproach },
        brand: DEFAULT_BRAND,
        blocklisted,
      });
      return { ...d, replySnippet: firstMessage(c.body).slice(0, 240) } as DraftResult;
    });

    return NextResponse.json({ source: "instantly", suggestions, drafts, note }, noStore);
  } catch (err) {
    console.error(`[agent] failed for ${client.slug}:`, err);
    return NextResponse.json(
      { source: "mock", suggestions: [], drafts: [], note: "Errore nel recupero dati Instantly." },
      noStore
    );
  }
}

// Fase 1: nessun invio. L'invio a 1-tap (con casella di test + audit + conferma)
// arriva nell'Action Center (Fase 2). Qui lo stub resta esplicitamente disattivo.
export async function POST() {
  return NextResponse.json(
    { error: "Invio non attivo in Fase 1 — copia manuale. L'invio a tap arriva nell'Action Center." },
    { status: 501 }
  );
}
