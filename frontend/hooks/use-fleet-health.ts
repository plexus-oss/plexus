"use client";

/**
 * Hook for fetching aggregate fleet health data.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

export interface FleetSourceHealth {
  source_id: string;
  point_count: number;
  metrics: Record<
    string,
    {
      avg: number;
      min: number;
      max: number;
      latest: number;
      count: number;
    }
  >;
  last_data_at: string;
}

export interface FleetHealthSummary {
  totalSources: number;
  totalPoints: number;
  missingData: number;
}

export function useFleetHealth() {
  const { data, error, isLoading, mutate } = useSWR<{
    fleet: FleetSourceHealth[];
    summary: FleetHealthSummary;
  }>("/api/fleet/health", fetcher, {
    // Polls every 30s already; focus-revalidation is left to the global config
    // (disabled) so tab-switching doesn't re-fire this fleet-wide aggregate.
    refreshInterval: 30000,
  });

  return {
    fleet: data?.fleet || [],
    summary: data?.summary || {
      totalSources: 0,
      totalPoints: 0,
      missingData: 0,
    },
    isLoading,
    error,
    refresh: mutate,
  };
}
