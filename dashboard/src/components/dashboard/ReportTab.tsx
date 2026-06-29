"use client";

import type { DashboardSnapshot } from "@/lib/types";
import { fmtDateShort, fmtInt, fmtMoney, fmtPct } from "@/lib/format";

export function ReportTab({ snap, slug }: { snap: DashboardSnapshot; slug: string }) {
  const t = snap.totals;
  const top = [...snap.campaigns].sort((a, b) => b.replies - a.replies).slice(0, 5);
  const atRisk = snap.accounts.filter((a) => a.status < 0 || a.healthScore < 50);

  return (
    <div className="card p-6 md:p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest muted">
            Report performance
          </div>
          <h2 className="mt-1 text-2xl font-bold">{snap.client.name}</h2>
          <div className="text-sm muted">
            {fmtDateShort(snap.range.start)} – {fmtDateShort(snap.range.end)}
          </div>
        </div>
        <div className="flex gap-2 no-print">
          <a
            href={`/api/c/${slug}/export?days=${daysFromRange(snap)}`}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm muted hover:text-[var(--text)]"
          >
            ⬇ CSV
          </a>
          <button
            onClick={() => window.print()}
            className="rounded-lg accent-bg px-3 py-1.5 text-sm font-medium"
          >
            🖨 Salva come PDF
          </button>
        </div>
      </div>

      <p className="mb-6 max-w-2xl text-[15px] leading-relaxed">
        In questo periodo abbiamo inviato <b>{fmtInt(t.emailsSent)}</b> email, con un
        tasso di apertura del <b>{fmtPct(t.openRate)}</b> e un tasso di risposta del{" "}
        <b>{fmtPct(t.replyRate)}</b>. Sono arrivate <b>{fmtInt(t.replies)}</b> risposte e{" "}
        <b>{fmtInt(t.opportunities)}</b> opportunità per un valore stimato di{" "}
        <b>{fmtMoney(t.opportunityValue)}</b> di pipeline. Il tasso di bounce è rimasto al{" "}
        <b>{fmtPct(t.bounceRate)}</b>.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <H>Metriche principali</H>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <Row k="Email inviate" v={fmtInt(t.emailsSent)} />
            <Row k="Lead contattati" v={fmtInt(t.contacted)} />
            <Row k="Tasso apertura" v={fmtPct(t.openRate)} />
            <Row k="Tasso risposta" v={fmtPct(t.replyRate)} />
            <Row k="Tasso click" v={fmtPct(t.clickRate)} />
            <Row k="Tasso bounce" v={fmtPct(t.bounceRate)} />
            <Row k="Opportunità" v={fmtInt(t.opportunities)} />
            <Row k="Valore pipeline" v={fmtMoney(t.opportunityValue)} />
          </dl>
        </div>

        <div>
          <H>Top campagne</H>
          <ol className="flex flex-col gap-2 text-sm">
            {top.map((c, i) => (
              <li key={c.id} className="flex items-center justify-between">
                <span className="truncate pr-3">
                  {i + 1}. {c.name}
                </span>
                <span className="shrink-0 muted tabular-nums">
                  {fmtInt(c.replies)} risposte · {fmtPct(c.emailsSent ? c.opens / c.emailsSent : 0)}
                </span>
              </li>
            ))}
          </ol>

          <H className="mt-6">Deliverability</H>
          <p className="text-sm">
            {snap.accounts.length} account di invio ·{" "}
            <span style={{ color: atRisk.length ? "var(--bad)" : "var(--good)" }}>
              {atRisk.length} a rischio
            </span>
            .
          </p>
          {atRisk.length > 0 && (
            <ul className="mt-1 text-sm muted">
              {atRisk.slice(0, 5).map((a) => (
                <li key={a.email}>
                  • {a.email} — {a.statusLabel} (salute {a.healthScore})
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-8 border-t border-[var(--border)] pt-4 text-xs muted">
        Generato {new Date(snap.generatedAt).toLocaleString("it-IT")} · Fonte:{" "}
        {snap.source === "instantly" ? "Instantly (live)" : "Dati demo"}
      </div>
    </div>
  );
}

function daysFromRange(snap: DashboardSnapshot): number {
  const a = new Date(snap.range.start).getTime();
  const b = new Date(snap.range.end).getTime();
  return Math.max(7, Math.round((b - a) / 86400000) + 1);
}

function H({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-2 text-xs uppercase tracking-wide muted ${className}`}>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="muted">{k}</dt>
      <dd className="text-right font-medium tabular-nums">{v}</dd>
    </>
  );
}
