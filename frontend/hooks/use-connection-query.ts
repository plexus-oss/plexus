"use client";

/**
 * Connection Query Hook
 *
 * Execute and cache queries against connection sources.
 * Supports automatic time range injection for dashboard integration.
 */

import useSWR from "swr";
import { useCallback, useState, useMemo } from "react";
import { toast } from "sonner";
import type { TimeRange, DataFilter } from "@/lib/types/dashboard";
import {
  substituteVariables,
  injectConditions,
  type InjectedQuery,
} from "@/lib/transforms/connection-query";
import { useSharedQueryContext } from "@/components/dashboard/shared-query-context";

// Re-export utilities for backward compatibility
export {
  substituteVariables,
  injectConditions,
  type InjectedQuery,
};

// =============================================================================
// Types
// =============================================================================

export interface QueryColumn {
  name: string;
  type: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  executionTimeMs: number;
  truncated: boolean;
  /** True when row-level scope denied the whole query (fail-closed empty). */
  restricted?: boolean;
}

export interface UseConnectionQueryOptions {
  /** Source ID (UUID or slug) */
  sourceId: string | null;
  /** SQL query to execute */
  query: string;
  /** Query parameters for parameterized queries */
  params?: Record<string, unknown>;
  /** Maximum rows to return (default 1000, max 10000) */
  limit?: number;
  /** Query timeout in ms (default 30000) */
  timeout?: number;
  /** Enable the query (default true) */
  enabled?: boolean;
  /** Auto-refresh interval in ms (0 = disabled) */
  refreshInterval?: number;
  /** Time range to inject into query (optional) */
  timeRange?: TimeRange;
  /** Column name for time filtering (default: "timestamp") */
  timeColumn?: string;
  /** Measure column — enables auto-bucketing of long ranges. */
  valueColumn?: string;
  /** Breakdown column — preserved as a GROUP BY key when bucketing. */
  seriesColumn?: string;
  /** Data filters to apply to the query */
  filters?: DataFilter[];
  /** Template variables to substitute into the query ($name → value) */
  variables?: Record<string, string>;
  /** Panel ID — required when the query is running inside a shared dashboard */
  panelId?: string;
}

// =============================================================================
// Fetcher
// =============================================================================

interface FetcherArgs {
  sourceId: string;
  query: string;
  params?: Record<string, unknown>;
  limit?: number;
  timeout?: number;
  shared?: { token: string; panelId: string; password?: string };
}

const PLEXUS_SOURCE_ID = "__plexus__";

/** Query failure carrying the SQL that was executed (owner-authed only). */
export class QueryError extends Error {
  sql?: string;
  /** True when the caller's access scope excludes this data (RESTRICTED). */
  restricted?: boolean;
  constructor(message: string, sql?: string, restricted?: boolean) {
    super(message);
    this.name = "QueryError";
    this.sql = sql;
    this.restricted = restricted;
  }
}

const queryFetcher = async (args: FetcherArgs): Promise<QueryResult> => {
  if (args.shared) {
    const res = await fetch(`/api/shared/${args.shared.token}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        panelId: args.shared.panelId,
        password: args.shared.password,
      }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || "Query execution failed");
    }
    return res.json();
  }

  const url =
    args.sourceId === PLEXUS_SOURCE_ID
      ? "/api/telemetry/connection/query"
      : `/api/sources/${args.sourceId}/query`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: args.query,
      params: args.params,
      limit: args.limit,
      timeout: args.timeout,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Unknown error" }));
    // Structured ApiError responses carry {error: CODE, message}; driver
    // errors carry {error: <message>, sql}. Prefer the human message.
    const restricted = error.error === "RESTRICTED";
    throw new QueryError(
      error.message || error.error || "Query execution failed",
      typeof error.sql === "string" ? error.sql : undefined,
      restricted,
    );
  }

  return res.json();
};

// =============================================================================
// Hook
// =============================================================================

export function useConnectionQuery(options: UseConnectionQueryOptions) {
  const {
    sourceId,
    query,
    params,
    limit,
    timeout,
    enabled = true,
    refreshInterval = 0,
    timeRange,
    timeColumn,
    valueColumn,
    seriesColumn,
    filters,
    variables,
    panelId,
  } = options;

  const sharedCtx = useSharedQueryContext();
  const sharedArgs =
    sharedCtx && panelId
      ? { token: sharedCtx.shareToken, panelId, password: sharedCtx.password }
      : undefined;

  // Pipeline: substituteVariables → injectConditions
  const injected = useMemo(() => {
    if (!query.trim()) return { sql: query, params: [] as unknown[] };

    // Dialect hint: the built-in Plexus telemetry source is ClickHouse; all
    // other sources are Postgres-compatible today.
    const dialect =
      sourceId === PLEXUS_SOURCE_ID ? "clickhouse" : "postgres";

    // Step 1: Substitute $__timeFilter() macro and variables
    const result = substituteVariables(query, variables ?? {}, timeRange, dialect);

    // Step 2: Inject conditions (filters + time WHERE) and apply deterministic
    // ordering / long-range auto-bucketing via CTE wrapping. Pass the real
    // timeRange always (it drives ordering + bucket sizing); `timeAlreadyFiltered`
    // tells injectConditions the $__timeFilter() macro already added the time
    // WHERE, so it won't double-filter but can still order/bucket;
    // `alreadyAggregated` skips the outer bucket wrap for queries that already
    // $__timeGroup themselves (double-bucketing a fixed bucket is wrong).
    return injectConditions(result.sql, {
      timeRange,
      timeColumn,
      valueColumn,
      seriesColumn,
      filters,
      timeAlreadyFiltered: result.hadTimeMacro,
      alreadyAggregated: result.hadTimeGroup,
      dialect,
    });
  }, [
    query,
    variables,
    timeRange,
    timeColumn,
    valueColumn,
    seriesColumn,
    filters,
    sourceId,
  ]);

  const effectiveQuery = injected.sql;

  // Merge explicit params with filter params
  const effectiveParams = useMemo(() => {
    if (injected.params.length === 0) return params;
    // Filter params are positional ($1, $2, ...) — pass as array under __filterParams
    return { ...params, __filterParams: injected.params };
  }, [params, injected.params]);

  // Generate a stable key for SWR (include time range for cache busting)
  // In shared context, the server derives the query from the panel config, so
  // we only need sourceId + panelId + share token to identify the request.
  const shouldFetch = sharedArgs
    ? enabled && !!sharedArgs.panelId
    : enabled && sourceId && effectiveQuery.trim().length > 0;
  const swrKey = shouldFetch
    ? sharedArgs
      ? {
          type: "connection-query-shared",
          token: sharedArgs.token,
          panelId: sharedArgs.panelId,
        }
      : {
          type: "connection-query",
          sourceId,
          query: effectiveQuery,
          params: effectiveParams,
          limit,
          timeout,
        }
    : null;

  const { data, error, isLoading, mutate } = useSWR<QueryResult>(
    swrKey,
    () =>
      queryFetcher({
        sourceId: sourceId!,
        query: effectiveQuery,
        params: effectiveParams,
        limit,
        timeout,
        shared: sharedArgs,
      }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 5000,
      refreshInterval: refreshInterval > 0 ? refreshInterval : undefined,
    },
  );

  // Manual execute function for on-demand queries
  const execute = useCallback(
    async (overrideQuery?: string): Promise<QueryResult | null> => {
      if (!sourceId) {
        toast.error("No source selected");
        return null;
      }

      let queryToRun = overrideQuery ?? effectiveQuery;
      if (!queryToRun.trim()) {
        toast.error("Query is empty");
        return null;
      }

      // Apply time range to override query if provided
      if (overrideQuery && timeRange) {
        queryToRun = injectConditions(overrideQuery, {
          timeRange,
          timeColumn,
        }).sql;
      }

      try {
        const result = await queryFetcher({
          sourceId,
          query: queryToRun,
          params: effectiveParams,
          limit,
          timeout,
        });
        // Update the cache with the new result
        await mutate(result, false);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Query failed";
        toast.error(message);
        throw err;
      }
    },
    [
      sourceId,
      effectiveQuery,
      effectiveParams,
      limit,
      timeout,
      mutate,
      timeRange,
      timeColumn,
    ],
  );

  return {
    // Query result data
    data: data ?? null,
    columns: data?.columns ?? [],
    rows: data?.rows ?? [],
    rowCount: data?.rowCount ?? 0,
    executionTimeMs: data?.executionTimeMs ?? 0,
    truncated: data?.truncated ?? false,

    // State
    isLoading,
    error,

    // Actions
    execute,
    refresh: mutate,
  };
}

// =============================================================================
// Data Range Probe Hook
// =============================================================================

/** Normalize a DB timestamp value to an ISO-8601 UTC string. */
function toIsoUtc(value: unknown): string {
  const s = String(value);
  // Already has a timezone designator.
  if (/T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s;
  // "YYYY-MM-DD HH:MM:SS[.fff]" (ClickHouse-style) — treat as UTC.
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(s);
  if (m) return `${m[1]}T${m[2]}Z`;
  return s;
}

/**
 * Probe the real min/max of a query's time column, ignoring the active time
 * range. Used to explain an empty chart whose data simply falls outside the
 * selected window ("data exists from X to Y") and to power a jump-to-data
 * action. Runs lazily — gate it behind `enabled` (e.g. only on 0-row results).
 *
 * Not available in shared-dashboard context (no direct query credentials).
 */
export function useConnectionDataRange(options: {
  sourceId: string | null;
  /** Raw user query (may contain $__timeFilter / variables). */
  query: string;
  /** Output column name to take min/max over. */
  timeColumn?: string;
  variables?: Record<string, string>;
  enabled?: boolean;
}): { earliest: string; latest: string } | null {
  const { sourceId, query, timeColumn, variables, enabled = true } = options;
  const sharedCtx = useSharedQueryContext();

  const probe = useMemo(() => {
    if (!query.trim() || !timeColumn) return null;
    const dialect = sourceId === PLEXUS_SOURCE_ID ? "clickhouse" : "postgres";
    // Neutralize $__timeFilter() (→ TRUE) so we see the full span, not the
    // windowed slice.
    const { sql } = substituteVariables(query, variables ?? {}, undefined, dialect);
    const inner = sql.replace(/;\s*$/, "").trim();
    const col = `"${timeColumn}"`;
    return `SELECT min(${col}) AS lo, max(${col}) AS hi FROM (\n${inner}\n) _probe`;
  }, [query, timeColumn, variables, sourceId]);

  const shouldFetch = enabled && !sharedCtx && !!sourceId && !!probe;
  const swrKey = shouldFetch
    ? { type: "connection-range-probe", sourceId, probe }
    : null;

  const { data } = useSWR<QueryResult>(
    swrKey,
    () => queryFetcher({ sourceId: sourceId!, query: probe!, limit: 1 }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
    },
  );

  const row = data?.rows?.[0];
  if (!row) return null;
  const lo = row.lo ?? row.min ?? null;
  const hi = row.hi ?? row.max ?? null;
  if (lo == null || hi == null) return null;
  return { earliest: toIsoUtc(lo), latest: toIsoUtc(hi) };
}

// =============================================================================
// Manual Query Hook (no automatic fetching)
// =============================================================================

export function useConnectionQueryManual(sourceId: string | null) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);

  const execute = useCallback(
    async (
      query: string,
      options?: {
        params?: Record<string, unknown>;
        limit?: number;
        timeout?: number;
        /** Report failures only via the returned `error` state (no toast) —
         *  for callers with their own inline error surface. */
        silent?: boolean;
      },
    ): Promise<QueryResult | null> => {
      if (!sourceId) {
        toast.error("No source selected");
        return null;
      }

      if (!query.trim()) {
        toast.error("Query is empty");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await queryFetcher({
          sourceId,
          query,
          params: options?.params,
          limit: options?.limit,
          timeout: options?.timeout,
        });
        setResult(result);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Query failed");
        setError(error);
        if (!options?.silent) toast.error(error.message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [sourceId],
  );

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    // Query result data
    result,
    columns: result?.columns ?? [],
    rows: result?.rows ?? [],
    rowCount: result?.rowCount ?? 0,
    executionTimeMs: result?.executionTimeMs ?? 0,
    truncated: result?.truncated ?? false,

    // State
    isLoading,
    error,

    // Actions
    execute,
    clear,
  };
}
