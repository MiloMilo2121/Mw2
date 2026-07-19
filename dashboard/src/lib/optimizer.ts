// ─────────────────────────────────────────────────────────────────────────────
// optimizer.ts — suggerimenti di ottimizzazione EURISTICI (nessun LLM) calcolati
// dai dati reali Instantly. Alimenta la sezione "Ottimizzazioni" della tab Agent.
//
// Principio Geriko: il lead caldo è chi CLICCA il link tracciato (non chi apre) —
// e per contratto chi non clicca NON si chiama. I follow-up suggeriti riguardano
// quindi solo i cliccatori con telefono.
// ─────────────────────────────────────────────────────────────────────────────

import type { CampaignAnalytics, CampaignStep, AccountHealth } from "./types";
import type { ReplyCategory } from "./replies";

export type Suggestion = {
  id: string;
  severity: "alta" | "media" | "info";
  area: "copy" | "deliverability" | "follow-up" | "lista" | "sequenza";
  title: string;
  detail: string;
  action?: string;
};

export type HotLead = {
  email: string;
  company: string;
  interest: number;
  clicked: boolean;
  lastContact: string | null;
  phone: string;
};

const rate = (num: number, den: number) => (den > 0 ? num / den : 0);
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const daysSince = (iso: string | null): number =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity;

const SEV_ORDER: Record<Suggestion["severity"], number> = { alta: 0, media: 1, info: 2 };

export function buildSuggestions(input: {
  campaigns: CampaignAnalytics[];
  stepsByCampaign: Record<string, CampaignStep[]>;
  replies: { category: ReplyCategory; from: string; ts: string }[];
  hotLeads: HotLead[];
  accounts: AccountHealth[];
}): Suggestion[] {
  const { campaigns, stepsByCampaign, replies, hotLeads, accounts } = input;
  const out: Suggestion[] = [];
  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));

  // ── Copy / varianti A/B: variante che sotto-performa in modo netto ───────────
  for (const [cid, steps] of Object.entries(stepsByCampaign)) {
    const byStep = new Map<number, CampaignStep[]>();
    for (const s of steps) {
      const arr = byStep.get(s.step) ?? [];
      arr.push(s);
      byStep.set(s.step, arr);
    }
    for (const [stepNum, variants] of byStep) {
      if (variants.length < 2) continue;
      const withRate = variants.map((v) => ({ v, r: rate(v.replies, v.sent) }));
      const best = Math.max(...withRate.map((x) => x.r));
      for (const { v, r } of withRate) {
        if (v.sent >= 40 && best > 0 && r < 0.5 * best) {
          const cname = nameById.get(cid) ?? "campagna";
          out.push({
            id: `ab-${cid}-${v.step}-${v.variant}`,
            severity: "media",
            area: "copy",
            title: `Variante ${v.variant} dello step ${stepNum + 1} sotto-performa`,
            detail: `In "${cname}" la variante ${v.variant} ha reply rate ${pct(r)} su ${v.sent} invii, contro ${pct(best)} della migliore. A parità di aperture, non converte.`,
            action: `Metti in pausa la variante ${v.variant} e riscrivi l'angolo (proof + CTA), non ritoccarla.`,
          });
        }
      }
    }

    // ── Drop-off di sequenza: reply rate crolla passando allo step successivo ──
    const stepReply = [...byStep.entries()]
      .map(([n, vs]) => {
        const sent = vs.reduce((a, v) => a + v.sent, 0);
        const rep = vs.reduce((a, v) => a + v.replies, 0);
        return { n, sent, r: rate(rep, sent) };
      })
      .sort((a, b) => a.n - b.n);
    for (let i = 1; i < stepReply.length; i++) {
      const prev = stepReply[i - 1];
      const cur = stepReply[i];
      if (prev.r > 0 && cur.sent >= 40 && cur.r < 0.3 * prev.r) {
        const cname = nameById.get(cid) ?? "campagna";
        out.push({
          id: `drop-${cid}-${cur.n}`,
          severity: "info",
          area: "sequenza",
          title: `Calo forte allo step ${cur.n + 1}`,
          detail: `In "${cname}" il reply rate passa da ${pct(prev.r)} (step ${prev.n + 1}) a ${pct(cur.r)} (step ${cur.n + 1}).`,
          action: `Cambia oggetto/angolo dello step ${cur.n + 1} o accorcia la sequenza.`,
        });
      }
    }
  }

  // ── Deliverability: account a rischio + bounce di campagna alto ──────────────
  const badAccounts = accounts.filter((a) => a.healthScore < 50 || a.status < 0);
  if (badAccounts.length) {
    out.push({
      id: "deliv-accounts",
      severity: "alta",
      area: "deliverability",
      title: `${badAccounts.length} casella/e mittente a rischio`,
      detail: `${badAccounts.map((a) => a.email).slice(0, 5).join(", ")} — health basso o stato di errore. Con un solo dominio d'invio, un problema qui ferma tutta la campagna.`,
      action: "Verifica warmup/DNS della casella e riduci temporaneamente il volume.",
    });
  }
  for (const c of campaigns) {
    const bounce = rate(c.bounced, c.emailsSent);
    if (c.emailsSent >= 50 && bounce > 0.04) {
      out.push({
        id: `bounce-${c.id}`,
        severity: "alta",
        area: "deliverability",
        title: `Bounce alto in "${c.name}" (${pct(bounce)})`,
        detail: `${c.bounced} bounce su ${c.emailsSent} invii: probabile lista non verificata. Rischio reputazione dominio.`,
        action: "Metti in pausa, verifica la lista (MillionVerifier) e rimuovi gli indirizzi non validi.",
      });
    }
    // ── Aperture gonfiate (Apple MPP): tante aperture, zero reply ──────────────
    const openR = rate(c.opensUnique, c.contacted);
    if (c.contacted >= 40 && openR > 0.85 && c.repliesUnique === 0) {
      out.push({
        id: `mpp-${c.id}`,
        severity: "info",
        area: "copy",
        title: `"${c.name}": aperture gonfiate, nessuna reply`,
        detail: `Open ${pct(openR)} ma 0 risposte: le aperture sono probabilmente inflazionate (Apple MPP). Guarda i click, non le aperture.`,
        action: "Il problema è copy/offerta/CTA, non la deliverability: rifai l'angolo.",
      });
    }
    // ── Lista quasi esaurita su campagna attiva ────────────────────────────────
    if (c.status === 1 && c.leads > 0 && rate(c.completed, c.leads) > 0.8) {
      out.push({
        id: `list-${c.id}`,
        severity: "media",
        area: "lista",
        title: `Lista quasi esaurita in "${c.name}"`,
        detail: `${c.completed} lead completati su ${c.leads}: la sequenza sta finendo i contatti.`,
        action: "Aggiungi nuove agenzie immobiliari verificate (filtro Industry = real estate).",
      });
    }
  }

  // ── Follow-up caldi: CLICCATORI con telefono da richiamare (≥3 giorni) ────────
  const toCall = hotLeads
    .filter((l) => l.clicked && l.phone && daysSince(l.lastContact) >= 3)
    .sort((a, b) => daysSince(b.lastContact) - daysSince(a.lastContact));
  if (toCall.length) {
    const sample = toCall.slice(0, 5).map((l) => l.company || l.email).join(", ");
    out.push({
      id: "followup-clickers",
      severity: "alta",
      area: "follow-up",
      title: `${toCall.length} contatto/i caldo/i da richiamare (hanno cliccato)`,
      detail: `Hanno cliccato il link tracciato e hanno un telefono: ${sample}${toCall.length > 5 ? ", …" : ""}. Chi clicca va richiamato entro 24–48h.`,
      action: "Passa questi cliccatori al team telesetting per la chiamata di qualifica.",
    });
  }

  // ── Triage risposte: positivi, persone sbagliate, opt-out ────────────────────
  const count = (cat: ReplyCategory) => replies.filter((r) => r.category === cat).length;
  const pos = count("positivo");
  if (pos > 0) {
    out.push({
      id: "replies-positive",
      severity: "alta",
      area: "follow-up",
      title: `${pos} risposta/e positiva/e da gestire`,
      detail: "Ci sono risposte con intento positivo in attesa: preparane la replica e passale al telesetting.",
      action: "Rivedi le bozze qui sotto e copiale/invia dopo revisione.",
    });
  }
  const wrong = count("persona_sbagliata");
  if (wrong > 0) {
    out.push({
      id: "replies-wrong",
      severity: "media",
      area: "follow-up",
      title: `${wrong} "persona sbagliata"`,
      detail: "Contatti che dicono di non essere il referente giusto: chiedi gentilmente chi lo è, senza ripitchare.",
      action: "Usa la bozza 'chiedi referente' e aggiorna il contatto in lista.",
    });
  }
  const opt = count("opt_out");
  if (opt > 0) {
    out.push({
      id: "replies-optout",
      severity: "info",
      area: "lista",
      title: `${opt} opt-out da bloccare`,
      detail: "Richieste esplicite di non essere più contattati: vanno aggiunte alla blocklist e mai ricontattate.",
      action: "Bloccale (già gestito in automatico dalla suppression, verifica che siano in blocklist).",
    });
  }

  return out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}
