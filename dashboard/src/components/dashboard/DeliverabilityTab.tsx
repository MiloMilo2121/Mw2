"use client";

import type { DashboardSnapshot } from "@/lib/types";
import { fmtInt, fmtPct } from "@/lib/format";
import { FeedbackButton } from "./FeedbackButton";

function healthColor(score: number): string {
  if (score >= 75) return "var(--good)";
  if (score >= 50) return "var(--warn)";
  return "var(--bad)";
}

export function DeliverabilityTab({
  snap,
  slug,
}: {
  snap: DashboardSnapshot;
  slug: string;
}) {
  const accounts = snap.accounts;
  const total = accounts.length;
  const active = accounts.filter((a) => a.status === 1).length;
  const atRisk = accounts.filter((a) => a.status < 0 || a.healthScore < 50).length;
  const avgWarmup = total
    ? Math.round(accounts.reduce((s, a) => s + a.warmupScore, 0) / total)
    : 0;
  const avgHealth = total
    ? Math.round(accounts.reduce((s, a) => s + a.healthScore, 0) / total)
    : 0;

  const providers = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.provider] = (acc[a.provider] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Sending accounts" value={fmtInt(total)} />
        <Stat label="Active" value={fmtInt(active)} color="var(--good)" />
        <Stat label="At risk" value={fmtInt(atRisk)} color={atRisk ? "var(--bad)" : "var(--muted)"} />
        <Stat label="Avg warmup" value={`${avgWarmup}`} />
        <Stat label="Avg health" value={`${avgHealth}`} color={healthColor(avgHealth)} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <div className="font-semibold">Inbox / account health</div>
            <div className="text-xs muted">
              Sorted by health — weakest first. {Object.entries(providers)
                .map(([p, n]) => `${n} ${p}`)
                .join(" · ")}
            </div>
          </div>
          <FeedbackButton
            slug={slug}
            target="deliverability"
            targetLabel="Deliverability & accounts"
            compact
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide muted">
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium">Provider</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Warmup</th>
                <th className="px-5 py-3 text-right font-medium">Bounce</th>
                <th className="px-5 py-3 text-right font-medium">Today</th>
                <th className="px-5 py-3 font-medium">Health</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.email} className="border-t border-[var(--border)] hover:bg-[var(--panel-2)]">
                  <td className="px-5 py-3 font-medium">{a.email}</td>
                  <td className="px-5 py-3 muted">{a.provider}</td>
                  <td className="px-5 py-3">
                    <span
                      style={{ color: a.status === 1 ? "var(--good)" : a.status === 2 ? "var(--warn)" : "var(--bad)" }}
                    >
                      {a.statusLabel}
                    </span>
                  </td>
                  <td className="px-5 py-3 tabular-nums">{a.warmupScore}</td>
                  <td
                    className="px-5 py-3 text-right tabular-nums"
                    style={{ color: a.bounceRate > 0.03 ? "var(--bad)" : undefined }}
                  >
                    {fmtPct(a.bounceRate)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums muted">
                    {fmtInt(a.sentToday)}/{fmtInt(a.dailyLimit)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-[var(--panel-2)]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${a.healthScore}%`, background: healthColor(a.healthScore) }}
                        />
                      </div>
                      <span className="tabular-nums" style={{ color: healthColor(a.healthScore) }}>
                        {a.healthScore}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
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
      <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
