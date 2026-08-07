"use client";

/**
 * Unified source-data adapter.
 *
 * One hook, one freshness contract, regardless of whether data comes from
 * live WS telemetry, a ClickHouse historical query, or an external DB.
 *
 * Dispatch is on the query *kind*, not the source type — a ClickHouse
 * connection can serve metrics, a device can be SQL-queried.
 */

import { useEffect, useMemo, useState } from "react";
import { useConnectionQuery } from "@/hooks/use-connection-query";
import {
  useTelemetryData,
  type TelemetryData,
} from "@/components/dashboard/telemetry-provider";
import type { QueryResult } from "@/hooks/use-connection-query";
import { usePageVisibility } from "@/components/ui/lib/visibility";
import { useSource } from "@/hooks/use-sources";
import { useDashboardRefreshInterval } from "@/components/dashboard/dashboard-state-context";
import type { PanelDataSource } from "@/lib/panels/data-source";

export interface UseSourceDataOptions {
  enabled?: boolean;
  /**
   * Explicit poll interval (ms) override. When omitted, the hook falls back
   * to the source's `config.refreshInterval` (settable per connection by the
   * customer), then to DEFAULT_REFRESH_INTERVAL_MS.
   * Set to 0 to disable polling.
   */
  refreshInterval?: number;
}

export interface UseSourceDataResult<T = TelemetryData | QueryResult> {
  data: T | null;
  lastUpdatedAt: Date | null;
  /** true when data is arriving via a live WS channel. */
  isLive: boolean;
  /**
   * true when the data path *should* be fresh but isn't:
   *   - live path: no data in >60s
   *   - polled path: last fetch older than refreshInterval × 2
   */
  isStale: boolean;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<unknown>;
}

const DEFAULT_REFRESH_INTERVAL_MS = 30_000;
const LIVE_STALE_THRESHOLD_MS = 60_000;

/**
 * Returns true once `thresholdMs` has elapsed since `at`, flipping live via a
 * single scheduled timeout. Keeps the staleness check out of render (no
 * `Date.now()` during render) and avoids both periodic re-renders and
 * synchronous setState inside the effect body.
 */
function useStaleAfter(at: Date | null, thresholdMs: number): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    // Deferred so the "fresh" reset isn't a synchronous setState in the effect.
    const freshId = setTimeout(() => setStale(false), 0);
    if (!at || thresholdMs <= 0) {
      return () => clearTimeout(freshId);
    }
    const ms = at.getTime() + thresholdMs - Date.now();
    const staleId = setTimeout(() => setStale(true), Math.max(ms, 0));
    return () => {
      clearTimeout(freshId);
      clearTimeout(staleId);
    };
  }, [at, thresholdMs]);
  return stale;
}

export function useSourceData(
  dataSource: PanelDataSource,
  options: UseSourceDataOptions = {},
): UseSourceDataResult {
  const { enabled = true } = options;

  const isSql = dataSource.kind === "sql";
  const isMetrics = dataSource.kind === "metrics";
  const sourceId = dataSource.sourceId;

  // Per-source refresh default. Customer sets `config.refreshInterval` (ms)
  // on the source row to tune cadence for their DB.
  const { source } = useSource(isSql ? sourceId : null);
  const sourceConfig = source?.config as
    | { refreshInterval?: number }
    | null
    | undefined;
  const sourceRefreshInterval =
    typeof sourceConfig?.refreshInterval === "number"
      ? sourceConfig.refreshInterval
      : undefined;

  // Dashboard toolbar refresh — when the user picks a cadence in the toolbar
  // it applies to every panel in the dashboard.
  // 0 means "off": fall through to source/default.
  const dashboardRefreshInterval = useDashboardRefreshInterval();

  // Precedence: explicit option > dashboard toolbar > source config > default.
  const refreshInterval =
    options.refreshInterval ??
    (dashboardRefreshInterval > 0
      ? dashboardRefreshInterval
      : (sourceRefreshInterval ?? DEFAULT_REFRESH_INTERVAL_MS));

  // Pause polling when the tab is hidden. SWR's revalidateOnFocus already
  // refreshes on return; setting refreshInterval to 0 while hidden stops the
  // background poll from hitting the customer's DB for an unattended tab.
  const isPageVisible = usePageVisibility();

  // Stable ±10% jitter per panel so a dashboard's worth of panels doesn't
  // fire in lockstep against the same connection pool every tick.
  const [jitterFactor] = useState(() => 0.9 + Math.random() * 0.2);
  const jitteredInterval =
    refreshInterval > 0 ? Math.round(refreshInterval * jitterFactor) : 0;

  const effectiveRefreshInterval = isPageVisible ? jitteredInterval : 0;

  // Both hooks always called — Rules of Hooks. Inactive branch gets a no-op
  // input (empty metrics list / disabled flag) so SWR skips the fetch.

  const sqlSource = isSql
    ? (dataSource as Extract<PanelDataSource, { kind: "sql" }>)
    : null;
  const sqlResult = useConnectionQuery({
    sourceId,
    query: sqlSource?.sql ?? "",
    params: sqlSource?.params,
    limit: sqlSource?.limit,
    timeout: sqlSource?.timeout,
    timeRange: sqlSource?.timeRange,
    timeColumn: sqlSource?.timeColumn,
    valueColumn: sqlSource?.valueColumn,
    seriesColumn: sqlSource?.seriesColumn,
    filters: sqlSource?.filters,
    variables: sqlSource?.variables,
    panelId: sqlSource?.panelId,
    enabled: enabled && isSql,
    refreshInterval: effectiveRefreshInterval,
  });

  // Metrics path: delegate to useTelemetryData, which merges WS (via
  // TelemetryProvider context if present) + historical SWR. isLive reflects
  // actual WS connection state.
  const metricsSource = isMetrics
    ? (dataSource as Extract<PanelDataSource, { kind: "metrics" }>)
    : null;
  const metricsTimeRangeObj =
    metricsSource && typeof metricsSource.timeRange === "object"
      ? metricsSource.timeRange
      : null;
  const metricsResult = useTelemetryData(
    enabled && isMetrics ? (metricsSource?.metrics ?? []) : [],
    metricsTimeRangeObj,
    { panelId: metricsSource?.panelId },
  );

  // Track when SQL data last changed (SWR doesn't expose this directly).
  // Recorded in an effect keyed on the data identity — deferred via setTimeout
  // so it isn't a synchronous setState inside the effect body, and so the wall
  // clock read stays out of render.
  const [sqlLastUpdatedAt, setSqlLastUpdatedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (!isSql || !sqlResult.data) return;
    const id = setTimeout(() => setSqlLastUpdatedAt(new Date()), 0);
    return () => clearTimeout(id);
  }, [isSql, sqlResult.data]);

  const metricsData = metricsResult.data ?? null;
  const metricsLastUpdatedAt = useMemo(() => {
    if (!metricsData) return null;
    let latest = 0;
    for (const points of Object.values(metricsData)) {
      const last = Array.isArray(points) ? points[points.length - 1] : null;
      if (!last) continue;
      const ts = new Date(last.timestamp).getTime();
      if (ts > latest) latest = ts;
    }
    return latest > 0 ? new Date(latest) : null;
  }, [metricsData]);
  const metricsIsLive =
    (metricsResult as { isRealtimeConnected?: boolean }).isRealtimeConnected ===
    true;

  // Staleness derived off scheduled timers (hooks must run before any return).
  const sqlIsStale = useStaleAfter(
    sqlLastUpdatedAt,
    refreshInterval > 0 ? refreshInterval * 2 : 0,
  );
  const metricsIsStale = useStaleAfter(
    metricsLastUpdatedAt,
    LIVE_STALE_THRESHOLD_MS,
  );

  if (isSql) {
    return {
      data: sqlResult.data,
      lastUpdatedAt: sqlLastUpdatedAt,
      isLive: false,
      isStale: sqlIsStale,
      isLoading: sqlResult.isLoading,
      error: (sqlResult.error as Error) ?? null,
      refresh: async () => {
        await sqlResult.refresh();
      },
    };
  }

  // metrics
  return {
    data: metricsData,
    lastUpdatedAt: metricsLastUpdatedAt,
    isLive: metricsIsLive,
    isStale: metricsIsStale,
    isLoading: metricsResult.isLoading,
    error: (metricsResult.error as Error) ?? null,
    refresh: async () => {
      metricsResult.refresh();
    },
  };
}
