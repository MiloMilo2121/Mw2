"use client";

import { useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import { useSteps } from "./hooks";
import { FeedbackButton } from "./FeedbackButton";
import { fmtInt, fmtPct, rate } from "@/lib/format";

// Per-step funnel + A/B variant performance for one campaign sequence.
export function StepsTab({ snap, slug }: { snap: DashboardSnapshot; slug: string }) {
  const [campaign, setCampaign] = useState(snap.campaigns[0]?.id ?? "");
  const { steps, isLoading } = useSteps(slug, campaign);

  // Group by step number; variants become A / B / ...
  const byStep = new Map<number, typeof steps>();
  for (const s of steps) {
    const arr = byStep.get(s.step) ?? [];
    arr.push(s);
    byStep.set(s.step, arr);
  }
  const stepNums = [...byStep.keys()].sort((a, b) => a - b);
  const maxSent = Math.max(1, ...steps.map((s) => s.sent));
  const variantLabel = (v: string) => `Variante ${String.fromCharCode(65 + (parseInt(v) || 0))}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-3 no-print">
        <div className="flex items-center gap-2">
          <span className="text-sm muted">Campagna</span>
          <select
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            className="rounded-lg card-2 px-3 py-1.5 text-sm outline-none"
          >
            {snap.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <FeedbackButton slug={slug} target={`steps:${campaign}`} targetLabel="Sequenza" compact />
      </div>

      {isLoading && steps.length === 0 ? (
        <div className="card p-8 text-center text-sm muted">Carico la sequenza…</div>
      ) : steps.length === 0 ? (
        <div className="card p-8 text-center text-sm muted">
          Nessun dato sugli step per questa campagna.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {stepNums.map((n) => {
            const variants = byStep.get(n)!;
            return (
              <div key={n} className="card p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
                    style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
                  >
                    {n + 1}
                  </span>
                  <span className="font-semibold">Email {n + 1} della sequenza</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {variants.map((s) => (
                    <div key={s.variant} className="card-2 p-4">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium">{variantLabel(s.variant)}</span>
                        <span className="muted">{fmtInt(s.sent)} inviate</span>
                      </div>
                      <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--panel)]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(s.sent / maxSent) * 100}%`, background: "var(--accent-strong)" }}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-sm">
                        <Metric label="Aperture" value={fmtPct(rate(s.uniqueOpened, s.sent))} sub={`${fmtInt(s.uniqueOpened)} uniche`} />
                        <Metric label="Click" value={fmtPct(rate(s.clicks, s.sent))} sub={`${fmtInt(s.clicks)}`} />
                        <Metric label="Risposta" value={fmtPct(rate(s.replies, s.sent))} sub={`${fmtInt(s.replies)}`} good={s.replies > 0} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  good,
}: {
  label: string;
  value: string;
  sub: string;
  good?: boolean;
}) {
  return (
    <div>
      <div className="text-xs muted">{label}</div>
      <div className="text-lg font-bold" style={{ color: good ? "var(--good)" : "var(--ink)" }}>
        {value}
      </div>
      <div className="text-[11px] muted">{sub}</div>
    </div>
  );
}
