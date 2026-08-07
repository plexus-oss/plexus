"use client";

import useSWR from "swr";
import type { SystemEvent } from "@/lib/db/types";
import { fetcher } from "@/lib/fetcher";


export interface SystemEventFilters {
  category?: string;
  type?: string;
  severity?: string;
  sourceId?: string;
  search?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}

export type ActorMap = Record<string, { name: string; imageUrl: string }>;

export interface UseSystemEventsResult {
  events: SystemEvent[];
  total: number;
  actors: ActorMap;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useSystemEvents(
  filters?: SystemEventFilters
): UseSystemEventsResult {
  const params = new URLSearchParams();
  if (filters?.category) params.set("category", filters.category);
  if (filters?.type) params.set("type", filters.type);
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.sourceId) params.set("sourceId", filters.sourceId);
  if (filters?.search) params.set("search", filters.search);
  if (filters?.startTime) params.set("startTime", filters.startTime);
  if (filters?.endTime) params.set("endTime", filters.endTime);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));

  const queryString = params.toString();
  const url = `/api/events${queryString ? `?${queryString}` : ""}`;

  const { data, error, isLoading, mutate } = useSWR<{
    events: SystemEvent[];
    total: number;
    actors: ActorMap;
  }>(url, fetcher, {
    refreshInterval: 15000,
  });

  return {
    events: data?.events || [],
    total: data?.total || 0,
    actors: data?.actors || {},
    isLoading,
    error: error || null,
    refresh: () => mutate(),
  };
}
