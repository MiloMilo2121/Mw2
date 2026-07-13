"use client";

import { useState } from "react";
import { useAgent } from "./hooks";
import { FeedbackButton } from "./FeedbackButton";
import { CATEGORY_LABEL } from "@/lib/replies";
import type { Suggestion } from "@/lib/optimizer";
import type { DraftResult } from "@/lib/agent";

const SEV: Record<Suggestion["severity"], { bg: string; color: string; label: string }> = {
  alta: { bg: "rgba(210,69,62,.14)", color: "var(--bad)", label: "Alta" },
  media: { bg: "rgba(192,138,30,.16)", color: "var(--warn)", label: "Media" },
  info: { bg: "var(--panel-2)", color: "var(--muted)", label: "Info" },
};

export function AgentTab({ slug }: { slug: string }) {
  const { data, isLoading } = useAgent(slug);
  const suggestions = data?.suggestions ?? [];
  const drafts = data?.drafts ?? [];
  const missingKey = drafts.some((d) => !d.llm && !d.blocked);

  return (
    <div className="flex flex-col gap-5">
      {/* Intro + feedback */}
      <div className="card flex flex-wrap items-start justify-between gap-3 p-5">
        <div>
          <div className="font-semibold">Agent · Copilot</div>
          <div className="mt-1 text-sm muted">
            Ottimizzazioni suggerite dai dati reali e bozze di risposta revisionate. In Fase 1 le
            bozze si <strong>copiano a mano</strong> — nessun invio automatico.
          </div>
        </div>
        <FeedbackButton slug={slug} target="agent" targetLabel="Agent" compact />
      </div>

      {missingKey && (
        <div className="card p-4 text-sm" style={{ borderColor: "var(--warn)" }}>
          <strong style={{ color: "var(--warn)" }}>ANTHROPIC_API_KEY mancante.</strong>{" "}
          Le bozze qui sotto sono template. Aggiungi la chiave per bozze su misura e revisori attivi.
        </div>
      )}

      {data?.note && <div className="card p-3 text-xs muted">{data.note}</div>}

      {/* ── Ottimizzazioni ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide muted">Ottimizzazioni</h2>
        {isLoading && !data ? (
          <div className="card p-8 text-center text-sm muted">Analizzo la campagna…</div>
        ) : suggestions.length === 0 ? (
          <div className="card p-8 text-center text-sm muted">Nessun suggerimento al momento.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {suggestions.map((s) => (
              <div key={s.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-md px-2 py-0.5 text-xs font-medium"
                    style={{ background: SEV[s.severity].bg, color: SEV[s.severity].color }}
                  >
                    {SEV[s.severity].label}
                  </span>
                  <span className="rounded-md bg-[var(--panel-2)] px-2 py-0.5 text-[11px] muted">
                    {s.area}
                  </span>
                  <span className="font-medium">{s.title}</span>
                </div>
                <p className="mt-1.5 text-sm">{s.detail}</p>
                {s.action && (
                  <p className="mt-1 text-sm">
                    <span className="accent">→ </span>
                    {s.action}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Bozze risposte ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide muted">Bozze risposte</h2>
        {isLoading && !data ? (
          <div className="card p-8 text-center text-sm muted">Preparo le bozze…</div>
        ) : drafts.length === 0 ? (
          <div className="card p-8 text-center text-sm muted">Nessuna risposta da gestire.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {drafts.map((d, i) => (
              <DraftCard key={`${d.from}-${i}`} draft={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DraftCard({ draft }: { draft: DraftResult }) {
  const [subject, setSubject] = useState(draft.draftSubject);
  const [body, setBody] = useState(draft.draftBody);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Oggetto: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard non disponibile */
    }
  };

  const status = draft.blocked
    ? { label: "Non contattare", color: "var(--bad)" }
    : draft.approved
      ? { label: "Approvata", color: "var(--good)" }
      : { label: "Da rivedere", color: "var(--warn)" };

  return (
    <div className="card p-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{draft.from}</span>
        <span className="rounded-md bg-[var(--panel-2)] px-2 py-0.5 text-[11px] muted">
          {CATEGORY_LABEL[draft.category]}
        </span>
        <span
          className="rounded-md px-2 py-0.5 text-xs font-medium"
          style={{ background: "var(--panel-2)", color: status.color }}
        >
          {status.label}
        </span>
      </div>

      {draft.replySnippet && (
        <p className="mt-2 rounded-md bg-[var(--panel-2)] p-2 text-xs italic muted">
          «{draft.replySnippet}»
        </p>
      )}

      {draft.blocked ? (
        <p className="mt-2 text-sm" style={{ color: "var(--bad)" }}>
          {draft.blockReason}
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-2">
            <input
              className="card-2 w-full px-3 py-2 text-sm"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Oggetto"
            />
            <textarea
              className="card-2 min-h-[160px] w-full px-3 py-2 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Corpo della risposta"
            />
          </div>

          {/* revisori */}
          {draft.reviews.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {draft.reviews.map((r) => (
                <span
                  key={r.reviewer}
                  title={r.reason || (r.pass ? "ok" : "non passato")}
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    background: "var(--panel-2)",
                    color: r.pass ? "var(--good)" : "var(--bad)",
                  }}
                >
                  {r.pass ? "✓" : "✗"} {r.reviewer}
                </span>
              ))}
            </div>
          )}

          {draft.rationale && <p className="mt-2 text-xs muted">{draft.rationale}</p>}

          {/* azioni */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={copy}
              className="rounded-lg accent-bg px-3 py-1.5 text-sm font-medium"
            >
              {copied ? "Copiato ✓" : "Copia"}
            </button>
            <button
              disabled
              title="Invio disponibile in Fase 2 (Action Center)"
              className="cursor-not-allowed rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm muted opacity-60"
            >
              Invia (Fase 2)
            </button>
            {draft.model && (
              <span className="ml-auto text-[11px] muted">{draft.model}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
