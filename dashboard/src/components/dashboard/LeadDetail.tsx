"use client";

import { useEffect } from "react";
import { useLeadDetail } from "./hooks";
import { FeedbackButton } from "./FeedbackButton";
import { fmtDateTime } from "@/lib/format";

// Slide-over "call sheet" for one contact: their email journey (which approach they
// received / opened / clicked) and their reply — so the caller starts informed.
export function LeadDetail({
  slug,
  email,
  onClose,
}: {
  slug: string;
  email: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useLeadDetail(slug, email);

  // Close on Escape.
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const p = data?.profile;
  const summary = data ? buildSummary(data) : "";

  return (
    <div className="fixed inset-0 z-50 flex justify-end no-print">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      {/* Panel */}
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-[var(--panel)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-5">
          <div className="min-w-0">
            <div className="text-lg font-bold" style={{ color: "var(--ink)" }}>
              {p ? `${p.firstName} ${p.lastName}`.trim() || p.email : "Caricamento…"}
            </div>
            {p?.company ? <div className="text-sm muted">{p.company}</div> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg card-2 px-2.5 py-1 text-sm muted hover:text-[var(--text)]"
            aria-label="Chiudi"
          >
            ✕
          </button>
        </div>

        {isLoading && !data ? (
          <div className="p-8 text-center text-sm muted">Carico la scheda…</div>
        ) : !p ? (
          <div className="p-8 text-center text-sm muted">Contatto non trovato.</div>
        ) : (
          <div className="flex flex-col gap-5 p-5">
            {/* Contact facts */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {p.interestLabel ? (
                <span
                  className="rounded-md px-2 py-0.5 text-xs font-medium"
                  style={{
                    background: p.interestStatus > 0 ? "rgba(31,157,122,.14)" : "var(--panel-2)",
                    color: p.interestStatus > 0 ? "var(--good)" : "var(--muted)",
                  }}
                >
                  {p.interestLabel}
                </span>
              ) : null}
              {p.role ? <span className="muted">{p.role}</span> : null}
              {p.city ? <span className="muted">· {p.city}</span> : null}
            </div>

            <div className="grid grid-cols-1 gap-2 text-sm">
              {p.phone ? (
                <a
                  href={`tel:${p.phone.replace(/\s/g, "")}`}
                  className="flex items-center gap-2 rounded-lg card p-3 font-medium accent"
                >
                  📞 {p.phone}
                </a>
              ) : (
                <div className="rounded-lg card p-3 text-sm muted">Nessun telefono in archivio</div>
              )}
              <div className="flex flex-wrap gap-3 px-1 text-xs muted">
                <span>{p.email}</span>
                {p.website ? (
                  <a href={siteHref(p.website)} target="_blank" rel="noreferrer" className="accent">
                    {siteLabel(p.website)} ↗
                  </a>
                ) : null}
              </div>
            </div>

            {/* One-line brief */}
            {summary ? (
              <div className="rounded-lg border border-[var(--accent-strong)]/30 bg-[var(--panel-2)] p-3 text-sm">
                <span className="font-medium">Prima di chiamare:</span> {summary}
              </div>
            ) : null}

            {/* Email journey */}
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide muted">Percorso email</div>
              <div className="flex flex-col gap-2">
                {data!.sequence.length === 0 ? (
                  <div className="text-sm muted">Sequenza non disponibile.</div>
                ) : (
                  data!.sequence.map((s) => {
                    const isOpened = data!.opened?.index === s.index;
                    const isClicked = data!.clicked?.index === s.index;
                    return (
                      <div
                        key={s.index}
                        className="rounded-lg card p-3"
                        style={{ opacity: s.sent ? 1 : 0.5 }}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
                          >
                            {s.index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm" style={{ color: "var(--ink)" }}>
                              {s.subject || <span className="muted">(senza oggetto)</span>}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <Badge label={s.sent ? "Inviata" : "Non inviata"} tone="muted" />
                              {isOpened ? <Badge label="👁 Aperta" tone="good" /> : null}
                              {isClicked ? <Badge label="🔗 Cliccato (caso studio)" tone="accent" /> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Reply */}
            {data!.reply ? (
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide muted">Ha risposto</div>
                <div className="rounded-lg border-l-2 border-[var(--good)] bg-[var(--panel-2)] p-3">
                  <div className="whitespace-pre-wrap text-sm" style={{ color: "var(--ink)" }}>
                    {data!.reply.text}
                  </div>
                  <div className="mt-1 text-xs muted">{fmtDateTime(data!.reply.ts)}</div>
                </div>
              </div>
            ) : null}

            <div className="flex justify-end">
              <FeedbackButton slug={slug} target={`lead:${email}`} targetLabel={`Contatto ${p.firstName}`} compact />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: "good" | "accent" | "muted" }) {
  const map = {
    good: { bg: "rgba(31,157,122,.14)", color: "var(--good)" },
    accent: { bg: "rgba(36,79,79,.12)", color: "var(--accent-strong)" },
    muted: { bg: "var(--panel-2)", color: "var(--muted)" },
  }[tone];
  return (
    <span className="rounded-md px-2 py-0.5 text-[11px] font-medium" style={{ background: map.bg, color: map.color }}>
      {label}
    </span>
  );
}

function buildSummary(d: NonNullable<ReturnType<typeof useLeadDetail>["data"]>): string {
  const parts: string[] = [];
  if (d.opened) parts.push(`ha aperto l'email ${d.opened.index + 1}`);
  if (d.clicked) parts.push(`ha cliccato il caso studio nell'email ${d.clicked.index + 1}`);
  if (d.reply) parts.push("ha risposto");
  if (!parts.length) {
    const sent = d.sequence.filter((s) => s.sent).length;
    return sent ? `ha ricevuto ${sent} email, nessuna interazione registrata.` : "nessuna attività registrata.";
  }
  return parts.join(" · ") + ".";
}

function siteHref(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}
function siteLabel(u: string): string {
  try {
    return new URL(siteHref(u)).hostname.replace(/^www\./, "");
  } catch {
    return u.replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/$/, "");
  }
}
