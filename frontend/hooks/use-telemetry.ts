import useSWR from "swr";
import { useMemo } from "react";
import { fetcher } from "@/lib/fetcher";

/**
 * Metrics grouped by source for differentiation
 */
export interface MetricsBySource {
  source_id: string;
  metrics: string[];
  isRegistered?: boolean;
}

/**
 * Hook for fetching available metrics from ClickHouse
 */
export function useAvailableMetrics() {
  const { data, error, isLoading, mutate } = useSWR<{
    metrics: Array<{ metric: string }>;
    metricsBySource: MetricsBySource[];
  }>("/api/telemetry/metrics", fetcher, {
    refreshInterval: 120000,
  });

  const metrics = useMemo(
    () => data?.metrics?.map((m) => m.metric) ?? [],
    [data],
  );
  const metricsBySource = useMemo(() => data?.metricsBySource ?? [], [data]);

  return {
    metrics,
    metricsBySource,
    isLoading,
    error,
    mutate,
  };
}

/**
 * Hook for fetching raw (tall) telemetry rows for table display
 */
export function useTelemetryRows(
  sourceId: string | null,
  options?: {
    timeRange?: string;
    limit?: number;
    offset?: number;
    metric?: string;
  },
) {
  const { timeRange = "24h", limit = 100, offset = 0, metric } = options || {};

  const params = new URLSearchParams({
    sourceId: sourceId || "",
    timeRange,
    limit: String(limit),
    offset: String(offset),
  });
  if (metric) params.set("metric", metric);

  const shouldFetch = !!sourceId;

  const { data, error, isLoading, mutate } = useSWR<{
    rows: Record<string, unknown>[];
    columns: string[];
    total: number;
    hasMore: boolean;
  }>(shouldFetch ? `/api/telemetry/rows?${params}` : null, fetcher);

  return {
    rows: data?.rows || [],
    columns: data?.columns || [],
    total: data?.total || 0,
    hasMore: data?.hasMore || false,
    isLoading,
    error,
    mutate,
  };
}

/**
 * Hook for fetching available metrics for a specific source
 */
export function useSourceMetrics(sourceId: string | null) {
  const { data, isLoading } = useSWR<{
    metrics: Array<{ name: string; type?: string }>;
  }>(sourceId ? `/api/sources/${sourceId}/metrics` : null, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  });

  return {
    metrics: data?.metrics?.map((m) => m.name) ?? [],
    isLoading,
  };
}
