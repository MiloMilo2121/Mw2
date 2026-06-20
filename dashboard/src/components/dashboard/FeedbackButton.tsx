"use client";

import { useState } from "react";
import { postFeedback } from "./hooks";

// A compact "leave a comment" affordance that can be attached to any view or
// entity (a campaign row, the overview, an account…). Clients use this to give
// feedback without leaving the dashboard.
export function FeedbackButton({
  slug,
  target,
  targetLabel,
  onSent,
  compact,
}: {
  slug: string;
  target: string;
  targetLabel: string;
  onSent?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState("");
  const [kind, setKind] = useState<"comment" | "flag" | "question">("comment");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!body.trim()) return;
    setSending(true);
    try {
      await postFeedback(slug, {
        target,
        targetLabel,
        author: author.trim() || "Client",
        kind,
        body: body.trim(),
      });
      setDone(true);
      setBody("");
      onSent?.();
      setTimeout(() => {
        setOpen(false);
        setDone(false);
      }, 900);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="relative inline-block no-print">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] ${
          compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
        }`}
        title={`Comment on ${targetLabel}`}
      >
        💬 {compact ? "" : "Comment"}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 card p-3 shadow-xl">
          <div className="mb-2 text-xs muted">
            Feedback on <span className="text-[var(--text)]">{targetLabel}</span>
          </div>
          <div className="mb-2 flex gap-1">
            {(["comment", "question", "flag"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-md px-2 py-1 text-xs capitalize ${
                  kind === k
                    ? "accent-bg text-white"
                    : "card-2 muted hover:text-[var(--text)]"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your note…"
            rows={3}
            className="w-full resize-none rounded-lg card-2 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your name (optional)"
            className="mt-2 w-full rounded-lg card-2 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-1.5 text-sm muted hover:text-[var(--text)]"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={sending || !body.trim()}
              className="rounded-lg accent-bg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {done ? "Sent ✓" : sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
