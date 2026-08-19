"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { fetcher } from "@/lib/fetcher";
import { toast } from "sonner";

export interface EmbedPublish {
  id: string;
  token: string;
  label: string | null;
  timeRange: string | null;
  createdAt: string;
  revoked: boolean;
}

/**
 * Manage the durable published embed for one panel. A panel has at most one
 * active publish here (we surface the most recent); create mints a durable
 * token, revoke kills it.
 */
export function useEmbedPublish(dashboardId: string, panelId: string) {
  const key =
    dashboardId && panelId
      ? `/api/embed/publishes?dashboardId=${encodeURIComponent(dashboardId)}&panelId=${encodeURIComponent(panelId)}`
      : null;
  const { data, isLoading, mutate } = useSWR<{ publishes: EmbedPublish[] }>(
    key,
    fetcher,
    { revalidateOnFocus: false },
  );
  const publish = data?.publishes?.[0] ?? null;

  const create = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/embed/publishes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dashboardId, panelId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't publish the embed.");
      return false;
    }
    await mutate();
    toast.success("Embed published.");
    return true;
  }, [dashboardId, panelId, mutate]);

  const revoke = useCallback(
    async (id: string): Promise<boolean> => {
      const res = await fetch(`/api/embed/publishes/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't revoke the embed.");
        return false;
      }
      await mutate();
      toast.success("Embed revoked.");
      return true;
    },
    [mutate],
  );

  return { publish, isLoading, create, revoke };
}
