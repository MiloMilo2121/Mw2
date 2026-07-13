// ─────────────────────────────────────────────────────────────────────────────
// Geriko Playbook — grounding per l'agente (versionato in git, revisionato via PR).
//
// Fonte: allineamento con AXEND/Geriko (2026-07). Questo file è il CONTESTO che
// l'agente usa per scrivere le risposte e che i revisori usano per accettare o
// bloccare i claim. Modificare SOLO con revisione: da qui dipende cosa l'agente
// può affermare a un prospect reale.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReplyCategory } from "@/lib/replies";

export const GERIKO_BRAND = {
  company: "Geriko",
  poweredBy: "MOW srl",
  domain: "metodogeriko.it",
  audience:
    "agenzie immobiliari indipendenti o piccole reti (4–15 persone), Nord Italia (Triveneto e Lombardia in primis). Decisore: il titolare / managing partner.",
  register:
    'Lei formale, diretto, tra pari — NON corporate. Frasi brevi, concrete. Il titolare compra protezione reputazionale e differenziazione in acquisizione, non software.',
  senders: {
    acquisizione: { name: "Emanuele Sassi", role: "COO", steps: "email 1–3 (acquisizione)" },
    chiusura: { name: "Rosa Carretta", role: "CEO", step: "email 4 (chiusura)" },
  },
  valueProp:
    'Geriko è un SaaS che struttura la fase competitiva della vendita immobiliare in una procedura tra privati (NON giudiziaria): pre-valutazione, open house strutturata, invito selettivo, iscrizione con cauzione su conto Stripe dedicato, asta online 24h con offerte vincolanti, aggiudicazione con audit trail. Posizionamento: metodo difendibile per gestire la multiproposta; l\'agenzia resta regista e non viene disintermediata. NON è "software d\'asta".',
} as const;

// Fatti che l'agente PUÒ citare (il revisore "fatti" li considera supportati).
// Solo case study documentati con numeri verificabili. NIENTE testimonianze.
export const CITABLE_FACTS: string[] = [
  "5 operazioni immobiliari documentate con il metodo; incremento sul prezzo tra +5,5% e +36,7%; mediana +9%.",
  "Caso reale a Gallarate (Varese): immobile da 55.000€ aggiudicato a 75.200€ (+36,73%), 7 partecipanti, in 8 giorni.",
  "Fascia tipica degli immobili gestiti: 75.000€–275.000€.",
  "Tre meccanismi del metodo: cauzione su conto Stripe dedicato (filtra i curiosi), modulo 'Aggiudica Ora' (chiude rapidamente), audit trail (difendibilità documentale verso venditore e acquirenti esclusi).",
  "Differenziazione: Geriko non genera domanda come i portali e non disintermedia l'agenzia come i modelli phygital; struttura la fase competitiva sui buyer che l'agenzia già porta.",
];

// Claim VIETATI: il revisore compliance/fatti li blocca SEMPRE (oltre a numeri
// non presenti nel contesto). Ognuno con la ragione.
export const FORBIDDEN_CLAIMS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\+\s*20\s*%|20\s*%[^0-9]{0,25}(acquisiz|incarich)/i, reason: 'claim "+20% acquisizioni" non validato (0 agenzie documentate)' },
  { pattern: /garant\w*\s+(il|un|lo)?\s*(miglior|massimo|piu alto|più alto)\s+prezzo|prezzo\s+garantit|garantiamo\s+(il|un)?\s*prezzo/i, reason: "claim assoluto sul prezzo (vietato)" },
  { pattern: /asta\s+giudiziar|pignorament|esecuzione\s+forzat|\bNPL\b|tribunale|immobil\w*\s+occupat/i, reason: "ambiguità con l'asta giudiziaria/esecutiva (rischio semantico #1)" },
  { pattern: /piattaforma\s+innovativ|tecnologi\w*\s+(avanzat|innovativ)|soluzione\s+innovativ|all'avanguardia|rivoluzionari/i, reason: "lessico dell'innovazione (fuori dal frame del titolare)" },
  { pattern: /testimonianz|dicono\s+di\s+noi|i\s+nostri\s+client\w*\s+(dicono|raccontano|confermano)/i, reason: "testimonianze non ancora autorizzate all'uso commerciale" },
];

// Parole-spam da rifiutare a prescindere.
export const SPAM_DENYLIST: string[] = [
  "gratis",
  "100% garantito",
  "garantito al 100",
  "clicca qui",
  "offerta imperdibile",
  "affrettati",
  "solo per oggi",
  "soldi facili",
  "guadagna subito",
  "!!!",
];

// CTA: NIENTE Calendly (decisione: il cliente riprogramma in privato e salta
// l'attribuzione). Il lead caldo è chi CLICCA il link tracciato; lo richiama il
// team telesetting Geriko entro 24–48h. In una risposta email l'agente propone
// un confronto breve e si offre di coordinare un orario — non allega link esterni.
export const CTA_POLICY =
  "NON usare mai Calendly o link di prenotazione esterni. Per un contatto positivo proponi un confronto telefonico breve e offri di coordinare un orario (es. 'se le fa comodo la richiamo io, mi dica pure due momenti'). Obiettivo della call: qualificare il bisogno e, se c'è fit, fissare una demo. NON vendere nella risposta.";

// Playbook per categoria di risposta (guida il generatore).
export const CATEGORY_PLAYBOOK: Record<ReplyCategory, string> = {
  positivo:
    "Ringrazia, riaggancia al punto specifico che ha sollevato, e proponi un confronto breve seguendo la CTA policy. Tono caldo ma sobrio. Nessun claim non citabile.",
  persona_sbagliata:
    "Scusati per il disturbo, ringrazia, e chiedi gentilmente chi è il referente giusto per la gestione delle vendite/acquisizioni in agenzia. NON ripitchare il prodotto, non insistere.",
  gia_cliente:
    "Ringrazia, chiedi se hanno bisogno di supporto sull'uso del metodo o su una funzione specifica. Non vendere altro.",
  altro:
    "Rispondi nel merito di ciò che ha scritto, in modo utile e conciso, poi una CTA soft coerente con la policy. Niente pressione.",
  opt_out:
    "NON generare risposta: il contatto va rimosso e bloccato, non ricontattato.",
  auto_reply:
    "NON generare risposta: è un messaggio automatico.",
};

/** Blocco di grounding testuale iniettato nel prompt del generatore e usato come
 *  "contesto ammesso" dal revisore fatti (i numeri citabili qui dentro sono ok). */
export function groundingContext(): string {
  return [
    `AZIENDA: ${GERIKO_BRAND.company} (${GERIKO_BRAND.poweredBy}), dominio ${GERIKO_BRAND.domain}.`,
    `COSA VENDE: ${GERIKO_BRAND.valueProp}`,
    `PUBBLICO: ${GERIKO_BRAND.audience}`,
    `REGISTRO: ${GERIKO_BRAND.register}`,
    `MITTENTI: ${GERIKO_BRAND.senders.acquisizione.name} (${GERIKO_BRAND.senders.acquisizione.role}, ${GERIKO_BRAND.senders.acquisizione.steps}); ${GERIKO_BRAND.senders.chiusura.name} (${GERIKO_BRAND.senders.chiusura.role}, ${GERIKO_BRAND.senders.chiusura.step}).`,
    `FATTI CITABILI (usa SOLO questi, e solo se pertinenti):`,
    ...CITABLE_FACTS.map((f) => `  - ${f}`),
    `CTA: ${CTA_POLICY}`,
    `VIETATO: nessun numero/percentuale/euro fuori da questi fatti; niente "+20% acquisizioni"; niente testimonianze; niente garanzie sul prezzo; nessuna ambiguità con l'asta giudiziaria/esecutiva (questa è un'asta TRA PRIVATI); niente lessico da "piattaforma innovativa".`,
  ].join("\n");
}
