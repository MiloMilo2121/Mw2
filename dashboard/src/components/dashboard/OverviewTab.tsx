"use client";

import type { DashboardSnapshot } from "@/lib/types";
import { KpiCard } from "@/components/KpiCard";
import { BarRows, Donut, TrendChart } from "@/components/Charts";
import { fmtInt, fmtMoney, fmtPct, rate } from "@/lib/format";
import { FeedbackButton } from "./FeedbackButton";

export function OverviewTab({ snap, slug }: { snap: DashboardSnapshot; slug: string }) {
  const t = snap.totals;
  const p = snap.previousTotals;

  const topCampaigns = [...snap.campaigns]
    .sort((a, b) => b.replies - a.replies)
    .slice(0, 6)
    .map((c) => ({
      label: c.name,
      value: c.replies,
      sub: `${fmtInt(c.replies)} replies · ${fmtPct(rate(c.opensUnique, c.emailsSent))} open`,
    }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Emails sent" value={fmtInt(t.emailsSent)} current={t.emailsSent} previous={p.emailsSent} />
        <KpiCard label="Open rate" value={fmtPct(t.openRate)} current={t.openRate} previous={p.openRate} />
        <KpiCard label="Reply rate" value={fmtPct(t.replyRate)} current={t.replyRate} previous={p.replyRate} />
        <KpiCard label="Replies" value={fmtInt(t.replies)} current={t.replies} previous={p.replies} />
        <KpiCard label="Opportunities" value={fmtInt(t.opportunities)} current={t.opportunities} previous={p.opportunities} hint="vs prev · pipeline" />
        <KpiCard label="Bounce rate" value={fmtPct(t.bounceRate)} current={t.bounceRate} previous={p.bounceRate} invertDelta hint="lower is better" />
      </div>

      {/* Secondary metrics strip */}
      <div className="card grid grid-cols-2 gap-y-3 px-5 py-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Mini label="Lead totali" value={fmtInt(t.leads)} />
        <Mini label="Contattati" value={fmtInt(t.contacted)} />
        <Mini label="Aperture uniche" value={fmtInt(t.opensUnique)} sub={fmtPct(rate(t.opensUnique, t.emailsSent))} />
        <Mini label="Click unici" value={fmtInt(t.clicksUnique)} />
        <Mini label="Completati" value={fmtInt(t.completed)} />
        <Mini label="Disiscritti" value={fmtInt(t.unsubscribed)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="font-semibold">Sending & engagement</div>
              <div className="text-xs muted">
                Daily volume over the selected period
              </div>
            </div>
            <FeedbackButton
              slug={slug}
              target="overview:trend"
              targetLabel="Sending & engagement trend"
              compact
            />
          </div>
          <TrendChart
            data={snap.daily}
            series={[
              { key: "sent", label: "Sent", color: "#244f4f" },
              { key: "opens", label: "Opens", color: "#1f9d7a" },
              { key: "replies", label: "Replies", color: "#c08a1e" },
            ]}
          />
          <div className="mt-3 flex gap-4 text-xs muted">
            <Legend color="#244f4f" label="Sent" />
            <Legend color="#1f9d7a" label="Opens" />
            <Legend color="#c08a1e" label="Replies" />
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-2 font-semibold">Pipeline generated</div>
          <div className="text-3xl font-bold accent">{fmtMoney(t.opportunityValue)}</div>
          <div className="text-xs muted">
            from {fmtInt(t.opportunities)} opportunities
          </div>
          <div className="mt-5 flex justify-around">
            <Donut value={t.openRate} label="Open rate" color="#1f9d7a" />
            <Donut value={t.replyRate} label="Reply rate" color="#244f4f" />
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-4 font-semibold">Top campaigns by replies</div>
        {topCampaigns.length ? (
          <BarRows rows={topCampaigns} />
        ) : (
          <div className="text-sm muted">No campaign data yet.</div>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs muted">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums" style={{ color: "var(--ink)" }}>
        {value}
        {sub ? <span className="ml-1 text-xs font-normal muted">{sub}</span> : null}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
