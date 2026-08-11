"use client";

/**
 * Fleet rollup data the client can't cheaply derive: per-source open-alert
 * count + 90-day noise tally, plus platform background-loop health. Composed
 * with useSources / useMonitors / useFleetHealth on the fleet page.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

export interface FleetAlertRow {
  /** Source UUID (sources.id / alerts.source_id). */
  source_id: string;
  open: number;
  noise: number;
  noise_total: number;
}

export interface PlatformLoopHealth {
  started: boolean;
  stale: string[];
  ageSeconds: Partial<Record<string, number>>;
}

export function useFleetOverview() {
  const { data, error, isLoading, mutate } = useSWR<{
    alerts: FleetAlertRow[];
    platform: PlatformLoopHealth;
  }>("/api/fleet/overview", fetcher, {
    refreshInterval: 30000,
  });

  return {
    alertsBySource: data?.alerts ?? [],
    platform: data?.platform ?? null,
    isLoading,
    error,
    refresh: mutate,
  };
}
