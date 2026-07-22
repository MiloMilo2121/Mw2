// Audit log for Instantly writes (P1.2). EVERY write (cron move, UI upload,
// agent) appends here. Best-effort: writing the audit row must NEVER throw or
// break the write it records. No-op when Supabase isn't configured.

import { getSupabase } from "./supabase";

export type AuditEntry = {
  clientSlug: string;
  actor: "cron" | "ui" | "agent";
  azione: string; // e.g. move_sassi_rosa | add_leads_to_campaign | blocklist
  target?: string;
  campaignId?: string;
  count?: number;
  motivo?: string;
  meta?: unknown;
};

export async function logAudit(e: AuditEntry): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("audit_log").insert({
      client_slug: e.clientSlug,
      actor: e.actor,
      azione: e.azione,
      target: e.target ?? null,
      campaign_id: e.campaignId ?? null,
      count: e.count ?? 0,
      motivo: e.motivo ?? null,
      meta: e.meta ?? null,
    });
  } catch {
    // swallow — audit is observability, never a failure path for the write itself
  }
}

export async function listAudit(clientSlug: string, limit = 100): Promise<Record<string, unknown>[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("audit_log")
    .select("*")
    .eq("client_slug", clientSlug)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
