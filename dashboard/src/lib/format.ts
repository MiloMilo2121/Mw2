// Small formatting helpers shared across the UI.

export function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n || 0));
}

/** A ratio num/den, clamped to [0,1] (open rates can exceed sends via MPP). */
export function rate(num: number, den: number): number {
  if (!den) return 0;
  return Math.max(0, Math.min(1, num / den));
}

export function fmtPct(rate: number, digits = 1): string {
  if (!isFinite(rate)) return "0%";
  return `${(rate * 100).toFixed(digits)}%`;
}

export function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Relative change between current and previous value, as a signed ratio. */
export function delta(current: number, previous: number): number {
  if (!previous) return current ? 1 : 0;
  return (current - previous) / previous;
}

export function campaignStatusLabel(status: number): string {
  switch (status) {
    case 0:
      return "Draft";
    case 1:
      return "Active";
    case 2:
      return "Paused";
    case 3:
      return "Completed";
    default:
      return "Unknown";
  }
}
