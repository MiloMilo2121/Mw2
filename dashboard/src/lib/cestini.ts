// Reader for the pipeline "cestini" data (Supabase, written by the Python
// pipeline). Internal only — surfaced under /admin/[secret]. Joins cestini →
// leads → flags (+ qa_results) for the most recent run of a client.
//
// Degrades gracefully: returns null when Supabase is not configured, so the
// admin view renders an empty state instead of crashing.

import { getSupabase } from "./supabase";

export type CestinoFlag = {
  tipo: string;
  valore: string | null;
  confidence: number | null;
  evidenza: string | null;
  sourceUrl: string | null;
  provider: string | null;
};

export type CestinoLead = {
  leadId: string;
  dominio: string;
  company: string | null;
  email: string | null;
  cestino: string;
  motivo: string | null;
  conNome: boolean;
  sequenzaId: string | null;
  tono: string | null;
  flags: Record<string, CestinoFlag>;
};

export type QaResult = {
  flagTipo: string;
  errorRate: number;
  approvato: boolean;
  campioneN: number;
};

export type CestiniReport = {
  runId: string;
  startedAt: string;
  total: number;
  counts: Record<string, number>;
  byCestino: Record<string, CestinoLead[]>;
  qa: QaResult[];
};

export type RunSummary = { id: string; startedAt: string; nInput: number; nOutput: number };

const CESTINO_ORDER = ["A", "B", "C", "D", "E"];

export async function listRuns(clientSlug: string): Promise<RunSummary[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("pipeline_runs")
    .select("id, started_at, n_input, n_output")
    .eq("client_slug", clientSlug)
    .order("started_at", { ascending: false })
    .limit(30);
  if (error || !data) return [];
  return data.map((r) => ({
    id: String(r.id),
    startedAt: String(r.started_at),
    nInput: Number(r.n_input ?? 0),
    nOutput: Number(r.n_output ?? 0),
  }));
}

function flagRow(r: Record<string, unknown>): CestinoFlag {
  return {
    tipo: String(r.tipo),
    valore: r.valore == null ? null : String(r.valore),
    confidence: r.confidence == null ? null : Number(r.confidence),
    evidenza: r.evidenza == null ? null : String(r.evidenza),
    sourceUrl: r.source_url == null ? null : String(r.source_url),
    provider: r.provider == null ? null : String(r.provider),
  };
}

export async function getCestiniReport(
  clientSlug: string,
  runId?: string
): Promise<CestiniReport | null> {
  const sb = getSupabase();
  if (!sb) return null;

  let rid = runId;
  let startedAt = "";
  if (!rid) {
    const runs = await listRuns(clientSlug);
    if (!runs.length) return null;
    rid = runs[0].id;
    startedAt = runs[0].startedAt;
  } else {
    const { data } = await sb.from("pipeline_runs").select("started_at").eq("id", rid).single();
    startedAt = String(data?.started_at ?? "");
  }

  const [{ data: cestini }, { data: leads }, { data: qa }] = await Promise.all([
    sb.from("cestini").select("*").eq("run_id", rid),
    sb.from("leads").select("id, dominio, company, email").eq("run_id", rid),
    sb.from("qa_results").select("flag_tipo, error_rate, approvato, campione_n").eq("run_id", rid),
  ]);
  if (!cestini || !leads) return null;

  const leadById = new Map(leads.map((l) => [String(l.id), l]));
  const leadIds = leads.map((l) => String(l.id));

  // flags for these leads (chunked to keep the IN list bounded)
  const flagsByLead = new Map<string, Record<string, CestinoFlag>>();
  for (let i = 0; i < leadIds.length; i += 500) {
    const chunk = leadIds.slice(i, i + 500);
    const { data: flags } = await sb
      .from("flags")
      .select("lead_id, tipo, valore, confidence, evidenza, source_url, provider")
      .in("lead_id", chunk);
    for (const f of flags ?? []) {
      const lid = String(f.lead_id);
      const m = flagsByLead.get(lid) ?? {};
      m[String(f.tipo)] = flagRow(f);
      flagsByLead.set(lid, m);
    }
  }

  const byCestino: Record<string, CestinoLead[]> = {};
  const counts: Record<string, number> = {};
  for (const c of cestini) {
    const lead = leadById.get(String(c.lead_id));
    const k = String(c.cestino);
    const item: CestinoLead = {
      leadId: String(c.lead_id),
      dominio: String(lead?.dominio ?? ""),
      company: lead?.company == null ? null : String(lead.company),
      email: lead?.email == null ? null : String(lead.email),
      cestino: k,
      motivo: c.motivo == null ? null : String(c.motivo),
      conNome: Boolean(c.con_nome),
      sequenzaId: c.sequenza_id == null ? null : String(c.sequenza_id),
      tono: c.tono == null ? null : String(c.tono),
      flags: flagsByLead.get(String(c.lead_id)) ?? {},
    };
    (byCestino[k] ??= []).push(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }

  return {
    runId: rid,
    startedAt,
    total: cestini.length,
    counts,
    byCestino,
    qa: (qa ?? []).map((q) => ({
      flagTipo: String(q.flag_tipo),
      errorRate: Number(q.error_rate ?? 0),
      approvato: Boolean(q.approvato),
      campioneN: Number(q.campione_n ?? 0),
    })),
  };
}

export function cestinoKeys(): string[] {
  return CESTINO_ORDER;
}
