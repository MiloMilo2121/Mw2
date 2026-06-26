"use client";

import { useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import { useLeads } from "./hooks";
import { FeedbackButton } from "./FeedbackButton";
import { fmtInt } from "@/lib/format";

const FILTERS = [
  { id: "all", label: "Tutti" },
  { id: "opened", label: "Hanno aperto" },
  { id: "clicked", label: "Hanno cliccato" },
  { id: "replied", label: "Hanno risposto" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export function ContactsTab({ snap, slug }: { snap: DashboardSnapshot; slug: string }) {
  const [filter, setFilter] = useState("clicked");
  const [campaign, setCampaign] = useState("");
  const [q, setQ] = useState("");
  const { data, isLoading } = useLeads(slug, { filter, campaign, q });

  const campName = (id: string) =>
    snap.campaigns.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-4">
      {/* Engagement summary */}
      <div className="grid grid-cols-3 gap-4 md:max-w-xl">
        <Stat label="Hanno aperto" value={data ? fmtInt(data.engaged.opened) : "…"} color="#1f9d7a" />
        <Stat label="Hanno cliccato" value={data ? fmtInt(data.engaged.clicked) : "…"} color="#244f4f" />
        <Stat label="Hanno risposto" value={data ? fmtInt(data.engaged.replied) : "…"} color="#c08a1e" />
      </div>

      {/* Controls */}
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
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cerca nome, azienda o email…"
          className="min-w-[200px] flex-1 rounded-lg card-2 px-3 py-1.5 text-sm outline-none focus:border-[var(--accent-strong)]"
        />
        <FeedbackButton slug={slug} target="contacts" targetLabel="Contatti / Engagement" compact />
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3 text-sm">
          <span className="muted">
            {data ? `${fmtInt(data.shown)} contatti` : "Carico…"}
            {data && data.shown > data.leads.length ? ` (primi ${data.leads.length})` : ""}
          </span>
          {data?.source === "mock" && <span className="text-xs muted">dati demo</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide muted">
                <th className="px-5 py-3 font-medium">Contatto</th>
                <th className="px-5 py-3 font-medium">Azienda</th>
                <th className="px-5 py-3 font-medium">Città</th>
                <th className="px-5 py-3 font-medium">Telefono</th>
                <th className="px-5 py-3 font-medium">Campagna</th>
                <th className="px-5 py-3 text-right font-medium">Aperture</th>
                <th className="px-5 py-3 text-right font-medium">Click</th>
                <th className="px-5 py-3 text-right font-medium">Reply</th>
                <th className="px-5 py-3 text-right font-medium">Ultima apertura</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !data ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center muted">
                    Carico i contatti…
                  </td>
                </tr>
              ) : data && data.leads.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center muted">
                    Nessun contatto con questo filtro.
                  </td>
                </tr>
              ) : (
                data?.leads.map((l) => (
                  <tr key={l.id} className="border-t border-[var(--border)] hover:bg-[var(--panel-2)]">
                    <td className="px-5 py-3">
                      <div className="font-medium" style={{ color: "var(--ink)" }}>
                        {l.firstName} {l.lastName}
                        {l.jobTitle ? <span className="muted font-normal"> · {l.jobTitle}</span> : null}
                      </div>
                      <div className="flex items-center gap-2 text-xs muted">
                        <span>{l.email}</span>
                        {l.linkedin ? (
                          <a href={l.linkedin} target="_blank" rel="noreferrer" className="accent" title="LinkedIn">
                            in
                          </a>
                        ) : null}
                        {l.website ? (
                          <a href={l.website} target="_blank" rel="noreferrer" className="accent" title="Sito">
                            ↗
                          </a>
                        ) : null}
                      </div>
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
                    <td className="px-5 py-3 muted">{campName(l.campaignId)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{fmtInt(l.opens)}</td>
                    <td
                      className="px-5 py-3 text-right tabular-nums"
                      style={{ color: l.clicks > 0 ? "var(--accent-strong)" : undefined, fontWeight: l.clicks > 0 ? 600 : 400 }}
                    >
                      {fmtInt(l.clicks)}
                    </td>
                    <td
                      className="px-5 py-3 text-right tabular-nums"
                      style={{ color: l.replies > 0 ? "var(--good)" : undefined, fontWeight: l.replies > 0 ? 600 : 400 }}
                    >
                      {fmtInt(l.replies)}
                    </td>
                    <td className="px-5 py-3 text-right muted">{fmtDate(l.lastOpen)}</td>
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

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card px-5 py-4">
      <div className="text-xs uppercase tracking-wide muted">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
