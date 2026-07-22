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
  fetchCampaignSequence,
  isBlocklisted,
  fetchEmails,
  addToBlocklist,
  type RawEmail,
} from "./instantly";
import { categorizeReply, AUTO_SUPPRESS } from "./replies";
import { logAudit } from "./audit";

type Mapping = { sourceId: string; sourceName: string; targetId: string; targetName: string };
export type Automation = {
  id: string;
  name: string;
  description: string;
  minDays: number;
  // Kill-switch. Default OFF: the automation is built and previewable (dry-run)
  // but performs NO live writes until turned on — the Rosa campaigns are active
  // and today bounce ~100%, so it must not send until deliverability is green.
  enabled: boolean;
  mappings: Mapping[];
};

// Per-client automations (keyed by client slug).
const AUTOMATIONS: Record<string, Automation[]> = {
  geriko: [
    {
      id: "sassi-to-carretta",
      name: "Sassi → Rosa (chiusura, step 4)",
      description:
        "Lead che hanno ricevuto TUTTE le email della sequenza Sassi (con e senza nome), senza risposta e da 3+ giorni dall'ultima → aggiunti alla campagna Rosa 4 (chiusura). Disabilitato finché la deliverability Rosa non è verde.",
      minDays: 3,
      enabled: false,
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

/**
 * A lead is eligible to move Sassi → Rosa when it has received ALL emails of the
 * source sequence, has not replied, is in a non-negative state (never a bounced
 * or hard-stopped lead), and the last email was delivered ≥ `minDays` ago.
 *
 * "Received all emails" is DATA-DRIVEN: `totalSteps` comes from the source
 * campaign definition (fetchCampaignSequence), so it's not a hardcoded "3".
 * The lead `status` enum is treated only by sign — verified empirically that a
 * finished lead is a positive status, a bounced/stopped one is negative — rather
 * than betting on a specific magic number (e.g. completed is 3, not 2, in the
 * live workspace). Blocklist exclusion happens in runAutomation (a network read).
 */
export function isEligible(raw: Record<string, unknown>, minDays: number, totalSteps: number): boolean {
  const idx = lastStepIndex(raw);
  if (idx < 0) return false;
  if (totalSteps > 0 && idx < totalSteps - 1) return false; // not all emails received yet
  if (num(raw.status) < 0) return false; // bounced / stopped — never move
  if (num(raw.email_reply_count) > 0) return false; // has replied — human handles it
  if (num(raw.lt_interest_status) > 0) return false; // marked interested
  const ts = lastStepTime(raw);
  if (!ts) return false; // last step must have actually been delivered
  return (Date.now() - ts) / 86400000 >= minDays;
}

export type MappingResult = {
  sourceName: string;
  targetName: string;
  totalSteps?: number;
  eligible: EligibleLead[];
  added?: number;
  error?: string;
};

/**
 * Evaluate an automation. Writes ONLY when dryRun=false AND automation.enabled.
 * A disabled automation still returns the eligible preview (writes nothing), so
 * the kill-switch and the dry-run flag both gate live writes. Every live write
 * is recorded in audit_log.
 */
export async function runAutomation(
  apiKey: string,
  automation: Automation,
  dryRun: boolean,
  clientSlug = "geriko"
): Promise<{ dryRun: boolean; enabled: boolean; results: MappingResult[]; totalEligible: number }> {
  const willWrite = !dryRun && automation.enabled;
  const results: MappingResult[] = [];
  for (const m of automation.mappings) {
    try {
      // "Received all emails" is data-driven: count the source sequence's steps.
      let totalSteps = 0;
      try {
        totalSteps = (await fetchCampaignSequence(apiKey, m.sourceId)).length;
      } catch {
        totalSteps = 0; // fall back to "reached a last step" without the length check
      }

      const raw = await fetchRawCampaignLeads(apiKey, m.sourceId);
      let eligibleRaw = raw.filter((l) => isEligible(l, automation.minDays, totalSteps));

      // Blocklist guard (network read): never move a suppressed contact to Rosa.
      if (eligibleRaw.length) {
        const checks = await Promise.all(
          eligibleRaw.map((l) => isBlocklisted(apiKey, String(l.email ?? "")).catch(() => false))
        );
        eligibleRaw = eligibleRaw.filter((_, i) => !checks[i]);
      }

      const eligible: EligibleLead[] = eligibleRaw.map((l) => ({
        email: String(l.email ?? ""),
        firstName: String(l.first_name ?? ""),
        company: String(l.company_name ?? ""),
        daysSinceLastStep: Math.floor((Date.now() - lastStepTime(l)) / 86400000),
      }));
      const result: MappingResult = { sourceName: m.sourceName, targetName: m.targetName, totalSteps, eligible };

      if (willWrite && eligible.length) {
        const payload = eligibleRaw.map((l) => ({
          email: l.email,
          first_name: l.first_name,
          last_name: l.last_name,
          company_name: l.company_name,
        }));
        const res = await addLeadsToCampaign(apiKey, m.targetId, payload);
        result.added = res.added;
        if (res.errors > 0) result.error = `${res.errors} lead non aggiunti (errore API)`;
        await logAudit({
          clientSlug,
          actor: "cron",
          azione: "move_sassi_rosa",
          target: m.targetName,
          campaignId: m.targetId,
          count: res.added,
          motivo: `${automation.id}: sequenza completata (${totalSteps || "?"} step) + ${automation.minDays}gg, no reply, non in blocklist`,
          meta: { source: m.sourceName, emails: eligible.map((e) => e.email) },
        });
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
    dryRun: !willWrite,
    enabled: automation.enabled,
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
