"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { DeviceEvent } from "@/lib/db/types";

export type { DeviceEvent };

export interface UseEventLogOptions {
  timeRange?: string;
  /** Scope to a single device (slug or id). Omit for org-wide. */
  sourceId?: string;
  name?: string;
  limit?: number;
}

export interface UseEventLogResult {
  events: DeviceEvent[];
  total: number;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useEventLog(options: UseEventLogOptions = {}): UseEventLogResult {
  const { timeRange = "1h", sourceId, name, limit = 500 } = options;

  const params = new URLSearchParams();
  params.set("timeRange", timeRange);
  if (sourceId) params.set("sourceId", sourceId);
  if (name) params.set("name", name);
  params.set("limit", String(limit));

  const url = `/api/events/query?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR<{
    events: DeviceEvent[];
    total: number;
  }>(url, fetcher, {
    refreshInterval: 5000,
    refreshWhenHidden: false,
  });

  return {
    events: data?.events ?? [],
    total: data?.total ?? 0,
    isLoading,
    error: error ?? null,
    refresh: () => mutate(),
  };
}
