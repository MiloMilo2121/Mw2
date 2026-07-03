// ─────────────────────────────────────────────────────────────────────────────
// Automations: rules that move/add leads between Instantly campaigns.
//
// First rule (Geriko): when a lead in a Sassi (e.sassi) campaign has received all
// 3 steps, hasn't replied, and 2+ days have passed since the last step, ADD it to
// the matching Carretta (step-4) campaign — keeping it in the source.
//
// Runs in dry-run by default (lists who WOULD be added, writes nothing).
// ─────────────────────────────────────────────────────────────────────────────

import {
  addLeadsToCampaign,
  fetchRawCampaignLeads,
  fetchEmails,
  addToBlocklist,
  type RawEmail,
} from "./instantly";
import { categorizeReply, AUTO_SUPPRESS } from "./replies";

type Mapping = { sourceId: string; sourceName: string; targetId: string; targetName: string };
export type Automation = {
  id: string;
  name: string;
  description: string;
  minDays: number;
  mappings: Mapping[];
};

// Per-client automations (keyed by client slug).
const AUTOMATIONS: Record<string, Automation[]> = {
  geriko: [
    {
      id: "sassi-to-carretta",
      name: "Sassi → Carretta (step 4)",
      description:
        "Lead che hanno ricevuto tutti e 3 gli step Sassi, senza risposta da 2+ giorni → aggiunti alla campagna Carretta (step 4).",
      minDays: 2,
      mappings: [
        {
          sourceId: "1dba8a9a-34e9-4bad-a3fd-48a6bb014483",
          sourceName: "Geriko CON NOME · Sassi 1-3",
          targetId: "a69e6b45-b71c-44ba-ae8a-f9f7e49a30c7",
          targetName: "Geriko CON NOME · Rosa 4 · Chiusura",
        },
        {
          sourceId: "070607dd-02fa-4a20-97ab-3c363e8b301e",
          sourceName: "Geriko GENERIC · Sassi 1-3",
          targetId: "b4d3fda9-134b-4595-b79d-1fc354438b8b",
          targetName: "Geriko GENERIC · Rosa 4 · Chiusura",
        },
      ],
    },
  ],
};

export function getAutomations(slug: string): Automation[] {
  return AUTOMATIONS[slug] ?? [];
}
export function getAutomation(slug: string, id: string): Automation | undefined {
  return getAutomations(slug).find((a) => a.id === id);
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** Step index of the last step the lead received (0-based); -1 if unknown. */
function lastStepIndex(raw: Record<string, unknown>): number {
  const ss = raw.status_summary as { lastStep?: { stepID?: string } } | undefined;
  const sid = ss?.lastStep?.stepID ?? "";
  const parts = String(sid).split("_");
  return parts.length >= 2 ? parseInt(parts[1], 10) : -1;
}
function lastStepTime(raw: Record<string, unknown>): number {
  const ss = raw.status_summary as { lastStep?: { timestamp_executed?: string } } | undefined;
  const ts = ss?.lastStep?.timestamp_executed ?? (raw.timestamp_last_contact as string) ?? "";
  const t = ts ? new Date(ts).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

export type EligibleLead = {
  email: string;
  firstName: string;
  company: string;
  daysSinceLastStep: number;
};

function isEligible(raw: Record<string, unknown>, minDays: number): boolean {
  // Received all 3 steps (3rd step index >= 2), no reply, not interested,
  // and the last step was sent at least `minDays` ago.
  if (lastStepIndex(raw) < 2) return false;
  if (num(raw.email_reply_count) > 0) return false;
  if (num(raw.lt_interest_status) > 0) return false;
  const ts = lastStepTime(raw);
  if (!ts) return false;
  return (Date.now() - ts) / 86400000 >= minDays;
}

export type MappingResult = {
  sourceName: string;
  targetName: string;
  eligible: EligibleLead[];
  added?: number;
  error?: string;
};

/** Evaluate an automation. dryRun=true never writes. */
export async function runAutomation(
  apiKey: string,
  automation: Automation,
  dryRun: boolean
): Promise<{ dryRun: boolean; results: MappingResult[]; totalEligible: number }> {
  const results: MappingResult[] = [];
  for (const m of automation.mappings) {
    try {
      const raw = await fetchRawCampaignLeads(apiKey, m.sourceId);
      const eligibleRaw = raw.filter((l) => isEligible(l, automation.minDays));
      const eligible: EligibleLead[] = eligibleRaw.map((l) => ({
        email: String(l.email ?? ""),
        firstName: String(l.first_name ?? ""),
        company: String(l.company_name ?? ""),
        daysSinceLastStep: Math.floor((Date.now() - lastStepTime(l)) / 86400000),
      }));
      const result: MappingResult = {
        sourceName: m.sourceName,
        targetName: m.targetName,
        eligible,
      };
      if (!dryRun && eligible.length) {
        const payload = eligibleRaw.map((l) => ({
          email: l.email,
          first_name: l.first_name,
          last_name: l.last_name,
          company_name: l.company_name,
        }));
        const res = await addLeadsToCampaign(apiKey, m.targetId, payload);
        result.added = res.added;
        if (res.errors > 0) result.error = `${res.errors} lead non aggiunti (errore API)`;
      }
      results.push(result);
    } catch (err) {
      results.push({
        sourceName: m.sourceName,
        targetName: m.targetName,
        eligible: [],
        error: (err as Error).message,
      });
    }
  }
  return {
    dryRun,
    results,
    totalEligible: results.reduce((s, r) => s + r.eligible.length, 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-suppression: read inbound replies, and for the clear-opt-out ones add the
// sender to the Instantly blocklist so no campaign contacts them again. Only the
// AUTO_SUPPRESS categories are acted on — everything else is left for review.
// ─────────────────────────────────────────────────────────────────────────────

function emailBodyText(e: RawEmail): string {
  const b = e.body as unknown;
  if (typeof b === "string") return b;
  if (b && typeof b === "object") {
    const o = b as { text?: string; html?: string };
    return (o.text || o.html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

export async function runSuppression(
  apiKey: string,
  campaignIds: string[],
  dryRun = false
): Promise<{ dryRun: boolean; candidates: string[]; blocked: string[]; errors: number }> {
  const perCampaign = await Promise.all(
    campaignIds.map((id) =>
      fetchEmails(apiKey, { campaignId: id, maxEmails: 500 }).catch(() => [] as RawEmail[])
    )
  );
  const replies = perCampaign.flat().filter((e) => Number(e.ue_type) === 2);

  // Unique sender emails whose reply is a clear opt-out.
  const candidates = new Set<string>();
  for (const e of replies) {
    const from = String(e.from_address_email ?? "").toLowerCase();
    if (!from) continue;
    const category = categorizeReply({
      from,
      subject: String(e.subject ?? ""),
      body: emailBodyText(e),
    });
    if (AUTO_SUPPRESS.includes(category)) candidates.add(from);
  }

  const list = [...candidates];
  if (dryRun) return { dryRun: true, candidates: list, blocked: [], errors: 0 };

  const blocked: string[] = [];
  let errors = 0;
  for (const email of list) {
    const res = await addToBlocklist(apiKey, email);
    if (res.ok) blocked.push(email);
    else errors++;
  }
  return { dryRun: false, candidates: list, blocked, errors };
}
