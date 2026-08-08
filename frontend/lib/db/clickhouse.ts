/**
 * Plexus-Managed ClickHouse Operations
 *
 * Self-hosted ClickHouse on Hetzner for cost-effective telemetry storage.
 * Multi-tenant with org_id isolation and TTL-based retention.
 *
 * Environment variables:
 * - PLEXUS_CLICKHOUSE_URL: Full URL (e.g., https://clickhouse.plexus.company:8443)
 * - PLEXUS_CLICKHOUSE_USER: Username (default: plexus)
 * - PLEXUS_CLICKHOUSE_PASSWORD: Password
 * - PLEXUS_CLICKHOUSE_DATABASE: Database name (default: plexus)
 */

import "server-only";
import { HOUR_MS } from "@/lib/constants/time";

import { createClient, ClickHouseClient } from "@clickhouse/client";
import https from "node:https";
import type { DeviceEvent } from "@/lib/db/types";
import { globalSingleton } from "@/lib/global-singleton";
import { RETENTION } from "@/lib/retention";

// =============================================================================
// TYPES
// =============================================================================

export interface TelemetryRow {
  org_id: string;
  source_id: string;
  metric: string;
  value: number;
  value_string?: string | null;
  value_json?: string | null;
  timestamp: Date | string;
  tags?: Record<string, string>;
  retention_until?: Date | string;
}

export interface TelemetryQueryOptions {
  orgId: string;
  sourceId?: string;
  metric?: string;
  metrics?: string[];
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
  excludeFrame?: boolean;
  orderBy?: "asc" | "desc";
}

// =============================================================================
// CLIENT
// =============================================================================

// Recycle the client every 15 minutes so keep-alive sockets don't outlive
// Fly Proxy rollovers (PP04 ECONNRESET). Fly recommends 10–20 min.
const CLIENT_TTL_MS = 15 * 60 * 1000;

// HMR-safe singleton holder (Next reloads modules in dev; one client per
// process). A mutable holder so the TTL recycle below can swap the client.
const cache = globalSingleton("clickhouse", () => ({
  client: undefined as ClickHouseClient | undefined,
  createdAt: 0,
  writeClient: undefined as ClickHouseClient | undefined,
  writeCreatedAt: 0,
}));

export function getClient(): ClickHouseClient {
  const now = Date.now();
  const age = now - cache.createdAt;

  if (cache.client && age < CLIENT_TTL_MS) {
    return cache.client;
  }

  cache.client?.close().catch(() => {});

  const url = process.env.PLEXUS_CLICKHOUSE_URL;
  if (!url) {
    throw new Error("PLEXUS_CLICKHOUSE_URL environment variable is required");
  }

  cache.client = createClient({
    url,
    username: process.env.PLEXUS_CLICKHOUSE_USER || "plexus",
    password: process.env.PLEXUS_CLICKHOUSE_PASSWORD || "",
    database: process.env.PLEXUS_CLICKHOUSE_DATABASE || "plexus",
    request_timeout: 30000,
    ...(url.startsWith("https://")
      ? {
          http_agent: new https.Agent({
            keepAlive: true,
            rejectUnauthorized: false,
          }),
        }
      : {}),
  });
  cache.createdAt = now;

  return cache.client;
}

/**
 * Client for delete/mutation paths. Uses PLEXUS_CLICKHOUSE_WRITER_USER /
 * PLEXUS_CLICKHOUSE_WRITER_PASSWORD (a credential with SELECT + ALTER DELETE)
 * when set, falling back to the default (read) credential. Read/query paths
 * must keep using getClient() so they never hold delete rights.
 */
function getWriteClient(): ClickHouseClient {
  const writerUser = process.env.PLEXUS_CLICKHOUSE_WRITER_USER;
  if (!writerUser) return getClient();

  const now = Date.now();
  if (cache.writeClient && now - cache.writeCreatedAt < CLIENT_TTL_MS) {
    return cache.writeClient;
  }

  cache.writeClient?.close().catch(() => {});

  const url = process.env.PLEXUS_CLICKHOUSE_URL;
  if (!url) {
    throw new Error("PLEXUS_CLICKHOUSE_URL environment variable is required");
  }

  cache.writeClient = createClient({
    url,
    username: writerUser,
    password: process.env.PLEXUS_CLICKHOUSE_WRITER_PASSWORD || "",
    database: process.env.PLEXUS_CLICKHOUSE_DATABASE || "plexus",
    request_timeout: 30000,
    ...(url.startsWith("https://")
      ? {
          http_agent: new https.Agent({
            keepAlive: true,
            rejectUnauthorized: false,
          }),
        }
      : {}),
  });
  cache.writeCreatedAt = now;

  return cache.writeClient;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Format a Date for ClickHouse DateTime64 parameters.
 * Must use space-separated format (not ISO 'T') for parameterized queries.
 * ClickHouse's HTTP parameter parser requires 'YYYY-MM-DD HH:MM:SS.sss'.
 */
function toClickHouseDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Format a Date for ClickHouse DateTime (second precision, no milliseconds).
 * Production retention_until column is DateTime, not DateTime64.
 */
function fromClickHouseDateTime(ts: Date | string): string {
  if (ts instanceof Date) return ts.toISOString();
  return ts.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(ts)
    ? ts.replace(" ", "T")
    : ts.replace(" ", "T") + "Z";
}

function toClickHouseDateTimeSec(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace("T", " ");
}

// =============================================================================
// SCHEMA
// =============================================================================

/**
 * Columns safe to SELECT from the production `plexus.telemetry` table.
 *
 * Production schema (see clickhouse/server/schema.sql) does NOT have
 * `value_string`, `value_json`, `retention_until`, `id`, or
 * `_inserted_at`. Querying for them returns "Unknown identifier" which
 * the surrounding try/catch swallows into an empty result, which is
 * exactly the "query executed successfully but returned no data" bug
 * that was breaking every chart.
 *
 * Keep this list aligned with what the loader actually writes
 * (loader.py CH_COLUMNS) and the prod `CREATE TABLE`. The loader is the
 * only telemetry writer — this module never CREATEs or INSERTs into the
 * telemetry table (a legacy dev-only DDL/insert path was removed).
 */
const QUERYABLE_COLUMNS = [
  "org_id",
  "source_id",
  "metric",
  "value",
  "timestamp",
  "tags",
];

// =============================================================================
// QUERY OPERATIONS
// =============================================================================

/**
 * Query telemetry data for an organization
 */
export async function queryTelemetry(
  options: TelemetryQueryOptions,
): Promise<TelemetryRow[]> {
  const client = getClient();
  const {
    orgId,
    sourceId,
    metric,
    metrics,
    startTime,
    endTime,
    limit = 10000,
    offset = 0,
    excludeFrame = false,
    orderBy = "asc",
  } = options;

  const conditions: string[] = ["org_id = {orgId:String}"];
  const params: Record<string, unknown> = { orgId, limit, offset };

  if (sourceId) {
    conditions.push("source_id = {sourceId:String}");
    params.sourceId = sourceId;
  }

  if (excludeFrame) {
    conditions.push("metric != '_frame'");
  }

  if (metrics && metrics.length > 0) {
    conditions.push("metric IN {metrics:Array(String)}");
    params.metrics = metrics;
  } else if (metric) {
    conditions.push("metric = {metric:String}");
    params.metric = metric;
  }

  if (startTime) {
    conditions.push("timestamp >= {startTime:DateTime64(3, 'UTC')}");
    params.startTime = toClickHouseDateTime(startTime);
  }

  if (endTime) {
    conditions.push("timestamp <= {endTime:DateTime64(3, 'UTC')}");
    params.endTime = toClickHouseDateTime(endTime);
  }

  const order = orderBy === "desc" ? "DESC" : "ASC";
  // When the window holds more rows than `limit`, the NEWEST rows must
  // survive. A plain ascending LIMIT returns the oldest slice of the
  // window, which starves live panels on dense metrics as history grows
  // (the shared-page "No data" bug, 2026-06-12). Select newest-first
  // inside the limit, then present in the caller's requested order —
  // `desc` callers (e.g. rows-table pagination) see identical results.
  const query = `
    SELECT * FROM (
      SELECT ${QUERYABLE_COLUMNS.join(", ")}
      FROM telemetry
      WHERE ${conditions.join(" AND ")}
      ORDER BY timestamp DESC
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
    )
    ORDER BY timestamp ${order}
  `;

  try {
    const result = await client.query({
      query,
      query_params: params,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as TelemetryRow[];
    return rows;
  } catch (error) {
    console.error("[ClickHouse] Query error:", error);
    return [];
  }
}

/**
 * Count telemetry rows matching the given filters (excludes _frame rows).
 * Lightweight query that doesn't fetch actual data — used for accurate totals.
 */
export async function countTelemetry(
  options: Omit<TelemetryQueryOptions, "limit">,
): Promise<number> {
  const client = getClient();
  const { orgId, sourceId, startTime, endTime, metric, metrics } = options;

  const conditions: string[] = [
    "org_id = {orgId:String}",
    "metric != '_frame'",
  ];
  const params: Record<string, unknown> = { orgId };

  if (sourceId) {
    conditions.push("source_id = {sourceId:String}");
    params.sourceId = sourceId;
  }

  if (metrics && metrics.length > 0) {
    conditions.push("metric IN {metrics:Array(String)}");
    params.metrics = metrics;
  } else if (metric) {
    conditions.push("metric = {metric:String}");
    params.metric = metric;
  }

  if (startTime) {
    conditions.push("timestamp >= {startTime:DateTime64(3, 'UTC')}");
    params.startTime = toClickHouseDateTime(startTime);
  }

  if (endTime) {
    conditions.push("timestamp <= {endTime:DateTime64(3, 'UTC')}");
    params.endTime = toClickHouseDateTime(endTime);
  }

  try {
    const result = await client.query({
      query: `SELECT count() as cnt FROM telemetry WHERE ${conditions.join(" AND ")}`,
      query_params: params,
      format: "JSONEachRow",
    });
    const rows = await result.json<{ cnt: string }>();
    return rows.length > 0 ? Number(rows[0].cnt) : 0;
  } catch (error) {
    console.error("[ClickHouse] Count error:", error);
    return 0;
  }
}

/**
 * Get distinct metrics for a source
 */
export async function getSourceMetrics(
  orgId: string,
  sourceId: string,
): Promise<string[]> {
  const client = getClient();

  try {
    const result = await client.query({
      query: `
        SELECT DISTINCT metric
        FROM telemetry
        WHERE org_id = {orgId:String} AND source_id = {sourceId:String}
        ORDER BY metric
        LIMIT 1000
      `,
      query_params: { orgId, sourceId },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as { metric: string }[];
    return rows.map((r) => r.metric);
  } catch (error) {
    console.error("[ClickHouse] getSourceMetrics error:", error);
    return [];
  }
}

/**
 * Get metrics for all sources in an org in a single query (avoids N+1).
 * Returns a Map of sourceId -> metric names.
 */
export async function getAllSourceMetrics(
  orgId: string,
): Promise<Map<string, string[]>> {
  const client = getClient();

  try {
    const result = await client.query({
      // Read from the 1-min rollup, not raw telemetry: it carries the same
      // (org_id, source_id, metric) tuples in the same sort order, so the
      // DISTINCT is index-friendly and scans orders of magnitude fewer rows.
      // 7 days is well inside the rollup's 90-day TTL. (DISTINCT across
      // unmerged AggregatingMergeTree parts is correct without FINAL.)
      query: `
        SELECT source_id, groupArray(metric) AS metrics
        FROM (
          SELECT DISTINCT source_id, metric
          FROM telemetry_1min
          WHERE org_id = {orgId:String}
            AND ts_min >= now() - INTERVAL 7 DAY
          ORDER BY source_id, metric
        )
        GROUP BY source_id
      `,
      query_params: { orgId },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as {
      source_id: string;
      metrics: string[];
    }[];
    const map = new Map<string, string[]>();
    for (const row of rows) {
      map.set(row.source_id, row.metrics);
    }
    return map;
  } catch (error) {
    console.error("[ClickHouse] getAllSourceMetrics error:", error);
    return new Map();
  }
}

// =============================================================================
// RETENTION & USAGE
// =============================================================================

export interface RetentionInfo {
  totalRows: number;
  oldestData: string | null;
  newestData: string | null;
  earliestExpiration: string | null;
  expiringIn48Hours: number;
}

/**
 * Get retention info for an organization
 */
export async function getRetentionInfo(orgId: string): Promise<RetentionInfo> {
  const client = getClient();

  try {
    const result = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(timestamp) as oldest_data,
          max(timestamp) as newest_data,
          toString(min(timestamp) + INTERVAL ${RETENTION.rawTelemetryDays} DAY) as earliest_expiration,
          countIf(timestamp + INTERVAL ${RETENTION.rawTelemetryDays} DAY <= now() + INTERVAL 48 HOUR) as expiring_48h
        FROM telemetry
        WHERE org_id = {orgId:String}
      `,
      query_params: { orgId },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      total_rows: string;
      oldest_data: string | null;
      newest_data: string | null;
      earliest_expiration: string | null;
      expiring_48h: string;
    }>;

    const row = rows[0];
    return {
      totalRows: parseInt(row?.total_rows || "0"),
      oldestData: row?.oldest_data || null,
      newestData: row?.newest_data || null,
      earliestExpiration: row?.earliest_expiration || null,
      expiringIn48Hours: parseInt(row?.expiring_48h || "0"),
    };
  } catch (error) {
    console.error("[ClickHouse] getRetentionInfo error:", error);
    return {
      totalRows: 0,
      oldestData: null,
      newestData: null,
      earliestExpiration: null,
      expiringIn48Hours: 0,
    };
  }
}

export interface UsageInfo {
  /** Total billable rows (metrics + logs). Kept for back-compat; new
   * callers should prefer the per-category fields below. */
  dataPointsThisMonth: number;
  bytesThisMonth: number;
  /** Metric-class rows in `plexus.telemetry`. */
  metricsThisMonth: number;
  /** Log/event-class rows. Currently 0: the loader drops non-metric
   * points before insert (clickhouse/loader/loader.py:331). When the
   * schema migration adds a persisted `class` column we'll populate
   * this from `count() WHERE class = 'log'`. */
  logsThisMonth: number;
  /** Hours of streamed video relayed this month. Currently 0: the
   * gateway relays frames live but doesn't record session durations.
   * Hooks up to a future `plexus.video_sessions` table. */
  videoHoursThisMonth: number;
}

/**
 * Billable usage for an org over a window.
 *
 * Metrics and logs (events) are billed separately ($/M each) and queried
 * in parallel:
 *   - Metrics: `telemetry` table, filtered by `timestamp`. Production schema
 *     lacks `_loaded_at`, so `timestamp` is the only option.
 *   - Logs: `events` table, filtered by `_loaded_at` (wall-clock at insert;
 *     can't be backfilled unlike the device-reported `timestamp`).
 *
 * Defaults to month-to-date if `from`/`to` are omitted (matches the UI
 * "this month" display). Pass an explicit window for Stripe usage records
 * tied to a subscription period.
 */
export async function getUsageInfo(
  orgId: string,
  options?: { from?: Date; to?: Date },
): Promise<UsageInfo> {
  const client = getClient();

  const fromIso = options?.from
    ?.toISOString()
    .replace("T", " ")
    .replace("Z", "");
  const toIso = options?.to?.toISOString().replace("T", " ").replace("Z", "");

  // --- metrics query ---
  // The default month-to-date path (no explicit window) is the dashboard hot
  // path. It's always minute-aligned and inside the 1-min rollup's 90-day TTL,
  // so we read it from telemetry_1min: sum(count_value) equals the exact base
  // count() (counts are additive over the MV's per-block aggregation) while
  // scanning thousands of rows instead of millions. Explicit Stripe windows
  // fall back to the raw table for sub-minute precision and >90-day periods.
  const useMetricRollup = !fromIso && !toIso;
  const metricTable = useMetricRollup ? "telemetry_1min" : "telemetry";
  const metricCountExpr = useMetricRollup ? "sum(count_value)" : "count()";
  const metricConditions: string[] = [
    "org_id = {orgId:String}",
    "metric != '_frame'",
  ];
  const metricParams: Record<string, unknown> = { orgId };
  if (fromIso) {
    metricConditions.push("timestamp >= {from:DateTime64(3, 'UTC')}");
    metricParams.from = fromIso;
  } else {
    metricConditions.push("ts_min >= toStartOfMonth(now())");
  }
  if (toIso) {
    metricConditions.push("timestamp < {to:DateTime64(3, 'UTC')}");
    metricParams.to = toIso;
  }

  // --- events query (events table, uses _loaded_at for billing correctness) ---
  const eventConditions: string[] = ["org_id = {orgId:String}"];
  const eventParams: Record<string, unknown> = { orgId };
  if (fromIso) {
    eventConditions.push("_loaded_at >= {from:DateTime64(3, 'UTC')}");
    eventParams.from = fromIso;
  } else {
    eventConditions.push("_loaded_at >= toStartOfMonth(now())");
  }
  if (toIso) {
    eventConditions.push("_loaded_at < {to:DateTime64(3, 'UTC')}");
    eventParams.to = toIso;
  }

  const videoConditions: string[] = ["org_id = {orgId:String}"];
  const videoParams: Record<string, unknown> = { orgId };
  if (fromIso) {
    videoConditions.push("started_at >= {from:DateTime64(3, 'UTC')}");
    videoParams.from = fromIso;
  } else {
    videoConditions.push("started_at >= toStartOfMonth(now())");
  }
  if (toIso) {
    videoConditions.push("started_at < {to:DateTime64(3, 'UTC')}");
    videoParams.to = toIso;
  }

  try {
    const [metricsResult, eventsResult, videoResult] = await Promise.all([
      client.query({
        query: `SELECT ${metricCountExpr} as cnt FROM ${metricTable} WHERE ${metricConditions.join(" AND ")}`,
        query_params: metricParams,
        format: "JSONEachRow",
      }),
      client.query({
        query: `SELECT count() as cnt FROM events WHERE ${eventConditions.join(" AND ")}`,
        query_params: eventParams,
        format: "JSONEachRow",
      }),
      client.query({
        query: `SELECT sum(duration_s * camera_count) / 3600.0 AS hours FROM video_sessions_dist WHERE ${videoConditions.join(" AND ")}`,
        query_params: videoParams,
        format: "JSONEachRow",
      }),
    ]);

    const [metricRows, eventRows, videoRows] = await Promise.all([
      metricsResult.json<{ cnt: string }>(),
      eventsResult.json<{ cnt: string }>(),
      videoResult.json<{ hours: number }>(),
    ]);

    const metricsThisMonth = parseInt(metricRows[0]?.cnt || "0");
    const logsThisMonth = parseInt(eventRows[0]?.cnt || "0");
    const videoHoursThisMonth = videoRows[0]?.hours ?? 0;
    return {
      dataPointsThisMonth: metricsThisMonth + logsThisMonth,
      bytesThisMonth: 0,
      metricsThisMonth,
      logsThisMonth,
      videoHoursThisMonth,
    };
  } catch (error) {
    console.error("[ClickHouse] getUsageInfo error:", error);
    return {
      dataPointsThisMonth: 0,
      bytesThisMonth: 0,
      metricsThisMonth: 0,
      logsThisMonth: 0,
      videoHoursThisMonth: 0,
    };
  }
}

/**
 * Get metric percentiles for smart alert suggestions.
 */
export async function getMetricPercentiles(
  orgId: string,
  sourceId: string,
  metric: string,
  days = 7,
): Promise<{
  p1: number;
  p5: number;
  p50: number;
  p95: number;
  p99: number;
} | null> {
  const client = getClient();

  try {
    const result = await client.query({
      query: `
        SELECT
          quantile(0.01)(value) as p1,
          quantile(0.05)(value) as p5,
          quantile(0.50)(value) as p50,
          quantile(0.95)(value) as p95,
          quantile(0.99)(value) as p99
        FROM telemetry
        WHERE org_id = {orgId:String}
          AND source_id = {sourceId:String}
          AND metric = {metric:String}
          AND timestamp >= now() - INTERVAL {days:UInt32} DAY
      `,
      query_params: { orgId, sourceId, metric, days },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      p1: string;
      p5: string;
      p50: string;
      p95: string;
      p99: string;
    }>;

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      p1: parseFloat(r.p1),
      p5: parseFloat(r.p5),
      p50: parseFloat(r.p50),
      p95: parseFloat(r.p95),
      p99: parseFloat(r.p99),
    };
  } catch (error) {
    console.error("[ClickHouse] getMetricPercentiles error:", error);
    return null;
  }
}

/**
 * Get the latest metric value per source×metric in a single batch query.
 * Uses argMax(value, timestamp) to efficiently fetch the most recent reading.
 */
export async function getLatestMetricsBySource(
  orgId: string,
  sourceIds: string[],
  days = 7,
): Promise<
  Record<string, Record<string, { value: number; timestamp: string }>>
> {
  if (sourceIds.length === 0) return {};

  const client = getClient();

  try {
    const result = await client.query({
      query: `
        SELECT
          source_id,
          metric,
          argMax(value, timestamp) as latest_value,
          max(timestamp) as latest_timestamp
        FROM telemetry
        WHERE org_id = {orgId:String}
          AND source_id IN {sourceIds:Array(String)}
          AND timestamp >= now() - INTERVAL {days:UInt32} DAY
        GROUP BY source_id, metric
        ORDER BY source_id, metric
      `,
      query_params: { orgId, sourceIds, days },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      source_id: string;
      metric: string;
      latest_value: string;
      latest_timestamp: string;
    }>;

    const grouped: Record<
      string,
      Record<string, { value: number; timestamp: string }>
    > = {};
    for (const row of rows) {
      if (!grouped[row.source_id]) {
        grouped[row.source_id] = {};
      }
      grouped[row.source_id][row.metric] = {
        value: parseFloat(row.latest_value),
        timestamp: fromClickHouseDateTime(row.latest_timestamp),
      };
    }

    return grouped;
  } catch (error) {
    console.error("[ClickHouse] getLatestMetricsBySource error:", error);
    return {};
  }
}

/**
 * Latest data timestamp per source across ALL orgs, straight from the telemetry
 * table — the real "is this stream alive" signal. source_id is the device slug
 * (same convention as queryFleetHealth). Used by the last-seen reconciler
 * (lib/alerts/reconcile-last-seen.ts), which writes sources.last_seen_at —
 * nothing else does, so without it the offline detector and UI status are blind.
 *
 * Scans all orgs in one query (the offline loop runs service-role, org-agnostic).
 * Sources silent longer than lookbackDays drop out and simply stop being
 * refreshed; their last_seen_at stays frozen at the last value we wrote.
 */
export async function getLatestDataPerSource(
  lookbackDays = 7,
): Promise<Array<{ org_id: string; source_id: string; last_data_at: string }>> {
  const client = getClient();

  try {
    const result = await client.query({
      query: `
        SELECT
          org_id,
          source_id,
          max(timestamp) AS last_data_at
        FROM telemetry
        WHERE timestamp >= now() - INTERVAL {lookbackDays:UInt32} DAY
        GROUP BY org_id, source_id
      `,
      query_params: { lookbackDays },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      org_id: string;
      source_id: string;
      last_data_at: string;
    }>;

    return rows.map((r) => ({
      org_id: r.org_id,
      source_id: r.source_id,
      last_data_at: fromClickHouseDateTime(r.last_data_at),
    }));
  } catch (error) {
    console.error("[ClickHouse] getLatestDataPerSource error:", error);
    return [];
  }
}

/**
 * Force cleanup of expired data (normally handled by TTL)
 * Call this periodically if TTL isn't triggering fast enough
 */
/**
 * Delete all telemetry for specific sources (lightweight delete)
 */
export async function deleteTelemetryForSources(
  orgId: string,
  sourceIds: string[],
): Promise<void> {
  if (sourceIds.length === 0) return;
  const client = getWriteClient();
  await client.command({
    query: `ALTER TABLE telemetry DELETE WHERE org_id = {orgId:String} AND source_id IN {sourceIds:Array(String)}`,
    query_params: { orgId, sourceIds },
  });
}

/**
 * Get per-source data summary (row counts + frame counts) for data management
 */
export async function getDataSummaryBySource(
  orgId: string,
): Promise<
  Array<{ source_id: string; row_count: number; frame_count: number }>
> {
  const client = getClient();
  const result = await client.query({
    query: `SELECT source_id, count() as row_count, countIf(metric = '_frame') as frame_count FROM telemetry WHERE org_id = {orgId:String} GROUP BY source_id ORDER BY row_count DESC`,
    query_params: { orgId },
    format: "JSONEachRow",
  });
  const rows = await result.json<{
    source_id: string;
    row_count: string;
    frame_count: string;
  }>();
  return rows.map((r) => ({
    source_id: r.source_id,
    row_count: Number(r.row_count),
    frame_count: Number(r.frame_count),
  }));
}

/**
 * Delete telemetry by filter (excludes _frame rows — use deleteFrameRows for those)
 */
export async function deleteTelemetryByFilter(
  orgId: string,
  sourceIds: string[],
  options?: { startTime?: Date; endTime?: Date },
): Promise<void> {
  if (sourceIds.length === 0) return;
  const client = getWriteClient();
  let query = `ALTER TABLE telemetry DELETE WHERE org_id = {orgId:String} AND source_id IN {sourceIds:Array(String)} AND metric != '_frame'`;
  const params: Record<string, unknown> = { orgId, sourceIds };
  if (options?.startTime) {
    query += ` AND timestamp >= {startTime:DateTime64(3)}`;
    params.startTime = options.startTime.toISOString();
  }
  if (options?.endTime) {
    query += ` AND timestamp <= {endTime:DateTime64(3)}`;
    params.endTime = options.endTime.toISOString();
  }
  await client.command({ query, query_params: params });
}

/**
 * Delete _frame rows from ClickHouse by filter
 */
export async function deleteFrameRows(
  orgId: string,
  sourceIds: string[],
  options?: { startTime?: Date; endTime?: Date },
): Promise<void> {
  if (sourceIds.length === 0) return;
  const client = getWriteClient();
  let query = `ALTER TABLE telemetry DELETE WHERE org_id = {orgId:String} AND metric = '_frame' AND source_id IN {sourceIds:Array(String)}`;
  const params: Record<string, unknown> = { orgId, sourceIds };
  if (options?.startTime) {
    query += ` AND timestamp >= {startTime:DateTime64(3)}`;
    params.startTime = options.startTime.toISOString();
  }
  if (options?.endTime) {
    query += ` AND timestamp <= {endTime:DateTime64(3)}`;
    params.endTime = options.endTime.toISOString();
  }
  await client.command({ query, query_params: params });
}

/**
 * Fleet health query — aggregates metrics in ClickHouse via GROUP BY
 * instead of fetching 50K rows and aggregating in JavaScript.
 */
export async function queryFleetHealth(
  orgId: string,
  metrics: string[],
  windowMs: number = HOUR_MS,
): Promise<
  Array<{
    source_id: string;
    metric: string;
    point_count: number;
    avg_value: number;
    min_value: number;
    max_value: number;
    last_value: number;
    last_data_at: string;
  }>
> {
  const client = getClient();
  const startTime = new Date(Date.now() - windowMs);

  try {
    const result = await client.query({
      query: `
        SELECT
          source_id,
          metric,
          count() AS point_count,
          avg(value) AS avg_value,
          min(value) AS min_value,
          max(value) AS max_value,
          argMax(value, timestamp) AS last_value,
          max(timestamp) AS last_data_at
        FROM telemetry
        WHERE org_id = {orgId:String}
          AND metric IN {metrics:Array(String)}
          AND timestamp >= {startTime:DateTime64(3, 'UTC')}
        GROUP BY source_id, metric
        ORDER BY source_id, metric
      `,
      query_params: {
        orgId,
        metrics,
        startTime: toClickHouseDateTime(startTime),
      },
      format: "JSONEachRow",
    });

    return (await result.json()) as Array<{
      source_id: string;
      metric: string;
      point_count: number;
      avg_value: number;
      min_value: number;
      max_value: number;
      last_value: number;
      last_data_at: string;
    }>;
  } catch (error) {
    console.error("[ClickHouse] Fleet health query error:", error);
    return [];
  }
}

/**
 * Ensure hourly rollup materialized view exists.
 * Call during app startup or migration.
 */
export async function ensureHourlyRollup(): Promise<void> {
  const client = getClient();

  try {
    // Create target table for hourly aggregates
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS telemetry_hourly (
          org_id String,
          source_id String,
          metric String,
          hour DateTime,
          point_count UInt64,
          avg_value Float64,
          min_value Float64,
          max_value Float64,
          sum_value Float64,
          stddev_value Float64
        )
        ENGINE = SummingMergeTree()
        PARTITION BY (org_id, toYYYYMM(hour))
        ORDER BY (org_id, source_id, metric, hour)
      `,
    });

    // Create materialized view that populates the rollup
    await client.command({
      query: `
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_telemetry_hourly
        TO telemetry_hourly
        AS SELECT
          org_id,
          source_id,
          metric,
          toStartOfHour(timestamp) AS hour,
          count() AS point_count,
          avg(value) AS avg_value,
          min(value) AS min_value,
          max(value) AS max_value,
          sum(value) AS bucket_sum,
          stddevPop(value) AS stddev_value
        FROM telemetry
        GROUP BY org_id, source_id, metric, hour
      `,
    });

    console.log("[ClickHouse] Hourly rollup materialized view ensured");
  } catch (error) {
    console.error("[ClickHouse] Failed to create hourly rollup:", error);
  }
}

/**
 * Query hourly rollup for efficient long-range queries.
 * Falls back to raw telemetry if rollup table doesn't exist.
 */
export async function queryHourlyRollup(
  orgId: string,
  sourceId: string,
  metric: string,
  startTime: Date,
  endTime: Date,
): Promise<
  Array<{
    hour: string;
    point_count: number | string;
    avg_value: number;
    min_value: number;
    max_value: number;
    bucket_sum: number | string;
  }>
> {
  const client = getClient();

  try {
    const result = await client.query({
      query: `
        SELECT
          toString(ts_hour) AS hour,
          sum(count_value) AS point_count,
          sum(sum_value) / sum(count_value) AS avg_value,
          min(min_value) AS min_value,
          max(max_value) AS max_value,
          sum(sum_value) AS bucket_sum
        FROM telemetry_1hr FINAL
        WHERE org_id = {orgId:String}
          AND source_id = {sourceId:String}
          AND metric = {metric:String}
          AND ts_hour >= {startTime:DateTime}
          AND ts_hour <= {endTime:DateTime}
        GROUP BY ts_hour
        ORDER BY ts_hour ASC
      `,
      query_params: {
        orgId,
        sourceId,
        metric,
        startTime: toClickHouseDateTimeSec(startTime),
        endTime: toClickHouseDateTimeSec(endTime),
      },
      format: "JSONEachRow",
    });

    return (await result.json()) as Array<{
      hour: string;
      point_count: number | string;
      avg_value: number;
      min_value: number;
      max_value: number;
      bucket_sum: number | string;
    }>;
  } catch (error) {
    // Rollup table might not exist yet — not a fatal error
    console.warn(
      "[ClickHouse] Hourly rollup query failed (table may not exist):",
      error,
    );
    return [];
  }
}

// =============================================================================
// MINUTE ROLLUP
// =============================================================================

/**
 * Ensure 1-minute rollup materialized view exists.
 * Bridges the gap between raw data (≤1h) and hourly rollups (>24h).
 */
export async function ensureMinuteRollup(): Promise<void> {
  const client = getClient();

  try {
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS telemetry_1m (
          org_id String,
          source_id String,
          metric String,
          minute DateTime,
          point_count UInt64,
          avg_value Float64,
          min_value Float64,
          max_value Float64
        )
        ENGINE = SummingMergeTree()
        PARTITION BY (org_id, toYYYYMM(minute))
        ORDER BY (org_id, source_id, metric, minute)
      `,
    });

    await client.command({
      query: `
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_telemetry_1m
        TO telemetry_1m
        AS SELECT
          org_id,
          source_id,
          metric,
          toStartOfMinute(timestamp) AS minute,
          count() AS point_count,
          avg(value) AS avg_value,
          min(value) AS min_value,
          max(value) AS max_value
        FROM telemetry
        GROUP BY org_id, source_id, metric, minute
      `,
    });

    console.log("[ClickHouse] Minute rollup materialized view ensured");
  } catch (error) {
    console.error("[ClickHouse] Failed to create minute rollup:", error);
  }
}

/**
 * Query 1-minute rollup table.
 */
export async function queryMinuteRollup(
  orgId: string,
  sourceId: string,
  metric: string,
  startTime: Date,
  endTime: Date,
): Promise<
  Array<{
    minute: string;
    point_count: number | string;
    avg_value: number;
    min_value: number;
    max_value: number;
    bucket_sum: number | string;
  }>
> {
  const client = getClient();

  try {
    // Production rollup is `plexus.telemetry_1min` (materialized view over
    // `plexus.telemetry`) with AggregatingMergeTree columns. avg is derived
    // as sum_value/count_value; "minute" is aliased from ts_min.
    const result = await client.query({
      query: `
        SELECT
          toString(ts_min) AS minute,
          sum(count_value) AS point_count,
          sum(sum_value) / sum(count_value) AS avg_value,
          min(min_value) AS min_value,
          max(max_value) AS max_value,
          sum(sum_value) AS bucket_sum
        FROM telemetry_1min FINAL
        WHERE org_id = {orgId:String}
          AND source_id = {sourceId:String}
          AND metric = {metric:String}
          AND ts_min >= {startTime:DateTime}
          AND ts_min <= {endTime:DateTime}
        GROUP BY ts_min
        ORDER BY ts_min ASC
      `,
      query_params: {
        orgId,
        sourceId,
        metric,
        startTime: toClickHouseDateTimeSec(startTime),
        endTime: toClickHouseDateTimeSec(endTime),
      },
      format: "JSONEachRow",
    });

    return (await result.json()) as Array<{
      minute: string;
      point_count: number | string;
      avg_value: number;
      min_value: number;
      max_value: number;
      bucket_sum: number | string;
    }>;
  } catch (error) {
    console.warn(
      "[ClickHouse] Minute rollup query failed (table may not exist):",
      error,
    );
    return [];
  }
}

// =============================================================================
// ENSURE ALL ROLLUPS
// =============================================================================

/**
 * Ensure all rollup tables and materialized views exist.
 * Safe to call multiple times — uses IF NOT EXISTS internally.
 */
export async function ensureAllRollups(): Promise<void> {
  await Promise.all([ensureHourlyRollup(), ensureMinuteRollup()]);
}

// =============================================================================
// ADAPTIVE QUERY
// =============================================================================

export type ResolutionLevel = "raw" | "downsampled" | "1m" | "1h";

export interface AdaptivePoint {
  timestamp: string;
  /** Representative value for display: the raw value (raw tier) or the bucket AVERAGE (downsampled tiers). */
  value: number;
  min?: number;
  max?: number;
  /** Sum of raw values inside this point's bucket (raw tier: the value itself). Lets consumers compute tier-independent totals for counter metrics — Σ(bucket avgs) counts buckets, not events. */
  sum?: number;
  /** Number of raw events inside this point's bucket (raw tier: 1). */
  count?: number;
}

/** ClickHouse JSONEachRow returns UInt64 (and sometimes Float64) as strings — coerce defensively. */
function chNumber(v: number | string): number {
  return typeof v === "string" ? parseFloat(v) : v;
}

export interface AdaptiveQueryResult {
  points: AdaptivePoint[];
  resolution: ResolutionLevel;
}

/**
 * Auto-selects resolution based on time range:
 *   ≤ 1h        → raw telemetry
 *   > 1h, ≤ 6h  → query-time downsample (GROUP BY toStartOfInterval)
 *   > 6h, ≤ 24h → telemetry_1m (1-minute rollup)
 *   > 24h       → telemetry_hourly (hourly rollup)
 */
export async function queryTelemetryAdaptive(
  orgId: string,
  sourceId: string,
  metric: string,
  startTime: Date,
  endTime: Date,
  limit = 100000,
): Promise<AdaptiveQueryResult> {
  const timeRangeMs = endTime.getTime() - startTime.getTime();

  const ONE_HOUR = 3600_000;
  const SIX_HOURS = 6 * ONE_HOUR;
  const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;

  // ≤ 1h → raw
  if (timeRangeMs <= ONE_HOUR) {
    const rows = await queryTelemetry({
      orgId,
      sourceId,
      metric,
      startTime,
      endTime,
      limit,
    });

    return {
      resolution: "raw",
      points: rows.map((r) => ({
        timestamp: fromClickHouseDateTime(r.timestamp),
        value: r.value,
        sum: r.value,
        count: 1,
      })),
    };
  }

  // > 1h, ≤ 6h → query-time downsample
  if (timeRangeMs <= SIX_HOURS) {
    const intervalSeconds = Math.ceil(timeRangeMs / (2000 * 1000));
    const client = getClient();

    try {
      const result = await client.query({
        query: `
          SELECT
            toStartOfInterval(timestamp, INTERVAL ${intervalSeconds} SECOND) AS ts,
            avg(value) AS avg_value,
            min(value) AS min_value,
            max(value) AS max_value,
            sum(value) AS bucket_sum,
            count() AS cnt
          FROM telemetry
          WHERE org_id = {orgId:String}
            AND source_id = {sourceId:String}
            AND metric = {metric:String}
            AND timestamp >= {startTime:DateTime64(3, 'UTC')}
            AND timestamp <= {endTime:DateTime64(3, 'UTC')}
          GROUP BY ts
          ORDER BY ts ASC
        `,
        query_params: {
          orgId,
          sourceId,
          metric,
          startTime: toClickHouseDateTime(startTime),
          endTime: toClickHouseDateTime(endTime),
        },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<{
        ts: string;
        avg_value: number;
        min_value: number;
        max_value: number;
        bucket_sum: number | string;
        cnt: number | string;
      }>;

      return {
        resolution: "downsampled",
        points: rows.map((r) => ({
          timestamp: fromClickHouseDateTime(r.ts),
          value:
            typeof r.avg_value === "string"
              ? parseFloat(r.avg_value)
              : r.avg_value,
          min:
            typeof r.min_value === "string"
              ? parseFloat(r.min_value)
              : r.min_value,
          max:
            typeof r.max_value === "string"
              ? parseFloat(r.max_value)
              : r.max_value,
          sum: chNumber(r.bucket_sum),
          count: chNumber(r.cnt),
        })),
      };
    } catch (error) {
      console.error("[ClickHouse] Adaptive downsample query error:", error);
      // Fall back to raw with limit
      const rows = await queryTelemetry({
        orgId,
        sourceId,
        metric,
        startTime,
        endTime,
        limit,
      });
      return {
        resolution: "raw",
        points: rows.map((r) => ({
          timestamp: fromClickHouseDateTime(r.timestamp),
          value: r.value,
          sum: r.value,
          count: 1,
        })),
      };
    }
  }

  // > 6h, ≤ 24h → 1-minute rollup
  if (timeRangeMs <= TWENTY_FOUR_HOURS) {
    const rows = await queryMinuteRollup(
      orgId,
      sourceId,
      metric,
      startTime,
      endTime,
    );

    if (rows.length > 0) {
      return {
        resolution: "1m",
        points: rows.map((r) => ({
          timestamp: fromClickHouseDateTime(r.minute),
          value:
            typeof r.avg_value === "string"
              ? parseFloat(r.avg_value as string)
              : r.avg_value,
          min:
            typeof r.min_value === "string"
              ? parseFloat(r.min_value as string)
              : r.min_value,
          max:
            typeof r.max_value === "string"
              ? parseFloat(r.max_value as string)
              : r.max_value,
          sum: chNumber(r.bucket_sum),
          count: chNumber(r.point_count),
        })),
      };
    }

    // Fallback: minute rollup empty (table new, no backfill), use query-time downsample
    const intervalSeconds = Math.ceil(timeRangeMs / (2000 * 1000));
    const client = getClient();
    try {
      const result = await client.query({
        query: `
          SELECT
            toStartOfInterval(timestamp, INTERVAL ${intervalSeconds} SECOND) AS ts,
            avg(value) AS avg_value,
            min(value) AS min_value,
            max(value) AS max_value
          FROM telemetry
          WHERE org_id = {orgId:String}
            AND source_id = {sourceId:String}
            AND metric = {metric:String}
            AND timestamp >= {startTime:DateTime64(3, 'UTC')}
            AND timestamp <= {endTime:DateTime64(3, 'UTC')}
          GROUP BY ts
          ORDER BY ts ASC
        `,
        query_params: {
          orgId,
          sourceId,
          metric,
          startTime: toClickHouseDateTime(startTime),
          endTime: toClickHouseDateTime(endTime),
        },
        format: "JSONEachRow",
      });

      const fallbackRows = (await result.json()) as Array<{
        ts: string;
        avg_value: number;
        min_value: number;
        max_value: number;
        bucket_sum: number | string;
        cnt: number | string;
      }>;

      return {
        resolution: "downsampled",
        points: fallbackRows.map((r) => ({
          timestamp: fromClickHouseDateTime(r.ts),
          value:
            typeof r.avg_value === "string"
              ? parseFloat(r.avg_value)
              : r.avg_value,
          min:
            typeof r.min_value === "string"
              ? parseFloat(r.min_value)
              : r.min_value,
          max:
            typeof r.max_value === "string"
              ? parseFloat(r.max_value)
              : r.max_value,
          sum: chNumber(r.bucket_sum),
          count: chNumber(r.cnt),
        })),
      };
    } catch {
      return { resolution: "downsampled", points: [] };
    }
  }

  // > 24h → hourly rollup
  const rows = await queryHourlyRollup(
    orgId,
    sourceId,
    metric,
    startTime,
    endTime,
  );

  if (rows.length > 0) {
    return {
      resolution: "1h",
      points: rows.map((r) => ({
        timestamp: fromClickHouseDateTime(r.hour),
        value:
          typeof r.avg_value === "string"
            ? parseFloat(r.avg_value as string)
            : r.avg_value,
        min:
          typeof r.min_value === "string"
            ? parseFloat(r.min_value as string)
            : r.min_value,
        max:
          typeof r.max_value === "string"
            ? parseFloat(r.max_value as string)
            : r.max_value,
        sum: chNumber(r.bucket_sum),
        count: chNumber(r.point_count),
      })),
    };
  }

  // Fallback: hourly rollup empty, use query-time downsample
  const intervalSeconds = Math.ceil(timeRangeMs / (2000 * 1000));
  const client = getClient();
  try {
    const result = await client.query({
      query: `
        SELECT
          toStartOfInterval(timestamp, INTERVAL ${intervalSeconds} SECOND) AS ts,
          avg(value) AS avg_value,
          min(value) AS min_value,
          max(value) AS max_value,
          sum(value) AS bucket_sum,
          count() AS cnt
        FROM telemetry
        WHERE org_id = {orgId:String}
          AND source_id = {sourceId:String}
          AND metric = {metric:String}
          AND timestamp >= {startTime:DateTime64(3, 'UTC')}
          AND timestamp <= {endTime:DateTime64(3, 'UTC')}
        GROUP BY ts
        ORDER BY ts ASC
      `,
      query_params: {
        orgId,
        sourceId,
        metric,
        startTime: toClickHouseDateTime(startTime),
        endTime: toClickHouseDateTime(endTime),
      },
      format: "JSONEachRow",
    });

    const fallbackRows = (await result.json()) as Array<{
      ts: string;
      avg_value: number;
      min_value: number;
      max_value: number;
      bucket_sum: number | string;
      cnt: number | string;
    }>;

    return {
      resolution: "downsampled",
      points: fallbackRows.map((r) => ({
        timestamp: r.ts,
        value:
          typeof r.avg_value === "string"
            ? parseFloat(r.avg_value)
            : r.avg_value,
        min:
          typeof r.min_value === "string"
            ? parseFloat(r.min_value)
            : r.min_value,
        max:
          typeof r.max_value === "string"
            ? parseFloat(r.max_value)
            : r.max_value,
        sum: chNumber(r.bucket_sum),
        count: chNumber(r.cnt),
      })),
    };
  } catch {
    return { resolution: "downsampled", points: [] };
  }
}

// =============================================================================
// OVERVIEW (SCRUBBER) QUERY
// =============================================================================

export interface OverviewBucket {
  /** Bucket start (ISO) */
  t: string;
  /** Exact raw-row count within the bucket across all requested metrics */
  count: number;
}

export interface TelemetryOverviewResult {
  buckets: OverviewBucket[];
  /** Earliest data minute within the window (ISO), null when empty */
  earliest: string | null;
}

/**
 * Ingest-volume histogram for the dashboard scrubber: exact raw-row counts
 * per time bucket, summed across all requested (source, metric) pairs in a
 * single query over the 1-min rollup (sum(count_value) equals the base-table
 * row count). A pair with an empty sourceId matches the metric on any source.
 */
export async function queryTelemetryOverview(
  orgId: string,
  pairs: Array<{ sourceId: string; metric: string }>,
  startTime: Date,
  endTime: Date,
  bucketSeconds: number,
): Promise<TelemetryOverviewResult> {
  if (pairs.length === 0) return { buckets: [], earliest: null };
  const client = getClient();

  const params: Record<string, unknown> = {
    orgId,
    startTime: toClickHouseDateTimeSec(startTime),
    endTime: toClickHouseDateTimeSec(endTime),
  };
  const pairConditions = pairs.map(({ sourceId, metric }, i) => {
    params[`m${i}`] = metric;
    if (!sourceId) return `metric = {m${i}:String}`;
    params[`s${i}`] = sourceId;
    return `(source_id = {s${i}:String} AND metric = {m${i}:String})`;
  });

  try {
    const result = await client.query({
      query: `
        SELECT
          toStartOfInterval(ts_min, INTERVAL ${Math.max(60, Math.round(bucketSeconds))} SECOND) AS bucket,
          sum(count_value) AS c,
          min(ts_min) AS mn
        FROM telemetry_1min
        WHERE org_id = {orgId:String}
          AND ts_min >= {startTime:DateTime}
          AND ts_min <= {endTime:DateTime}
          AND (${pairConditions.join(" OR ")})
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      query_params: params,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      bucket: string;
      c: number | string;
      mn: string;
    }>;

    return {
      buckets: rows.map((r) => ({
        t: fromClickHouseDateTime(r.bucket),
        count: Number(r.c),
      })),
      earliest: rows.length > 0 ? fromClickHouseDateTime(rows[0].mn) : null,
    };
  } catch (error) {
    console.error("[ClickHouse] queryTelemetryOverview error:", error);
    return { buckets: [], earliest: null };
  }
}

// =============================================================================
// EVENTS QUERY
// =============================================================================

export type { DeviceEvent };

export async function queryEvents(
  orgId: string,
  sourceId: string | undefined,
  options: {
    startTime?: Date;
    endTime?: Date;
    name?: string;
    limit?: number;
  } = {},
): Promise<DeviceEvent[]> {
  const client = getClient();
  const { startTime, endTime, name, limit = 500 } = options;

  const conditions = ["org_id = {orgId:String}"];
  const params: Record<string, unknown> = { orgId, limit };

  if (sourceId) {
    conditions.push("source_id = {sourceId:String}");
    params.sourceId = sourceId;
  }

  if (name) {
    conditions.push("name = {name:String}");
    params.name = name;
  }
  if (startTime) {
    conditions.push("timestamp >= {startTime:DateTime64(3, 'UTC')}");
    params.startTime = toClickHouseDateTime(startTime);
  }
  if (endTime) {
    conditions.push("timestamp <= {endTime:DateTime64(3, 'UTC')}");
    params.endTime = toClickHouseDateTime(endTime);
  }

  try {
    const result = await client.query({
      query: `
        SELECT source_id, timestamp, name, body, tags
        FROM events
        WHERE ${conditions.join(" AND ")}
        ORDER BY timestamp DESC
        LIMIT {limit:UInt32}
      `,
      query_params: params,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as DeviceEvent[];
    return rows.map((row) => ({
      ...row,
      timestamp: fromClickHouseDateTime(row.timestamp),
    }));
  } catch {
    return [];
  }
}
