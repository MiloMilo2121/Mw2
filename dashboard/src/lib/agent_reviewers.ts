// ─────────────────────────────────────────────────────────────────────────────
// agent_reviewers.ts — fondamenta LLM + revisori agentici.
//
// Pattern: generatore (agent.ts) → 3 critici indipendenti (brand / fatti /
// compliance) → consenso. Una bozza è "approvata" solo se TUTTI passano.
//
// Barriere HARD in CODICE (non affidate all'LLM), eseguite PRIMA della chiamata:
//   - findUnsupportedClaims: numeri/€/% fuori dal contesto + claim vietati + spam.
// L'LLM è la SECONDA barriera. Questo file NON importa da agent.ts (no cicli).
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import type { ReplyCategory } from "./replies";
import { FORBIDDEN_CLAIMS, SPAM_DENYLIST } from "@/content/geriko/playbook";

export type ReviewVerdict = {
  reviewer: "brand" | "fatti" | "compliance";
  pass: boolean;
  reason: string;
};

export type BrandVoice = {
  senderNames: string[];
  domain: string;
  audience: string;
  register: string;
};

export type ReviewContext = {
  brand: BrandVoice;
  replyText: string; // reply del prospect (pulita)
  leadContext: string; // azienda/ruolo/nome/approccio aperto-cliccato
  grounding: string; // groundingContext() del playbook (fatti citabili)
  category: ReplyCategory;
  recipientName: string;
};

export const AGENT_MODEL = process.env.AGENT_MODEL || "claude-sonnet-5";

export function hasAnthropicKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let _client: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

function parseJsonLoose(text: string): unknown {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(text.slice(s, e + 1));
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(text); // throws if not JSON
}

/** Chiamata Claude che ritorna JSON (istruito nel prompt + parsing tollerante). */
export async function callClaudeJSON(
  system: string,
  user: string,
  maxTokens = 800
): Promise<unknown> {
  const client = getAnthropic();
  const msg = await client.messages.create({
    model: AGENT_MODEL,
    max_tokens: maxTokens,
    thinking: { type: "disabled" },
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .trim();
  return parseJsonLoose(text);
}

/**
 * Barriera codice: numeri/percentuali/euro non presenti nel contesto, claim
 * vietati (playbook) e parole-spam. Ritorna le ragioni (vuoto = ok).
 */
export function findUnsupportedClaims(text: string, context: string): string[] {
  if (!text) return [];
  const reasons: string[] = [];
  const low = text.toLowerCase();

  for (const { pattern, reason } of FORBIDDEN_CLAIMS) {
    if (pattern.test(text)) reasons.push(reason);
  }
  for (const w of SPAM_DENYLIST) {
    if (low.includes(w.toLowerCase())) reasons.push(`parola non ammessa: "${w}"`);
  }

  const ctxDigits = context.replace(/[^0-9]/g, "");
  const tokens = new Set<string>();
  const collect = (re: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) tokens.add(m[0]);
  };
  collect(/\d+(?:[.,]\d+)?\s*%/g); // percentuali
  collect(/(?:€|euro)\s*\d[\d.,]*|\d[\d.,]*\s*(?:€|euro)/gi); // importi
  collect(/\+\s*\d+(?:[.,]\d+)?/g); // claim tipo "+N"
  for (const t of tokens) {
    const digits = t.replace(/[^0-9]/g, "");
    if (digits.length >= 2 && !ctxDigits.includes(digits)) {
      reasons.push(`dato non nel contesto: "${t.trim()}"`);
    }
  }
  return [...new Set(reasons)];
}

const BRAND_SYSTEM =
  "Sei un revisore di STILE per Geriko. Valuta se la bozza rispetta: italiano corretto e scorrevole; registro 'Lei' formale, diretto e tra pari (mai corporate); concisione; nessun hype o superlativo; coerenza con la voce del mittente indicato. Rispondi SOLO con JSON valido: {\"pass\": boolean, \"reason\": \"<motivo breve>\"}.";

const FACT_SYSTEM =
  "Sei un revisore dei FATTI per Geriko. La bozza NON deve contenere numeri, percentuali, importi, nomi di clienti/casi, promesse o risultati che NON siano presenti nel CONTESTO fornito. Se inventa dati, cita testimonianze non fornite, o promette risultati non nel contesto → pass:false. Rispondi SOLO con JSON valido: {\"pass\": boolean, \"reason\": \"<motivo breve>\"}.";

const COMPLIANCE_SYSTEM =
  "Sei un revisore COMPLIANCE per Geriko. Verifica che la bozza: onori eventuali opt-out (mai insistere se il contatto ha chiesto di non essere contattato); usi il nome corretto del destinatario; NON confonda l'asta privata di Geriko con un'asta giudiziaria/esecutiva/pignoramento; abbia una CTA chiara e non aggressiva; non contenga parole-spam; sia coerente con la categoria della risposta ricevuta. Rispondi SOLO con JSON valido: {\"pass\": boolean, \"reason\": \"<motivo breve>\"}.";

function buildReviewUser(
  draft: { draftSubject: string; draftBody: string; category: ReplyCategory },
  ctx: ReviewContext
): string {
  return [
    `CONTESTO / FATTI CITABILI:\n${ctx.grounding}`,
    `CATEGORIA RISPOSTA RICEVUTA: ${ctx.category}`,
    `DESTINATARIO: ${ctx.recipientName || "(nome non disponibile)"}`,
    `INFO LEAD: ${ctx.leadContext}`,
    `REPLY DEL PROSPECT:\n${ctx.replyText || "(non disponibile)"}`,
    `BOZZA DA VALUTARE — Oggetto: ${draft.draftSubject}\nCorpo:\n${draft.draftBody}`,
  ].join("\n\n");
}

async function llmReview(
  reviewer: ReviewVerdict["reviewer"],
  system: string,
  user: string
): Promise<ReviewVerdict> {
  try {
    const out = (await callClaudeJSON(system, user, 400)) as {
      pass?: boolean;
      reason?: string;
    };
    return {
      reviewer,
      pass: out.pass === true,
      reason: typeof out.reason === "string" ? out.reason : "",
    };
  } catch {
    // Fail-safe: se il revisore non risponde, la bozza va comunque all'umano.
    return { reviewer, pass: false, reason: "revisione non disponibile" };
  }
}

/**
 * Revisori agentici: 3 lenti indipendenti in parallelo. `approved` (in agent.ts)
 * = tutti pass. La barriera codice sui fatti gira PRIMA dell'LLM (deterministica).
 */
export async function reviewDraft(
  draft: { draftSubject: string; draftBody: string; category: ReplyCategory },
  ctx: ReviewContext
): Promise<ReviewVerdict[]> {
  const combinedContext = [ctx.grounding, ctx.leadContext, ctx.replyText].join("\n");
  const factIssues = [
    ...findUnsupportedClaims(draft.draftBody, combinedContext),
    ...findUnsupportedClaims(draft.draftSubject, combinedContext),
  ];

  const user = buildReviewUser(draft, ctx);
  const fatti: Promise<ReviewVerdict> = factIssues.length
    ? Promise.resolve({
        reviewer: "fatti",
        pass: false,
        reason: [...new Set(factIssues)].join("; "),
      })
    : llmReview("fatti", FACT_SYSTEM, user);

  const [brand, factVerdict, compliance] = await Promise.all([
    llmReview("brand", BRAND_SYSTEM, user),
    fatti,
    llmReview("compliance", COMPLIANCE_SYSTEM, user),
  ]);
  return [brand, factVerdict, compliance];
}
