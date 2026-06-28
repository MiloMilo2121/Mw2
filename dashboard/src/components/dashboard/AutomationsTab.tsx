"use client";

import { useAutomations } from "./hooks";
import { fmtInt } from "@/lib/format";

export function AutomationsTab({ slug }: { slug: string }) {
  const { automations, isLoading } = useAutomations(slug);

  return (
    <div className="flex flex-col gap-5">
      <div className="card p-5">
        <div className="font-semibold">Automazioni</div>
        <div className="mt-1 text-sm muted">
          Regole automatiche sui lead. Modalità <b>anteprima</b>: qui vedi chi <i>verrebbe</i>{" "}
          spostato — non viene scritto nulla finché non attivi l&apos;esecuzione automatica.
        </div>
      </div>

      {isLoading && automations.length === 0 ? (
        <div className="card p-8 text-center text-sm muted">Calcolo in corso…</div>
      ) : automations.length === 0 ? (
        <div className="card p-8 text-center text-sm muted">
          Nessuna automazione configurata.
        </div>
      ) : (
        automations.map((a) => (
          <div key={a.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div>
                <div className="font-semibold">{a.name}</div>
                <div className="mt-0.5 max-w-2xl text-xs muted">{a.description}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold tabular-nums" style={{ color: "var(--accent-strong)" }}>
                  {fmtInt(a.totalEligible)}
                </div>
                <div className="text-xs muted">pronti ora</div>
              </div>
            </div>

            <div className="flex flex-col divide-y divide-[var(--border)]">
              {a.results.map((r, i) => (
                <div key={i} className="px-5 py-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{r.sourceName}</span>
                    <span className="accent">→</span>
                    <span className="font-medium">{r.targetName}</span>
                    <span
                      className="ml-auto rounded-md px-2 py-0.5 text-xs"
                      style={{
                        background: r.eligible.length ? "rgba(31,157,122,.12)" : "var(--panel-2)",
                        color: r.eligible.length ? "var(--good)" : "var(--muted)",
                      }}
                    >
                      {r.error ? "errore" : `${r.eligible.length} pronti`}
                    </span>
                  </div>
                  {r.error ? (
                    <div className="text-xs" style={{ color: "var(--bad)" }}>{r.error}</div>
                  ) : r.eligible.length === 0 ? (
                    <div className="text-xs muted">Nessun lead idoneo al momento.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px] text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide muted">
                            <th className="py-2 pr-4 font-medium">Contatto</th>
                            <th className="py-2 pr-4 font-medium">Azienda</th>
                            <th className="py-2 text-right font-medium">Da</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.eligible.slice(0, 50).map((l) => (
                            <tr key={l.email} className="border-t border-[var(--border)]">
                              <td className="py-2 pr-4">
                                <span className="font-medium" style={{ color: "var(--ink)" }}>
                                  {l.firstName || l.email}
                                </span>{" "}
                                <span className="text-xs muted">{l.email}</span>
                              </td>
                              <td className="py-2 pr-4">{l.company || "—"}</td>
                              <td className="py-2 text-right muted">{l.daysSinceLastStep}g</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {r.eligible.length > 50 && (
                        <div className="mt-2 text-xs muted">+ altri {r.eligible.length - 50}</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="border-t border-[var(--border)] bg-[var(--panel-2)] px-5 py-3 text-xs muted">
              Anteprima · per attivare lo spostamento automatico giornaliero serve il via libera
              (esecuzione protetta, non parte da sola).
            </div>
          </div>
        ))
      )}
    </div>
  );
}
