// ─────────────────────────────────────────────────────────────────────────────
// Reply categorisation for the "Risposte" tab and auto-suppression.
// Given a reply's from/subject/body it returns one category. Only `opt_out` is
// auto-suppressed (added to the Instantly blocklist by the cron) — clear opt-outs
// only, so a valid agency is never blocked just because a first name was wrong.
// ─────────────────────────────────────────────────────────────────────────────

export type ReplyCategory =
  | "positivo"
  | "opt_out"
  | "persona_sbagliata"
  | "gia_cliente"
  | "auto_reply"
  | "altro";

/** Categories the automation blocklists without asking. */
export const AUTO_SUPPRESS: ReplyCategory[] = ["opt_out"];

export const CATEGORY_LABEL: Record<ReplyCategory, string> = {
  positivo: "Positivo",
  opt_out: "Opt-out",
  persona_sbagliata: "Persona sbagliata",
  gia_cliente: "Già cliente",
  auto_reply: "Auto-reply",
  altro: "Altro",
};

// Strip the quoted history so keywords only match what the person actually wrote.
export function firstMessage(text: string): string {
  const marks = [
    /On .{0,80} wrote:/i,
    /Il giorno .{0,80} ha scritto/i,
    /-{2,}\s*Original Message\s*-{2,}/i,
    /_{6,}/,
    /\bDa:\s/,
    /\bFrom:\s/,
    /\bIl \d{1,2}\/\d{1,2}\/\d{2,4}.{0,40}ha scritto/i,
  ];
  let cut = text.length;
  for (const m of marks) {
    const i = text.search(m);
    if (i > 15 && i < cut) cut = i;
  }
  return text.slice(0, cut).trim();
}

const RE = {
  auto: /out of office|fuori sede|assente dall|uffic\w*\s+\w*\s*chius|riapr(iremo|e il|iamo)|sar[àa] nostra premura|in ferie|risponder[òo] al|automatic(a| reply)|autorispost|risposta automatica|vacation|non sono in ufficio|al (mio |nostro )?rientro/i,
  autoFrom: /canned\.response|mailer-daemon|postmaster|no-?reply|noreply|do-?not-?reply/i,
  optOut: /cancell(a|are|atemi|azione|ate)|rimuov|rimoss|disiscriv|unsubscribe|opt-?out|mi tolg|toglie?te?mi|non (ci |mi |più )?(scriv|contatt|invi|indirizz|mand|import)|smettete|basta (email|mail|messagg)/i,
  wrongPerson: /non esiste (nessun|più)|persona sbagliat|indirizzo (errat|sbagliat)|destinatario (errat|sbagliat)|ex (collaborat|dipendent|agent)|non (lavora|collabora|fa parte|è più)|non fa più parte|nome (corrett|sbagliat|errat)|has left|no longer (with|works)/i,
  customer: /(usiamo|utilizziamo|siamo|abbiamo) già|già (vostri |nostri |un )?client|siamo già client|already (a )?client|già in uso/i,
  positive: /interess|volentieri|approfond|incontr|chiamat|sentirci|disponibil|complimenti|mi faccia sapere|appuntament|fissar|richiam|mi contatt|possiamo (sentirci|parlare|vederci)|call|meeting|volentier/i,
};

export function categorizeReply(r: { from?: string; subject?: string; body?: string }): ReplyCategory {
  const from = (r.from ?? "").toLowerCase();
  const subject = (r.subject ?? "").toLowerCase();
  const body = firstMessage((r.body ?? "").toLowerCase());
  const hay = `${subject} ${body}`;

  // 1. Automated messages first (so an out-of-office isn't read as a real reply).
  if (RE.autoFrom.test(from) || RE.auto.test(hay)) return "auto_reply";
  // 2. Explicit opt-out (the only auto-suppressed category).
  if (RE.optOut.test(hay)) return "opt_out";
  // 3. Wrong recipient / person no longer there.
  if (RE.wrongPerson.test(hay)) return "persona_sbagliata";
  // 4. Already a customer.
  if (RE.customer.test(hay)) return "gia_cliente";
  // 5. Positive intent.
  if (RE.positive.test(hay)) return "positivo";
  return "altro";
}
