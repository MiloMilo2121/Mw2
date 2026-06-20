"use client";

import { useFeedback, patchFeedback } from "./hooks";
import { FeedbackButton } from "./FeedbackButton";
import { fmtDateTime } from "@/lib/format";

const KIND_ICON: Record<string, string> = {
  comment: "💬",
  question: "❓",
  flag: "🚩",
};

export function FeedbackTab({ slug }: { slug: string }) {
  const { items, refresh, isLoading } = useFeedback(slug);
  const open = items.filter((i) => !i.resolved);
  const resolved = items.filter((i) => i.resolved);

  async function toggle(id: string, resolved: boolean) {
    await patchFeedback(slug, id, resolved);
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="card flex items-center justify-between p-5">
        <div>
          <div className="font-semibold">Feedback & collaboration</div>
          <div className="text-xs muted">
            Leave notes, questions or flag anything. The agency sees these in real
            time.
          </div>
        </div>
        <FeedbackButton
          slug={slug}
          target="overview"
          targetLabel="General"
          onSent={refresh}
        />
      </div>

      {isLoading && !items.length ? (
        <div className="text-sm muted">Loading…</div>
      ) : null}

      {open.length > 0 && (
        <Section title={`Open (${open.length})`}>
          {open.map((i) => (
            <FeedbackCard
              key={i.id}
              icon={KIND_ICON[i.kind]}
              title={i.targetLabel}
              author={i.author}
              body={i.body}
              when={fmtDateTime(i.createdAt)}
              action={
                <button
                  onClick={() => toggle(i.id, true)}
                  className="rounded-md card-2 px-2 py-1 text-xs muted hover:text-[var(--good)]"
                >
                  Mark resolved
                </button>
              }
            />
          ))}
        </Section>
      )}

      {resolved.length > 0 && (
        <Section title={`Resolved (${resolved.length})`}>
          {resolved.map((i) => (
            <FeedbackCard
              key={i.id}
              icon="✅"
              title={i.targetLabel}
              author={i.author}
              body={i.body}
              when={fmtDateTime(i.createdAt)}
              dimmed
              action={
                <button
                  onClick={() => toggle(i.id, false)}
                  className="rounded-md card-2 px-2 py-1 text-xs muted hover:text-[var(--text)]"
                >
                  Reopen
                </button>
              }
            />
          ))}
        </Section>
      )}

      {!items.length && !isLoading && (
        <div className="card p-8 text-center text-sm muted">
          No feedback yet. Use the 💬 buttons across the dashboard to start a note.
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wide muted">{title}</div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function FeedbackCard({
  icon,
  title,
  author,
  body,
  when,
  action,
  dimmed,
}: {
  icon: string;
  title: string;
  author: string;
  body: string;
  when: string;
  action: React.ReactNode;
  dimmed?: boolean;
}) {
  return (
    <div className={`card p-4 ${dimmed ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="text-lg">{icon}</span>
          <div>
            <div className="text-sm">
              <span className="font-medium">{author}</span>{" "}
              <span className="muted">on {title}</span>
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm">{body}</div>
            <div className="mt-1 text-xs muted">{when}</div>
          </div>
        </div>
        <div className="no-print shrink-0">{action}</div>
      </div>
    </div>
  );
}
