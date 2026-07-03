"use client";

import { useState } from "react";
import { useReplies } from "./hooks";
import { FeedbackButton } from "./FeedbackButton";
import { fmtInt, fmtDateTime } from "@/lib/format";
import { CATEGORY_LABEL, type ReplyCategory } from "@/lib/replies";

// Live inbox of prospect replies, auto-categorised. Turns "0 visibility on
// feedback" into a triage view: hot leads, opt-outs (auto-blocked), and noise.
const STYLE: Record<ReplyCategory, { bg: string; color: string }> = {
  positivo: { bg: "rgba(31,157,122,.14)", color: "var(--good)" },
  opt_out: { bg: "rgba(200,60,60,.14)", color: "var(--bad)" },
  persona_sbagliata: { bg: "rgba(192,138,30,.16)", color: "var(--warn)" },
  gia_cliente: { bg: "rgba(192,138,30,.16)", color: "var(--warn)" },
  auto_reply: { bg: "var(--panel-2)", color: "var(--muted)" },
  altro: { bg: "var(--panel-2)", color: "var(--muted)" },
};

const FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Tutte" },
  { id: "positivo", label: "Positivi" },
  { id: "opt_out", label: "Opt-out" },
  { id: "persona_sbagliata", label: "Persona sbagliata" },
  { id: "gia_cliente", label: "Già cliente" },
  { id: "auto_reply", label: "Auto-reply" },
];

export function RepliesTab({ slug }: { slug: string }) {
  const { data, isLoading } = useReplies(slug);
  const [filter, setFilter] = useState("all");

  const items = data?.items ?? [];
  const rows = filter === "all" ? items : items.filter((i) => i.category === filter);
  const c = data?.counts ?? {};

  return (
    <div className="flex flex-col gap-4">
      {/* Category summary */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Positivi" value={fmtInt(c.positivo ?? 0)} color="#1f9d7a" />
        <Stat label="Opt-out (bloccati)" value={fmtInt(c.opt_out ?? 0)} color="#c83c3c" />
        <Stat label="Persona sbagliata" value={fmtInt(c.persona_sbagliata ?? 0)} color="#c08a1e" />
        <Stat label="Risposte totali" value={fmtInt(data?.total ?? 0)} />
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-center gap-3 p-3 no-print">
        <div className="flex flex-wrap overflow-hidden rounded-lg border border-[var(--border)]">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 text-sm ${
                filter === f.id ? "accent-bg font-medium" : "muted hover:text-[var(--text)]"
              }`}
            >
              {f.label}
              {f.id !== "all" && c[f.id as ReplyCategory] ? ` (${c[f.id as ReplyCategory]})` : ""}
            </button>
          ))}
        </div>
        <FeedbackButton slug={slug} target="replies" targetLabel="Risposte" compact />
      </div>

      {/* List */}
      {isLoading && !data ? (
        <div className="card p-8 text-center text-sm muted">Carico le risposte…</div>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center text-sm muted">
          {items.length === 0 ? "Ancora nessuna risposta dai prospect." : "Nessuna risposta con questo filtro."}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            const st = STYLE[r.category];
            return (
              <div key={r.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-md px-2 py-0.5 text-xs font-medium"
                        style={{ background: st.bg, color: st.color }}
                      >
                        {CATEGORY_LABEL[r.category]}
                      </span>
                      {r.autoSuppress ? (
                        <span className="rounded-md bg-[var(--panel-2)] px-2 py-0.5 text-[11px] muted">
                          bloccato in automatico
                        </span>
                      ) : null}
                      <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                        {r.agency || r.from}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs muted">{r.from}</div>
                  </div>
                  <div className="shrink-0 text-xs muted">{fmtDateTime(r.ts)}</div>
                </div>
                {r.subject ? (
                  <div className="mt-2 text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {r.subject}
                  </div>
                ) : null}
                <div className="mt-1 text-sm muted">{r.snippet}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card px-5 py-4">
      <div className="text-xs uppercase tracking-wide muted">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color: color ?? "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}
