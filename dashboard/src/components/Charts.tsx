// Lightweight, dependency-free SVG charts. Designed for a dark dashboard.
// All components are pure (no hooks) so they render on server or client.

import type { DailyPoint } from "@/lib/types";

type Series = { key: keyof DailyPoint; label: string; color: string };

function path(points: { x: number; y: number }[]): string {
  if (!points.length) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
}

/** Multi-series line + soft area chart over a daily series. */
export function TrendChart({
  data,
  series,
  height = 240,
}: {
  data: DailyPoint[];
  series: Series[];
  height?: number;
}) {
  const w = 720;
  const h = height;
  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const max =
    Math.max(
      1,
      ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))
    ) * 1.15;

  const x = (i: number) =>
    padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const gridLines = 4;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      role="img"
      preserveAspectRatio="xMidYMid meet"
    >
      {Array.from({ length: gridLines + 1 }).map((_, i) => {
        const gy = padT + (i / gridLines) * innerH;
        const val = Math.round(max - (i / gridLines) * max);
        return (
          <g key={i}>
            <line
              x1={padL}
              x2={w - padR}
              y1={gy}
              y2={gy}
              stroke="#232936"
              strokeWidth={1}
            />
            <text x={8} y={gy + 4} fill="#8a92a6" fontSize={10}>
              {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
            </text>
          </g>
        );
      })}

      {series.map((s) => {
        const pts = data.map((d, i) => ({ x: x(i), y: y(Number(d[s.key]) || 0) }));
        const area =
          `${path(pts)} L${x(data.length - 1)},${padT + innerH} L${x(0)},${
            padT + innerH
          } Z`;
        return (
          <g key={String(s.key)}>
            <path d={area} fill={s.color} opacity={0.12} />
            <path d={path(pts)} fill="none" stroke={s.color} strokeWidth={2.5} />
          </g>
        );
      })}

      {data.map((d, i) =>
        i % Math.ceil(data.length / 6) === 0 || i === data.length - 1 ? (
          <text key={i} x={x(i)} y={h - 8} fill="#8a92a6" fontSize={10} textAnchor="middle">
            {d.date.slice(5)}
          </text>
        ) : null
      )}
    </svg>
  );
}

/** Horizontal bar comparison (e.g. campaigns by emails sent). */
export function BarRows({
  rows,
  color = "var(--accent)",
}: {
  rows: { label: string; value: number; sub?: string }[];
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="truncate pr-3">{r.label}</span>
            <span className="muted shrink-0 tabular-nums">{r.sub}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--panel-2)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${(r.value / max) * 100}%`, background: color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Donut for a single ratio 0-1. */
export function Donut({
  value,
  label,
  color = "var(--accent)",
  size = 120,
}: {
  value: number;
  label: string;
  color?: string;
  size?: number;
}) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#232936"
          strokeWidth={10}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="48%"
          textAnchor="middle"
          fill="var(--text)"
          fontSize={20}
          fontWeight={700}
        >
          {(pct * 100).toFixed(1)}%
        </text>
        <text x="50%" y="64%" textAnchor="middle" fill="#8a92a6" fontSize={10}>
          {label}
        </text>
      </svg>
    </div>
  );
}

/** Tiny inline sparkline. */
export function Sparkline({
  values,
  color = "var(--accent)",
  width = 120,
  height = 32,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(1, ...values);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => ({
    x: values.length <= 1 ? width / 2 : (i / (values.length - 1)) * width,
    y: height - ((v - min) / (max - min || 1)) * height,
  }));
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={path(pts)} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}
