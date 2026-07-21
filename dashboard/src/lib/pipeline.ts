// ─────────────────────────────────────────────────────────────────────────────
// pipeline.ts — assembla la PIPELINE INBOUND per il setter che chiama.
//
// Una riga per lead che ha RISPOSTO (dedup per mittente, tenuta la risposta più
// recente), arricchita con i dati di contatto (telefono verificato incluso), la
// categoria della risposta, l'interesse e la data dell'ultima interazione.
//
// SOLA LETTURA verso Instantly. Nessun invio, nessun cambio di stato.
// La scrittura sul Google Sheet la fa sheets.ts; qui si costruiscono solo i dati.
// ─────────────────────────────────────────────────────────────────────────────

import {
  fetchEmails,
  fetchLeads,
  fetchCampaignsLite,
  getScopedCampaignIds,
  type RawEmail,
} from "./instantly";
import { categorizeReply, firstMessage, CATEGORY_LABEL, type ReplyCategory } from "./replies";
import { getVerified } from "./verified";
import type { ClientConfig, Lead } from "./types";

// Intestazione del foglio (ordine delle colonne). Tutto ciò che serve al setter.
export const PIPELINE_HEADER = [
  "Priorità",
  "Da chiamare",
  "Ultima interazione",
  "Nome",
  "Cognome",
  "Azienda",
  "Ruolo",
  "Telefono",
  "Email",
  "Città",
  "Categoria risposta",
  "Interesse",
  "Oggetto ricevuto",
  "Risposta ricevuta",
  "Aperture",
  "Click",
  "Campagna",
  "Stato lead",
  "Sito",
  "Esito call",
  "Note setter",
  "Aggiornato il",
];

const str = (v: unknown) => (typeof v === "string" ? v : "");

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
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t === 0) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function maxIso(...vals: (string | null | undefined)[]): string {
  let best = "";
  let bestT = -1;
  for (const v of vals) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (Number.isFinite(t) && t > bestT) {
      bestT = t;
      best = v;
    }
  }
  return best;
}

// Chi va chiamato e con che priorità (il segnale forte Geriko: risposta positiva
// + telefono disponibile). opt_out/auto_reply non sono nella lista chiamate.
function callability(category: ReplyCategory, phone: string, interest: number) {
  if (category === "opt_out") return { call: "NO — opt-out", prio: 4 };
  if (category === "auto_reply") return { call: "No — auto", prio: 5 };
  if (category === "persona_sbagliata") return { call: "Chiedi referente", prio: 3 };
  const hot = category === "positivo" || interest > 0;
  if (hot && phone) return { call: "Sì", prio: 0 };
  if (hot) return { call: "Sì (no tel.)", prio: 1 };
  return { call: "Sì", prio: 2 };
}
const PRIO_LABEL = ["🔥 Alta", "Alta", "Media", "Referente", "—", "—"];

type Row = (string | number)[];

export type PipelineResult = {
  header: string[];
  rows: Row[];
  count: number;
  generatedAt: string;
};

/** Costruisce le righe della pipeline inbound per un cliente. SOLA LETTURA. */
export async function buildPipeline(client: ClientConfig): Promise<PipelineResult> {
  const key = client.instantlyApiKey;
  const generatedAt = new Date().toISOString();
  if (!key) return { header: PIPELINE_HEADER, rows: [], count: 0, generatedAt };

  // Scope campagne del cliente (per account o per nome).
  const scoped = await getScopedCampaignIds(key, {
    accountKeywords: client.campaignAccountMatch,
    nameKeywords: client.campaignMatch,
  });
  const camps = await fetchCampaignsLite(key).catch(() => []);
  const nameById = new Map(camps.map((c) => [c.id, c.name]));
  const ids = scoped ? [...scoped] : camps.map((c) => c.id);

  // Lead di tutte le campagne → indice per email (per arricchire i repliers).
  const leadPages = await Promise.all(
    ids.map((cid) => fetchLeads(key, { campaignId: cid, maxLeads: 1000 }).catch(() => [] as Lead[]))
  );
  const leadByEmail = new Map<string, Lead>();
  for (const l of leadPages.flat()) {
    const e = l.email.toLowerCase();
    if (e && !leadByEmail.has(e)) leadByEmail.set(e, l);
  }

  // Risposte inbound (ue_type 2) di tutte le campagne → dedup per mittente (più recente).
  const emailPages = await Promise.all(
    ids.map((cid) =>
      fetchEmails(key, { campaignId: cid, maxEmails: 300 })
        .then((es) => es.map((e) => ({ e, cid })))
        .catch(() => [] as { e: RawEmail; cid: string }[])
    )
  );
  const latestByFrom = new Map<string, { e: RawEmail; cid: string }>();
  for (const { e, cid } of emailPages.flat()) {
    if (Number(e.ue_type) !== 2) continue;
    const from = str(e.from_address_email).toLowerCase();
    if (!from) continue;
    const ts = str(e.timestamp_email) || str(e.timestamp_created);
    const cur = latestByFrom.get(from);
    const curTs = cur ? str(cur.e.timestamp_email) || str(cur.e.timestamp_created) : "";
    if (!cur || ts > curTs) latestByFrom.set(from, { e, cid });
  }

  const rows: { prio: number; row: Row; sortTs: string }[] = [];
  for (const [from, { e, cid }] of latestByFrom) {
    const subject = str(e.subject);
    const body = bodyText(e);
    const category = categorizeReply({ from, subject, body });
    const replyTs = str(e.timestamp_email) || str(e.timestamp_created);

    const lead = leadByEmail.get(from);
    const v = getVerified(from);
    const firstName = lead?.firstName || v?.firstName || "";
    const lastName = lead?.lastName || "";
    const company = lead?.company || v?.companyName || "";
    const role = lead?.jobTitle || v?.jobTitle || "";
    const phone = lead?.phone || v?.phone || "";
    const city = lead?.city || v?.city || "";
    const website = lead?.website || v?.website || "";
    const interest = lead?.interestStatus ?? 0;
    const interestLabel = lead?.interestLabel || "";
    const opens = lead?.opens ?? 0;
    const clicks = lead?.clicks ?? 0;
    const statusLabel = lead?.statusLabel || "";
    const campaign = nameById.get(cid) || nameById.get(lead?.campaignId || "") || "";

    const lastInteraction = maxIso(replyTs, lead?.lastOpen, lead?.lastContact);
    const { call, prio } = callability(category, phone, interest);

    const row: Row = [
      PRIO_LABEL[prio],
      call,
      fmtDate(lastInteraction),
      firstName,
      lastName,
      company,
      role,
      phone,
      from,
      city,
      CATEGORY_LABEL[category],
      interestLabel,
      subject,
      firstMessage(body).replace(/\s+/g, " ").slice(0, 600),
      opens,
      clicks,
      campaign,
      statusLabel,
      website,
      "", // Esito call — lo compila il setter
      "", // Note setter — lo compila il setter
      fmtDate(generatedAt),
    ];
    rows.push({ prio, row, sortTs: lastInteraction });
  }

  // Ordina: priorità (chiamabili prima) poi ultima interazione più recente.
  rows.sort((a, b) => a.prio - b.prio || b.sortTs.localeCompare(a.sortTs));

  return { header: PIPELINE_HEADER, rows: rows.map((r) => r.row), count: rows.length, generatedAt };
}
