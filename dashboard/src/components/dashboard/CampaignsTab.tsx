"use client";

import { useState } from "react";
import type { DashboardSnapshot } from "@/lib/types";
import { campaignStatusLabel, fmtInt, fmtMoney, fmtPct } from "@/lib/format";
import { FeedbackButton } from "./FeedbackButton";

type SortKey = "emailsSent" | "openRate" | "replyRate" | "opportunities";

export function CampaignsTab({ snap, slug }: { snap: DashboardSnapshot; slug: string }) {
  const [sort, setSort] = useState<SortKey>("emailsSent");

  const rows = [...snap.campaigns]
    .map((c) => ({
      ...c,
      openRate: c.emailsSent ? c.opensUnique / c.emailsSent : 0,
      replyRate: c.emailsSent ? c.repliesUnique / c.emailsSent : 0,
      bounceRate: c.emailsSent ? c.bounced / c.emailsSent : 0,
    }))
    .sort((a, b) => (b[sort] as number) - (a[sort] as number));

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <div className="font-semibold">Campaign performance</div>
        <div className="flex items-center gap-2 text-xs no-print">
          <span className="muted">Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md card-2 px-2 py-1 outline-none"
          >
            <option value="emailsSent">Emails sent</option>
            <option value="openRate">Open rate</option>
            <option value="replyRate">Reply rate</option>
            <option value="opportunities">Opportunities</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide muted">
              <Th>Campaign</Th>
              <Th right>Sent</Th>
              <Th right>Open</Th>
              <Th right>Reply</Th>
              <Th right>Clicks</Th>
              <Th right>Bounce</Th>
              <Th right>Opps</Th>
              <Th right>Pipeline</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-[var(--border)] hover:bg-[var(--panel-2)]">
                <td className="px-5 py-3">
                  <div className="font-medium">{c.name}</div>
                  <StatusPill status={c.status} />
                </td>
                <Td>{fmtInt(c.emailsSent)}</Td>
                <Td good={c.openRate > 0.5}>{fmtPct(c.openRate)}</Td>
                <Td good={c.replyRate > 0.03}>{fmtPct(c.replyRate)}</Td>
                <Td>{fmtInt(c.clicks)}</Td>
                <Td bad={c.bounceRate > 0.03}>{fmtPct(c.bounceRate)}</Td>
                <Td>{fmtInt(c.opportunities)}</Td>
                <Td>{fmtMoney(c.opportunityValue)}</Td>
                <td className="px-3 py-3 text-right">
                  <FeedbackButton
                    slug={slug}
                    target={`campaign:${c.id}`}
                    targetLabel={c.name}
                    compact
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`px-5 py-3 font-medium ${right ? "text-right" : ""}`}>{children}</th>;
}

function Td({
  children,
  good,
  bad,
}: {
  children: React.ReactNode;
  good?: boolean;
  bad?: boolean;
}) {
  const color = good ? "var(--good)" : bad ? "var(--bad)" : undefined;
  return (
    <td className="px-5 py-3 text-right tabular-nums" style={{ color }}>
      {children}
    </td>
  );
}

function StatusPill({ status }: { status: number }) {
  const map: Record<number, string> = {
    0: "#6e8b8b",
    1: "#1f9d7a",
    2: "#c08a1e",
    3: "#2f7da8",
  };
  const color = map[status] ?? "#6e8b8b";
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 text-xs muted">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {campaignStatusLabel(status)}
    </span>
  );
}
