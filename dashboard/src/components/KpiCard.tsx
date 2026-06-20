import { delta, fmtPct } from "@/lib/format";

export function KpiCard({
  label,
  value,
  current,
  previous,
  invertDelta = false,
  hint,
}: {
  label: string;
  value: string;
  current?: number;
  previous?: number;
  /** When true (e.g. bounce rate), a decrease is "good". */
  invertDelta?: boolean;
  hint?: string;
}) {
  const hasDelta = current !== undefined && previous !== undefined;
  const d = hasDelta ? delta(current!, previous!) : 0;
  const positive = invertDelta ? d < 0 : d > 0;
  const neutral = Math.abs(d) < 0.001;
  const color = neutral ? "var(--muted)" : positive ? "var(--good)" : "var(--bad)";
  const arrow = neutral ? "→" : d > 0 ? "▲" : "▼";

  return (
    <div className="card px-5 py-4">
      <div className="text-xs uppercase tracking-wide muted">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {hasDelta ? (
          <span style={{ color }} className="tabular-nums">
            {arrow} {fmtPct(Math.abs(d), 1)}
          </span>
        ) : null}
        <span className="muted">{hint ?? "vs previous period"}</span>
      </div>
    </div>
  );
}
