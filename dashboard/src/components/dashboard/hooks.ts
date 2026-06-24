"use client";

import useSWR from "swr";
import type { DashboardSnapshot, FeedbackItem } from "@/lib/types";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Request failed: ${r.status}`);
    return r.json();
  });

export function useSnapshot(slug: string, days: number) {
  const { data, error, isLoading, mutate } = useSWR<DashboardSnapshot>(
    `/api/c/${slug}/snapshot?days=${days}`,
    fetcher,
    {
      // The "live" part: refresh every 30s, and whenever the tab refocuses.
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );
  return { snapshot: data, error, isLoading, refresh: mutate };
}

export function useFeedback(slug: string) {
  const { data, mutate, isLoading } = useSWR<{ items: FeedbackItem[] }>(
    `/api/c/${slug}/feedback`,
    fetcher,
    { refreshInterval: 60_000 }
  );
  return { items: data?.items ?? [], refresh: mutate, isLoading };
}

import type { Lead } from "@/lib/types";

export type LeadsResponse = {
  source: "instantly" | "mock";
  total: number;
  shown: number;
  engaged: { opened: number; clicked: number; replied: number };
  leads: Lead[];
};

export function useLeads(
  slug: string,
  opts: { filter: string; campaign: string; q: string }
) {
  const params = new URLSearchParams({
    filter: opts.filter,
    campaign: opts.campaign,
    q: opts.q,
  });
  const { data, isLoading, error } = useSWR<LeadsResponse>(
    `/api/c/${slug}/leads?${params.toString()}`,
    fetcher,
    { refreshInterval: 60_000, keepPreviousData: true }
  );
  return { data, isLoading, error };
}

import type { CampaignStep } from "@/lib/types";

export function useSteps(slug: string, campaign: string) {
  const { data, isLoading } = useSWR<{ steps: CampaignStep[]; source: string }>(
    campaign ? `/api/c/${slug}/steps?campaign=${campaign}` : null,
    fetcher,
    { refreshInterval: 60_000, keepPreviousData: true }
  );
  return { steps: data?.steps ?? [], isLoading };
}

export async function postFeedback(
  slug: string,
  payload: {
    target: string;
    targetLabel: string;
    author: string;
    kind: "comment" | "flag" | "question";
    body: string;
  }
) {
  const res = await fetch(`/api/c/${slug}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to send feedback");
  return res.json();
}

export async function patchFeedback(slug: string, id: string, resolved: boolean) {
  await fetch(`/api/c/${slug}/feedback`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, resolved }),
  });
}
