"use client";

/**
 * Telemetry Historical Query Hook
 *
 * Encapsulates SWR-based fetching of historical telemetry data.
 * Used by TelemetryProvider and SharedTelemetryProvider.
 */

import { useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { TelemetryData } from "@/components/dashboard/telemetry-provider";

interface UseTelemetryHistoricalOptions {
  /** Metrics to fetch */
  metrics: string[];
  /** Time range value (e.g. "15m", "1h") */
  timeRange?: string;
  /** Share token for public/shared dashboard access */
  shareToken?: string;
  /** Password for password-protected share links */
  password?: string;
  /** Auto-refresh interval in ms (0 = disabled) */
  refreshInterval?: number;
  /** Max rows for the query (server clamps). Scale with metric count —
   * aggregated multi-metric fetches silently lose the OLDEST points to the
   * server's default cap otherwise. */
  limit?: number;
}

export function useTelemetryHistorical(options: UseTelemetryHistoricalOptions) {
  const {
    metrics,
    timeRange = "15m",
    shareToken,
    password,
    refreshInterval = 0,
    limit,
  } = options;

  const queryUrl = useMemo(() => {
    if (metrics.length === 0) return null;

    const params = new URLSearchParams({
      metrics: metrics.join(","),
      timeRange,
    });

    if (limit) {
      params.set("limit", String(limit));
    }

    if (password) {
      params.set("password", password);
    }

    return shareToken
      ? `/api/shared/${shareToken}/telemetry?${params}`
      : `/api/telemetry/query?${params}`;
  }, [metrics, timeRange, shareToken, password, limit]);

  return useSWR<{ data: TelemetryData }>(queryUrl, fetcher, {
    refreshInterval,
    revalidateOnFocus: false,
    revalidateOnReconnect: refreshInterval > 0,
  });
}
