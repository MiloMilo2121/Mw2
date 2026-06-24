"use client";

import { useState } from "react";
import { useSnapshot } from "./hooks";
import { OverviewTab } from "./OverviewTab";
import { CampaignsTab } from "./CampaignsTab";
import { StepsTab } from "./StepsTab";
import { DeliverabilityTab } from "./DeliverabilityTab";
import { ContactsTab } from "./ContactsTab";
import { FeedbackTab } from "./FeedbackTab";
import { ReportTab } from "./ReportTab";
import { fmtDateTime } from "@/lib/format";

type Tab =
  | "overview"
  | "campaigns"
  | "steps"
  | "contacts"
  | "deliverability"
  | "feedback"
  | "report";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "campaigns", label: "Campaigns" },
  { id: "steps", label: "Sequenza" },
  { id: "contacts", label: "Contatti" },
  { id: "deliverability", label: "Deliverability" },
  { id: "feedback", label: "Feedback" },
  { id: "report", label: "Report" },
];

const RANGES = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function Shell({ slug }: { slug: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState(30);
  const { snapshot, error, isLoading, refresh } = useSnapshot(slug, days);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="pulse-dot" />
            <span className="text-xs uppercase tracking-widest muted">
              Live · {snapshot?.source === "instantly" ? "Instantly" : "Demo data"}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-bold">
            {snapshot?.client.name ?? "Loading…"}
          </h1>
          <div className="text-xs muted">
            {snapshot
              ? `Updated ${fmtDateTime(snapshot.generatedAt)}`
              : "Fetching latest…"}
          </div>
        </div>

        <div className="flex items-center gap-2 no-print">
          <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={`px-3 py-1.5 text-sm ${
                  days === r.days ? "accent-bg" : "muted hover:text-[var(--text)]"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => refresh()}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm muted hover:text-[var(--text)]"
            title="Refresh now"
          >
            ↻
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--border)] no-print">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition ${
              tab === tb.id
                ? "tab-active font-medium"
                : "border-transparent muted hover:text-[var(--text)]"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </nav>

      {/* Body */}
      {error ? (
        <div className="card p-8 text-center">
          <div className="text-[var(--bad)]">Could not load dashboard data.</div>
          <button
            onClick={() => refresh()}
            className="mt-3 rounded-lg accent-bg px-4 py-2 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      ) : !snapshot ? (
        <SkeletonBody />
      ) : (
        <div className={isLoading ? "opacity-70 transition" : "transition"}>
          {tab === "overview" && <OverviewTab snap={snapshot} slug={slug} />}
          {tab === "campaigns" && <CampaignsTab snap={snapshot} slug={slug} />}
          {tab === "steps" && <StepsTab snap={snapshot} slug={slug} />}
          {tab === "contacts" && <ContactsTab snap={snapshot} slug={slug} />}
          {tab === "deliverability" && <DeliverabilityTab snap={snapshot} slug={slug} />}
          {tab === "feedback" && <FeedbackTab slug={slug} />}
          {tab === "report" && <ReportTab snap={snapshot} slug={slug} />}
        </div>
      )}

      <footer className="mt-10 text-center text-xs muted no-print">
        Powered by Instantly.ai · Live dashboard
      </footer>
    </div>
  );
}

function SkeletonBody() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card h-24 animate-pulse" />
      ))}
    </div>
  );
}
