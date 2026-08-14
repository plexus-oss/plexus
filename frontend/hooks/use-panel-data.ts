"use client";

/**
 * Orchestrator hook for panel data.
 *
 * Pulls: data via useSourceData → pipeline (aggregate/transform/filter) →
 * limits + validation → timestamp registry side-effect.
 *
 * Heavy lifting lives in `lib/panel-pipeline.ts` and `hooks/use-source-data.ts`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type TelemetryData } from "@/components/dashboard/telemetry-provider";
import { useSourceData } from "@/hooks/use-source-data";
import {
  useConnectionDataRange,
  type QueryResult,
} from "@/hooks/use-connection-query";
import { useMonitors } from "@/hooks/use-monitors";
import type { UnifiedLimit } from "@/lib/limits";
import { useChartValidation } from "@/hooks/use-chart-validation";
import { type Panel, type TimeRange } from "@/lib/types/dashboard";
import {
  useDashboardFilters,
  useDashboardVariables,
} from "@/components/dashboard/dashboard-state-context";
import type { ChartType } from "@/lib/validation/chart-schemas";
import type { ValidationResult } from "@/lib/validation/types";
import {
  clipPointsToWindow,
  resolveClipWindow,
  runPanelPipeline,
} from "@/lib/panel-pipeline";
import { useRegisterPanelTimestamps } from "@/hooks/use-register-panel-timestamps";
import {
  getPanelDataSource,
  type PanelDataSource,
} from "@/lib/panels/data-source";
import { generateMockData } from "@/lib/panels/mock-data";
import { measureColumns } from "@/lib/dashboard/column-roles";


export interface PanelDataResult {
  // Core data
  data: TelemetryData;
  isLoading: boolean;
  error: Error | undefined;
  /**
   * True when the caller's access scope excludes this panel's data (query
   * rejected as RESTRICTED, or row-level scope denied the whole result).
   * Panels should render a quiet "not available" state, not an error.
   */
  restricted: boolean;
  refresh: () => void;

  // Freshness (unified across source types)
  lastUpdatedAt: Date | null;
  isLive: boolean;
  isStale: boolean;

  // Metadata
  sourceType: "realtime" | "connection";
  metrics: string[];

  // Limits (for charts with limit lines). sourceId is the real source_id of
  // the monitor behind the limit (for deep-linking to /alerts/monitors).
  limits: Record<string, (UnifiedLimit & { sourceId?: string }) | null> | null;

  // Primary source ID (extracted from metrics or config)
  primarySourceId: string | null;

  // Validation (for chart rendering)
  validation: ValidationResult | null;

  // Connection query extras
  connectionMeta?: {
    columns: Array<{ name: string; type: string }>;
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    executionTimeMs: number;
    /** True when the driver row-cap clipped the result (partial data shown). */
    truncated: boolean;
    /** Real min/max of the time column, ignoring the window (0-row probe). */
    actualDataRange?: { earliest: string; latest: string };
  };

  /** True when displaying sample data (no real source connected) */
  isMockData: boolean;
}

interface UsePanelDataOptions {
  /** Panel configuration */
  panel: Panel;
  /** Time range for queries. Optional — omit for static-query panels. */
  timeRange?: TimeRange;
  /** Chart type for validation (optional) */
  chartType?: ChartType;
  /** Whether to fetch limits */
  fetchLimits?: boolean;
  /** Whether to run validation */
  runValidation?: boolean;
  /** Skip the anti-thundering-herd stagger delay on connection queries.
   *  For interactive previews (draft panels in an editor) where a random
   *  0–2s wait reads as breakage. Leave false for grid-rendered panels. */
  immediate?: boolean;
}

/**
 * Marks a subtree as an interactive preview: every usePanelData call under it
 * behaves as if `immediate: true`. Lets a preview render the real panel
 * component (which calls usePanelData itself) without threading a prop
 * through every panel type.
 */
export const PanelDataPreviewContext = createContext(false);

/**
 * Consolidated hook for fetching panel data from any source
 *
 * Usage:
 * ```tsx
 * const { data, isLoading, limits, validation } = usePanelData({
 *   panel,
 *   timeRange,
 *   chartType: "line",
 *   fetchLimits: true,
 * });
 * ```
 */
export function usePanelData({
  panel,
  timeRange,
  chartType,
  fetchLimits = false,
  runValidation = false,
  immediate = false,
}: UsePanelDataOptions): PanelDataResult {
  const previewImmediate = useContext(PanelDataPreviewContext);
  if (previewImmediate) immediate = true;
  // Dashboard-level filters and variables from context
  const { filters: dashboardFilters } = useDashboardFilters();
  const { values: variableValues } = useDashboardVariables();

  // Merge dashboard + panel filters (dashboard filters inherited by all panels,
  // panel filters override on the same field).
  const panelFilters = panel.config.filters;
  const mergedFilters = useMemo(() => {
    const panelFields = new Set((panelFilters || []).map((f) => f.field));
    const applicableDashboard = (dashboardFilters || []).filter(
      (f) => !panelFields.has(f.field),
    );
    return [...applicableDashboard, ...(panelFilters || [])];
  }, [dashboardFilters, panelFilters]);

  // Stagger connection queries so N panels don't all hit the DB at once.
  const isConnection = panel.dataSource?.type === "connection";
  const [staggered, setStaggered] = useState(false);
  useEffect(() => {
    if (!isConnection || immediate) return;
    let hash = 0;
    for (let i = 0; i < panel.id.length; i++) {
      hash = ((hash << 5) - hash + panel.id.charCodeAt(i)) | 0;
    }
    const delay = Math.abs(hash) % 2000;
    const timer = setTimeout(() => setStaggered(true), delay);
    return () => clearTimeout(timer);
  }, [isConnection, immediate, panel.id]);
  // Non-connection panels are ready immediately; connection panels become ready
  // once their stagger timer fires. Once ready it stays ready (prior behavior).
  const staggerReady = !isConnection || immediate || staggered;

  // One normalized data source. For metrics, qualify bare names with the
  // panel's sourceId and dedupe. Previously we emitted both the qualified and
  // unqualified form "for compat"; the server then returned the same data
  // under two keys (one from a scoped-source query, one from a `*` wildcard
  // query), and only the qualified one received realtime appends. The result
  // was a ghost historical-only line drawn alongside the live series during
  // recording.
  const dataSource = useMemo<PanelDataSource>(() => {
    const base = getPanelDataSource(panel, { timeRange });
    if (base.kind === "metrics" && base.sourceId) {
      const seen = new Set<string>();
      const normalized: string[] = [];
      for (const m of base.metrics) {
        const key = m.includes(":") ? m : `${base.sourceId}:${m}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push(key);
      }
      return { ...base, metrics: normalized };
    }
    if (base.kind === "sql") {
      return {
        ...base,
        filters: mergedFilters,
        variables: variableValues,
      };
    }
    return base;
  }, [panel, timeRange, mergedFilters, variableValues]);

  // Sample-data panels (metrics all prefixed "demo:") skip the real fetch
  // entirely — no WS subscribe, no historical query, no polling.
  const isMockData =
    dataSource.kind === "metrics" &&
    dataSource.metrics.length > 0 &&
    dataSource.metrics.every((m) => m.startsWith("demo:"));

  const result = useSourceData(dataSource, {
    enabled:
      !isMockData && (dataSource.kind === "sql" ? staggerReady : true),
    refreshInterval:
      dataSource.kind === "sql" ? dataSource.refreshInterval : undefined,
  });

  // Extract SQL-specific metadata for panels that need raw columns/rows.
  const sqlResult =
    dataSource.kind === "sql" ? (result.data as QueryResult | null) : null;
  const connectionRows = useMemo(() => sqlResult?.rows ?? [], [sqlResult]);
  const connectionColumns = useMemo(
    () => sqlResult?.columns ?? [],
    [sqlResult],
  );
  const connectionRowCount = sqlResult?.rowCount ?? 0;
  const connectionExecMs = sqlResult?.executionTimeMs ?? 0;
  const connectionTruncated = sqlResult?.truncated ?? false;

  // Pivot SQL rows → TelemetryData shape so panels can consume both sources
  // identically from `data`. Realtime is already in TelemetryData shape.
  const connectionTimeColumn =
    dataSource.kind === "sql" ? dataSource.timeColumn : undefined;
  const connectionValueColumn =
    dataSource.kind === "sql" ? dataSource.valueColumn : undefined;
  const connectionSeriesColumn =
    dataSource.kind === "sql" ? dataSource.seriesColumn : undefined;

  // Resolve the effective time column (explicit, else auto-detected from the
  // returned columns — present even on 0-row results). Shared with the data
  // pivot below and the empty-range probe.
  const resolvedTimeColumn = useMemo(() => {
    if (connectionTimeColumn) return connectionTimeColumn;
    const typed = connectionColumns.find((c) => {
      const t = c.type.toLowerCase();
      return t.includes("timestamp") || t.includes("date") || t === "time";
    })?.name;
    if (typed) return typed;
    return connectionColumns.find((c) =>
      ["timestamp", "time", "ts", "created_at"].includes(c.name.toLowerCase()),
    )?.name;
  }, [connectionTimeColumn, connectionColumns]);

  // When a connection query returns no rows but a time column exists, probe the
  // table's real time span. If data exists outside the window, the panel can
  // say so and offer a jump-to-data action instead of a misleading "no data".
  const wantDataRangeProbe =
    dataSource.kind === "sql" &&
    connectionRowCount === 0 &&
    !!timeRange &&
    !!resolvedTimeColumn &&
    !result.isLoading &&
    !result.error;
  const actualDataRange = useConnectionDataRange({
    sourceId: dataSource.kind === "sql" ? dataSource.sourceId : null,
    query: dataSource.kind === "sql" ? dataSource.sql : "",
    timeColumn: resolvedTimeColumn,
    variables: dataSource.kind === "sql" ? dataSource.variables : undefined,
    enabled: wantDataRangeProbe,
  });

  const mockData = useMemo<TelemetryData | null>(
    () => (isMockData ? generateMockData(panel.type) : null),
    [isMockData, panel.type],
  );

  const data = useMemo<TelemetryData>(() => {
    if (mockData) return mockData;
    if (dataSource.kind === "metrics") {
      return (result.data as TelemetryData | null) || {};
    }
    if (!sqlResult) return {};
    // note: memo deps below include mockData

    const out: TelemetryData = {};
    // Resolve the time column. If the user set one, use it. Otherwise try to
    // auto-detect from the returned columns — a timestamp/date-typed column,
    // or any column literally named "timestamp"/"time"/"ts".
    const autoTimeCol = connectionColumns.find((c) => {
      const t = c.type.toLowerCase();
      return t.includes("timestamp") || t.includes("date") || t === "time";
    })?.name ??
      connectionColumns.find((c) =>
        ["timestamp", "time", "ts", "created_at"].includes(c.name.toLowerCase()),
      )?.name;
    const timeCol = connectionTimeColumn || autoTimeCol;
    if (!timeCol) return {};

    // Only real measures are plottable — never ids/keys/categoricals (that's
    // what kept `sat_id`/`orbit_id` off the chart). The pivot/series column is
    // also excluded so it can't double as a measure.
    const measures = measureColumns(connectionColumns, {
      timeColumn: timeCol,
      joinKeys: connectionSeriesColumn ? [connectionSeriesColumn] : undefined,
    });
    const valueCol =
      connectionValueColumn ||
      (measures.length === 1 ? measures[0] : undefined) ||
      measures.find((m) => m === "count") ||
      "value";

    // Breakdown/pivot: long-format rows → one series per distinct value of the
    // series column (e.g. one line per `assoc_type`).
    if (connectionSeriesColumn) {
      for (const row of connectionRows) {
        if (row[timeCol] == null) continue;
        const v = row[valueCol];
        if (v == null) continue;
        const key = String(row[connectionSeriesColumn] ?? "—");
        (out[key] ??= []).push({
          timestamp: String(row[timeCol]),
          value: Number(v),
        });
      }
      return out;
    }

    if (connectionValueColumn) {
      out[connectionValueColumn] = connectionRows
        .filter((row) => row[timeCol] != null && row[valueCol] != null)
        .map((row) => ({
          timestamp: String(row[timeCol]),
          value: Number(row[valueCol]),
        }));
      return out;
    }

    // Auto: one series per measure column.
    for (const colName of measures) {
      out[colName] = connectionRows
        .filter((row) => row[timeCol] != null && row[colName] != null)
        .map((row) => ({
          timestamp: String(row[timeCol]),
          value: Number(row[colName]),
        }));
    }
    return out;
  }, [
    mockData,
    dataSource.kind,
    result.data,
    sqlResult,
    connectionRows,
    connectionColumns,
    connectionTimeColumn,
    connectionValueColumn,
    connectionSeriesColumn,
  ]);

  const isLoading = result.isLoading;
  const error = result.error ?? undefined;
  const restricted =
    (error as { restricted?: boolean } | undefined)?.restricted === true ||
    (dataSource.kind === "sql" &&
      (result.data as { restricted?: boolean } | null)?.restricted === true);
  const refresh = useCallback(() => {
    void result.refresh();
  }, [result]);

  // ============================================================================
  // PIPELINE — aggregate → transform → client-filter
  // Connection sources already filter via SQL injection, so skip client filters.
  // ============================================================================

  // Clip data to the selected time window. Connection queries already filter
  // server-side (redundant but cheap). For realtime/metrics paths this is the
  // only thing that evicts points older than the window — the underlying WS
  // store keeps the last N by count, not by time, so it can retain stale
  // points past a shrunk window.
  //
  // Only the LOWER bound is enforced for relative ranges: server-stamped
  // points can arrive a few seconds ahead of the browser clock, and the whole
  // point of a live chart is to show the newest data. For absolute ranges we
  // honor both bounds (the user picked a closed interval on purpose).
  //
  // Reference-stability matters here: every WS tick produces a fresh `data`
  // object, so we cache per-metric filtered arrays keyed on (input array ref,
  // cutoff bucket). For relative ranges we quantize the cutoff to 1s so most
  // ticks share a cache key and downstream memos don't re-run. The cache map
  // is held in state (lazy init) so the same instance persists across renders
  // without reading a ref during render — same pattern as useChartSeries's
  // conversion cache.
  const [windowCache] = useState(
    () =>
      new Map<
        string,
        { input: unknown; startBucket: number; endBucket: number; output: unknown }
      >(),
  );
  const windowedData = useMemo<TelemetryData>(() => {
    if (!timeRange || !data) return data;
    // Bounds resolution lives in lib/panel-pipeline (pure, unit-tested).
    // Relative ranges anchor to the newest data timestamp — the same anchor
    // the rendered x-domain uses — so the clip can never erode points the
    // domain is still displaying (see resolveClipWindow). Quantized to 1s so
    // points don't flap in/out of the window every render when the anchor
    // advances by a few ms.
    const clipWindow = resolveClipWindow(timeRange, data);
    const { startBucket, endBucket } = clipWindow;
    const cache = windowCache;
    const out: TelemetryData = {};
    for (const [key, points] of Object.entries(data)) {
      if (!Array.isArray(points)) continue;
      const cached = cache.get(key);
      if (
        cached &&
        cached.input === points &&
        cached.startBucket === startBucket &&
        cached.endBucket === endBucket
      ) {
        out[key] = cached.output as typeof points;
        continue;
      }
      // clipPointsToWindow fast-paths the all-inside case by returning the
      // input array verbatim, preserving reference equality.
      const filtered = clipPointsToWindow(points, clipWindow);
      out[key] = filtered;
      cache.set(key, {
        input: points,
        startBucket,
        endBucket,
        output: filtered,
      });
    }
    // Drop cache entries for metrics no longer present so the map doesn't
    // grow unbounded across the session.
    if (cache.size > Object.keys(out).length) {
      for (const key of cache.keys()) {
        if (!(key in out)) cache.delete(key);
      }
    }
    return out;
  }, [data, timeRange, windowCache]);

  const filteredData = useMemo(
    () =>
      runPanelPipeline(windowedData, {
        aggregation: panel.config.dataAggregation,
        transforms: panel.config.transforms,
        clientFilters: isConnection ? undefined : mergedFilters,
      }),
    [
      windowedData,
      panel.config.dataAggregation,
      panel.config.transforms,
      mergedFilters,
      isConnection,
    ],
  );

  // ============================================================================
  // MONITOR THRESHOLDS - Only fetch if needed and source supports it
  // ============================================================================

  const primarySourceId = useMemo(() => {
    if (dataSource.sourceId) return dataSource.sourceId;
    if (panel.config.sourceId) return panel.config.sourceId;
    if (panel.sources?.[0]) return panel.sources[0];
    for (const m of panel.metrics ?? []) {
      if (m.includes(":")) return m.split(":")[0];
    }
    return null;
  }, [dataSource.sourceId, panel.config.sourceId, panel.sources, panel.metrics]);

  const { monitors } = useMonitors(fetchLimits && !!primarySourceId);
  const limits = useMemo<Record<
    string,
    UnifiedLimit & { sourceId?: string }
  > | null>(() => {
    if (!fetchLimits || !primarySourceId) return null;
    const result: Record<string, UnifiedLimit & { sourceId?: string }> = {};
    for (const m of monitors) {
      const matches =
        m.source_id === primarySourceId || m.source_slug === primarySourceId;
      if (!matches || !m.threshold) continue;
      result[m.metric] = {
        min: m.threshold.min ?? undefined,
        max: m.threshold.max ?? undefined,
        severity:
          (m.threshold.severity as "critical" | "warning" | "info") ||
          "warning",
        message: m.threshold.message ?? undefined,
        // Real source_id (primarySourceId may be a slug) — needed to deep-link
        // to the monitor at /alerts/monitors?monitor=<source_id>::<metric>.
        sourceId: m.source_id,
      };
    }
    return result;
  }, [fetchLimits, primarySourceId, monitors]);

  // ============================================================================
  // VALIDATION - Only run if needed
  // ============================================================================

  const displayedMetrics = useMemo(
    () =>
      dataSource.kind === "sql"
        ? // With a breakdown the series are the distinct pivot values (data keys);
          // otherwise an explicit value column, else whatever the pivot produced.
          connectionValueColumn && !connectionSeriesColumn
          ? [connectionValueColumn]
          : Object.keys(data)
        : dataSource.metrics,
    [dataSource, connectionValueColumn, connectionSeriesColumn, data],
  );

  const validation = useChartValidation({
    chartType: runValidation && chartType ? chartType : ("line" as ChartType),
    data: runValidation ? filteredData : {},
    metrics: runValidation ? displayedMetrics : [],
    coerceValues: true,
  });

  useRegisterPanelTimestamps(panel.id, filteredData);

  // ============================================================================
  // RESULT
  // ============================================================================

  return useMemo(
    () => ({
      data: filteredData,
      isLoading,
      error,
      restricted,
      refresh,
      sourceType: dataSource.kind === "sql" ? "connection" : "realtime",
      metrics: displayedMetrics,
      limits,
      primarySourceId,
      validation: runValidation ? validation : null,
      connectionMeta:
        dataSource.kind === "sql"
          ? {
              columns: connectionColumns,
              rows: connectionRows,
              rowCount: connectionRowCount,
              executionTimeMs: connectionExecMs,
              truncated: connectionTruncated,
              actualDataRange: actualDataRange ?? undefined,
            }
          : undefined,
      isMockData,
      lastUpdatedAt: result.lastUpdatedAt,
      isLive: result.isLive,
      isStale: result.isStale,
    }),
    [
      filteredData,
      isLoading,
      error,
      restricted,
      refresh,
      dataSource.kind,
      displayedMetrics,
      limits,
      primarySourceId,
      runValidation,
      validation,
      connectionColumns,
      connectionRows,
      connectionRowCount,
      connectionExecMs,
      connectionTruncated,
      actualDataRange,
      result.lastUpdatedAt,
      result.isLive,
      result.isStale,
      isMockData,
    ],
  );
}
