"use client";

import useSWR from "swr";
import { useCallback } from "react";
import { fetcher } from "@/lib/fetcher";
import { toast } from "sonner";

export interface VerificationRecord {
  type: "TXT";
  name: string;
  value: string;
}

export interface EmbedOrigin {
  id: string;
  origin: string;
  domain: string;
  verified: boolean;
  verifiedAt: string | null;
  createdAt: string;
  /** The DNS TXT to publish; present while unverified. */
  record: VerificationRecord | null;
}

/**
 * Manage the org's embed origins (Settings → Embedding). Reads the list and
 * exposes add / verify / remove, each surfacing errors via toast and
 * revalidating the list on success.
 */
export function useEmbedOrigins() {
  const { data, error, isLoading, mutate } = useSWR<{ origins: EmbedOrigin[] }>(
    "/api/embed/origins",
    fetcher,
    { revalidateOnFocus: false },
  );

  const add = useCallback(
    async (origin: string): Promise<boolean> => {
      const res = await fetch("/api/embed/origins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't add that domain.");
        return false;
      }
      await mutate();
      return true;
    },
    [mutate],
  );

  const verify = useCallback(
    async (id: string): Promise<boolean> => {
      const res = await fetch(`/api/embed/origins/${id}/verify`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.verified) {
        toast.success("Domain verified.");
        await mutate();
        return true;
      }
      toast.error(json.error ?? "Not verified yet — check the DNS record.");
      return false;
    },
    [mutate],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const res = await fetch(`/api/embed/origins/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't remove that domain.");
        return false;
      }
      await mutate();
      return true;
    },
    [mutate],
  );

  return {
    origins: data?.origins ?? [],
    isLoading,
    error,
    hasVerified: (data?.origins ?? []).some((o) => o.verified),
    add,
    verify,
    remove,
    refresh: mutate,
  };
}
