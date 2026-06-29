"use client";

import { useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import { useLeads } from "./hooks";
import { FeedbackButton } from "./FeedbackButton";
import { fmtInt } from "@/lib/format";

// "Aperture & Click": engaged leads (opened / clicked), enriched with the verified
// Drive report (phone, verification, clean details) joined by email — so Geriko
// can follow up by phone with the people actually showing interest.
const FILTERS = [
  { id: "interested", label: "Interessati" },
  { id: "replied", label: "Hanno risposto" },
  { id: "opened", label: "Hanno aperto" },
  { id: "clicked", label: "Hanno cliccato" },
  { id: "all", label: "Tutti gli engaged" },
];

export function EngagementTab({ snap, slug }: { snap: DashboardSnapshot; slug: string }) {
  const [filter, setFilter] = useState("opened");
  const [campaign, setCampaign] = useState("");
  const [q, setQ] = useState("");
  const { data, isLoading } = useLeads(slug, { filter, campaign, q });

  // For the "all engaged" view, drop the un-engaged rows the API may return.
  const rows = (data?.leads ?? []).filter((l) =>
    filter === "all" ? l.opens > 0 || l.clicks > 0 : true
  );
  const withPhone = rows.filter((l) => l.phone).length;
  const interestColor = (v: number) =>
    v >= 1 ? "var(--good)" : v < 0 ? "var(--bad)" : "var(--muted)";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Interessati" value={data ? fmtInt(data.engaged.interested) : "…"} color="#1f9d7a" />
        <Stat label="Hanno risposto" value={data ? fmtInt(data.engaged.replied) : "…"} color="#c08a1e" />
        <Stat label="Hanno aperto" value={data ? fmtInt(data.engaged.opened) : "…"} color="#244f4f" />
        <Stat label="Con telefono" value={fmtInt(withPhone)} />
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-3 no-print">
        <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 text-sm ${
                filter === f.id ? "accent-bg font-medium" : "muted hover:text-[var(--text)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          className="rounded-lg card-2 px-3 py-1.5 text-sm outline-none"
        >
          <option value="">Tutte le campagne</option>
          {snap.campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cerca nome, azienda o email…"
          className="min-w-[200px] flex-1 rounded-lg card-2 px-3 py-1.5 text-sm outline-none focus:border-[var(--accent-strong)]"
        />
        <FeedbackButton slug={slug} target="engagement" targetLabel="Aperture & Click" compact />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3 text-sm">
          <span className="muted">
            {data ? `${fmtInt(rows.length)} contatti` : "Carico…"} ·{" "}
            <span className="accent">{fmtInt(withPhone)} con telefono</span> ·{" "}
            ordinati per priorità di chiamata
          </span>
          {data?.source === "mock" && <span className="text-xs muted">dati demo</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide muted">
                <th className="px-5 py-3 font-medium">Contatto</th>
                <th className="px-5 py-3 font-medium">Azienda</th>
                <th className="px-5 py-3 font-medium">Città</th>
                <th className="px-5 py-3 font-medium">Telefono</th>
                <th className="px-5 py-3 font-medium">Stato</th>
                <th className="px-5 py-3 font-medium">Verifica</th>
                <th className="px-5 py-3 text-right font-medium">Aperture</th>
                <th className="px-5 py-3 text-right font-medium">Click</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !data ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center muted">Carico…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center muted">Nessun contatto con questo filtro.</td></tr>
              ) : (
                rows.map((l) => (
                  <tr key={l.id} className="border-t border-[var(--border)] hover:bg-[var(--panel-2)]">
                    <td className="px-5 py-3">
                      <div className="font-medium" style={{ color: "var(--ink)" }}>
                        {l.firstName} {l.lastName}
                        {l.jobTitle ? <span className="muted font-normal"> · {l.jobTitle}</span> : null}
                      </div>
                      <div className="text-xs muted">{l.email}</div>
                    </td>
                    <td className="px-5 py-3">{l.company || "—"}</td>
                    <td className="px-5 py-3 muted">{l.city || "—"}</td>
                    <td className="px-5 py-3">
                      {l.phone ? (
                        <a href={`tel:${l.phone.replace(/\s/g, "")}`} className="font-medium accent">
                          {l.phone}
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {l.interestStatus !== 0 ? (
                        <span
                          className="rounded-md px-2 py-0.5 text-xs"
                          style={{ background: "rgba(31,157,122,.12)", color: interestColor(l.interestStatus) }}
                        >
                          {l.interestLabel}
                        </span>
                      ) : l.replies > 0 ? (
                        <span
                          className="rounded-md px-2 py-0.5 text-xs"
                          style={{ background: "rgba(192,138,30,.14)", color: "var(--warn)" }}
                        >
                          Risposto
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {l.verified ? (
                        <span
                          className="rounded-md px-2 py-0.5 text-xs"
                          style={{
                            background: l.quality === "good" ? "rgba(31,157,122,.12)" : "var(--panel-2)",
                            color: l.quality === "good" ? "var(--good)" : "var(--muted)",
                          }}
                        >
                          {l.quality || "verificato"}{l.result ? ` · ${l.result}` : ""}
                        </span>
                      ) : (
                        <span className="text-xs muted">non nel file</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{fmtInt(l.opens)}</td>
                    <td
                      className="px-5 py-3 text-right tabular-nums"
                      style={{ color: l.clicks > 0 ? "var(--accent-strong)" : undefined, fontWeight: l.clicks > 0 ? 600 : 400 }}
                    >
                      {fmtInt(l.clicks)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
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
