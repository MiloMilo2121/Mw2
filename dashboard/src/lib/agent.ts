// ─────────────────────────────────────────────────────────────────────────────
// agent.ts — draftReply(): genera bozze di risposta con Claude (gated dalla key),
// con guardrail HARD in codice e fallback template. I revisori (agent_reviewers)
// validano; una bozza è "approvata" solo se tutti passano.
//
// Fase 1 = COPILOT: qui si producono solo BOZZE. Nessun invio parte da questo file.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReplyCategory } from "./replies";
import { firstMessage } from "./replies";
import {
  AGENT_MODEL,
  hasAnthropicKey,
  callClaudeJSON,
  reviewDraft,
  type BrandVoice,
  type ReviewVerdict,
} from "./agent_reviewers";
import { GERIKO_BRAND, CATEGORY_PLAYBOOK, groundingContext } from "@/content/geriko/playbook";

export type DraftResult = {
  from: string;
  category: ReplyCategory;
  originalSubject: string;
  draftSubject: string;
  draftBody: string;
  rationale: string;
  confidence: number;
  reviews: ReviewVerdict[];
  approved: boolean;
  llm: boolean;
  blocked: boolean;
  blockReason?: string;
  replySnippet?: string;
  model?: string;
};

export const DEFAULT_BRAND: BrandVoice = {
  senderNames: [GERIKO_BRAND.senders.acquisizione.name, GERIKO_BRAND.senders.chiusura.name],
  domain: GERIKO_BRAND.domain,
  audience: GERIKO_BRAND.audience,
  register: GERIKO_BRAND.register,
};

type DraftInput = {
  reply: { from: string; subject: string; body: string; category: ReplyCategory };
  lead: {
    firstName: string;
    company: string;
    role: string;
    openedApproach: string;
    clickedApproach: string;
  };
  brand: BrandVoice;
  blocklisted?: boolean;
};

const reSubject = (s: string) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);

// ── Fallback template (nessun LLM): niente claim, solo playbook di categoria ──
function templateFor(input: DraftInput): { subject: string; body: string } {
  const first = input.lead.firstName?.trim();
  const hi = first ? `Gentile ${first},` : "Buongiorno,";
  const sign = `\n\nUn cordiale saluto,\n${GERIKO_BRAND.senders.acquisizione.name}\n${GERIKO_BRAND.company}`;
  const subject = reSubject(input.reply.subject || "");
  let body: string;
  switch (input.reply.category) {
    case "positivo":
      body = `${hi}\nla ringrazio per il riscontro. Se le fa piacere, le propongo un confronto telefonico breve per capire come lavorate oggi la multiproposta e se il nostro metodo può esserle utile. Mi indichi pure due momenti comodi e la richiamo io.${sign}`;
      break;
    case "persona_sbagliata":
      body = `${hi}\nla ringrazio e mi scuso per il disturbo. Potrebbe cortesemente indicarmi chi in agenzia segue le vendite e l'acquisizione degli incarichi, così da rivolgermi alla persona giusta senza disturbarla oltre?${sign}`;
      break;
    case "gia_cliente":
      body = `${hi}\nla ringrazio per il riscontro. Se avete bisogno di supporto sull'uso del metodo o su una funzione specifica, resto a disposizione.${sign}`;
      break;
    default:
      body = `${hi}\ngrazie del riscontro. Se utile, le propongo un breve confronto telefonico per rispondere alle sue domande: mi dica pure due momenti comodi e la richiamo io.${sign}`;
  }
  return { subject, body };
}

function buildGenSystem(category: ReplyCategory): string {
  return [
    `Sei l'assistente SDR di ${GERIKO_BRAND.company}. Scrivi in ITALIANO, registro "Lei" formale e diretto, MAI hype.`,
    `Rispondi SOLO in base al CONTESTO fornito: non inventare numeri, percentuali, importi, nomi, casi studio o promesse.`,
    ``,
    `CONTESTO / FATTI CITABILI:`,
    groundingContext(),
    ``,
    `ISTRUZIONE PER QUESTA CATEGORIA (${category}): ${CATEGORY_PLAYBOOK[category]}`,
    ``,
    `Firma la mail con un mittente ${GERIKO_BRAND.company} (di default ${GERIKO_BRAND.senders.acquisizione.name}). Sii conciso (5-9 righe).`,
    `Output SOLO JSON valido: {"subject": string, "body": string, "rationale": string, "confidence": number tra 0 e 1}.`,
  ].join("\n");
}

function buildGenUser(input: DraftInput): string {
  const cleaned = firstMessage(input.reply.body || "").slice(0, 1200);
  const lead = input.lead;
  const approach = [
    lead.clickedApproach ? `Ha CLICCATO l'approccio: "${lead.clickedApproach}"` : "",
    lead.openedApproach ? `Ha APERTO l'approccio: "${lead.openedApproach}"` : "",
  ]
    .filter(Boolean)
    .join(". ");
  return [
    `AZIENDA DESTINATARIO: ${lead.company || "(n.d.)"} — RUOLO: ${lead.role || "(n.d.)"} — NOME: ${lead.firstName || "(n.d.)"}`,
    approach ? `INGAGGIO: ${approach}` : "",
    `CATEGORIA RISPOSTA: ${input.reply.category}`,
    `TESTO DELLA RISPOSTA RICEVUTA:\n${cleaned || "(non disponibile)"}`,
    ``,
    `Scrivi la bozza di risposta seguendo l'istruzione della categoria e la CTA policy.`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function generate(
  input: DraftInput
): Promise<{ subject: string; body: string; rationale: string; confidence: number } | null> {
  try {
    const out = (await callClaudeJSON(
      buildGenSystem(input.reply.category),
      buildGenUser(input),
      900
    )) as { subject?: string; body?: string; rationale?: string; confidence?: number };
    if (!out || typeof out.body !== "string" || !out.body.trim()) return null;
    return {
      subject: (out.subject || reSubject(input.reply.subject || "")).trim(),
      body: out.body.trim(),
      rationale: typeof out.rationale === "string" ? out.rationale : "",
      confidence: typeof out.confidence === "number" ? out.confidence : 0.5,
    };
  } catch {
    return null;
  }
}

/** Genera una bozza revisionata per una singola risposta. Non invia mai nulla. */
export async function draftReply(input: DraftInput): Promise<DraftResult> {
  const base: DraftResult = {
    from: input.reply.from,
    category: input.reply.category,
    originalSubject: input.reply.subject,
    draftSubject: "",
    draftBody: "",
    rationale: "",
    confidence: 0,
    reviews: [],
    approved: false,
    llm: false,
    blocked: false,
  };

  // ── Guardrail HARD (prima di tutto) ─────────────────────────────────────────
  if (input.reply.category === "opt_out" || input.blocklisted) {
    return {
      ...base,
      blocked: true,
      blockReason: input.blocklisted
        ? "Mittente in blocklist — non contattare."
        : "Opt-out esplicito — rimuovere e bloccare, non rispondere.",
    };
  }
  if (input.reply.category === "auto_reply") {
    return { ...base, blocked: true, blockReason: "Messaggio automatico — nessuna risposta." };
  }

  // ── Generazione: LLM se c'è la chiave, altrimenti template ───────────────────
  const gen = hasAnthropicKey() ? await generate(input) : null;
  if (!gen) {
    const t = templateFor(input);
    return {
      ...base,
      draftSubject: t.subject,
      draftBody: t.body,
      rationale: hasAnthropicKey()
        ? "Generazione LLM non riuscita: bozza template, da rivedere."
        : "Nessuna ANTHROPIC_API_KEY: bozza template. Aggiungi la chiave per bozze su misura.",
      llm: false,
      approved: false,
    };
  }

  // ── Revisori agentici (solo con chiave) ─────────────────────────────────────
  const reviews = await reviewDraft(
    { draftSubject: gen.subject, draftBody: gen.body, category: input.reply.category },
    {
      brand: input.brand,
      replyText: firstMessage(input.reply.body || "").slice(0, 1200),
      leadContext: `${input.lead.company} · ${input.lead.role} · aperto: ${input.lead.openedApproach || "-"} · cliccato: ${input.lead.clickedApproach || "-"}`,
      grounding: groundingContext(),
      category: input.reply.category,
      recipientName: input.lead.firstName,
    }
  );

  return {
    ...base,
    draftSubject: gen.subject,
    draftBody: gen.body,
    rationale: gen.rationale,
    confidence: gen.confidence,
    reviews,
    approved: reviews.length > 0 && reviews.every((r) => r.pass),
    llm: true,
    model: AGENT_MODEL,
  };
}
