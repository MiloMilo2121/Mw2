// Feedback store. Persists to Supabase when available, otherwise keeps items in
// a module-level array (fine for demo / single instance; lost on restart).

import { getSupabase } from "./supabase";
import type { FeedbackItem } from "./types";

const memory: FeedbackItem[] = [];

function rowToItem(r: Record<string, unknown>): FeedbackItem {
  return {
    id: String(r.id),
    clientSlug: String(r.client_slug),
    target: String(r.target),
    targetLabel: String(r.target_label ?? r.target),
    author: String(r.author ?? "Client"),
    kind: (r.kind as FeedbackItem["kind"]) ?? "comment",
    body: String(r.body ?? ""),
    createdAt: String(r.created_at ?? new Date().toISOString()),
    resolved: Boolean(r.resolved),
  };
}

export async function listFeedback(clientSlug: string): Promise<FeedbackItem[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("feedback")
      .select("*")
      .eq("client_slug", clientSlug)
      .order("created_at", { ascending: false });
    if (!error && data) return data.map(rowToItem);
  }
  return memory
    .filter((f) => f.clientSlug === clientSlug)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addFeedback(
  input: Omit<FeedbackItem, "id" | "createdAt" | "resolved">
): Promise<FeedbackItem> {
  const item: FeedbackItem = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    resolved: false,
  };
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("feedback")
      .insert({
        client_slug: item.clientSlug,
        target: item.target,
        target_label: item.targetLabel,
        author: item.author,
        kind: item.kind,
        body: item.body,
      })
      .select("*")
      .single();
    if (!error && data) return rowToItem(data);
  }
  memory.unshift(item);
  return item;
}

export async function resolveFeedback(
  clientSlug: string,
  id: string,
  resolved: boolean
): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    await sb
      .from("feedback")
      .update({ resolved })
      .eq("id", id)
      .eq("client_slug", clientSlug);
    return;
  }
  const item = memory.find((f) => f.id === id && f.clientSlug === clientSlug);
  if (item) item.resolved = resolved;
}
