/**
 * SQL query transformation utilities for connection queries.
 *
 * - Variable substitution ($name, ${name}, $__timeFilter())
 * - Condition injection (time range + filters) via CTE wrapping
 */

import type { TimeRange, DataFilter } from "@/lib/types/dashboard";
import type { ConnectionType } from "@/lib/db/types";
import { filtersToSqlConditions } from "@/lib/transforms/sql";
import type { ParameterizedConditions } from "@/lib/transforms/sql";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of injecting conditions into a query.
 */
export interface InjectedQuery {
  /** The SQL string (with $N placeholders for filter values) */
  sql: string;
  /** Ordered parameter values for the placeholders */
  params: unknown[];
}

// =============================================================================
// Time Range Helpers
// =============================================================================

export type SqlDialect = "postgres" | "clickhouse" | "mysql";

/**
 * Resolve the macro/quoting dialect for a connection's real store type. The
 * client must not guess from the source id — a customer's own ClickHouse or
 * MySQL connection needs its own dialect, not Postgres macros. Postgres and
 * TimescaleDB share Postgres syntax; InfluxDB (Flux) and Prometheus (PromQL)
 * don't go through this SQL macro layer, so their default is harmless.
 */
export function dialectForConnectionType(
  type: ConnectionType | null | undefined,
): SqlDialect {
  switch (type) {
    case "clickhouse":
      return "clickhouse";
    case "mysql":
      return "mysql";
    default:
      return "postgres";
  }
}

/**
 * Quote a SQL identifier for the dialect. MySQL's default sql_mode treats
 * double-quoted names as string literals, so it must use backticks; Postgres
 * and ClickHouse both accept double quotes.
 */
function quoteIdent(name: string, dialect: SqlDialect): string {
  if (dialect === "mysql") return "`" + name.replace(/`/g, "``") + "`";
  return '"' + name.replace(/"/g, '""') + '"';
}

/** Parse a relative range like "3m", "45m", "6h", "7d" into (n, unit). */
function parseRelativeRange(
  value: string,
): { n: number; unit: "s" | "m" | "h" | "d" } | null {
  const m = /^(\d+)([smhd])$/.exec(value.trim());
  if (!m) return null;
  return { n: parseInt(m[1], 10), unit: m[2] as "s" | "m" | "h" | "d" };
}

/** Render an INTERVAL expression for the target dialect. */
function renderInterval(
  n: number,
  unit: "s" | "m" | "h" | "d",
  dialect: SqlDialect,
): string {
  if (dialect === "clickhouse" || dialect === "mysql") {
    // ClickHouse and MySQL both use unquoted singular units: INTERVAL 24 HOUR.
    const unitWord = { s: "SECOND", m: "MINUTE", h: "HOUR", d: "DAY" }[unit];
    return `INTERVAL ${n} ${unitWord}`;
  }
  const pgUnit = { s: "seconds", m: "minutes", h: "hours", d: "days" }[unit];
  return `INTERVAL '${n} ${pgUnit}'`;
}

/** Render an INTERVAL for a bucket size in seconds, per dialect. */
function renderBucketInterval(sec: number, dialect: SqlDialect): string {
  if (dialect === "clickhouse" || dialect === "mysql") {
    if (sec % 86400 === 0) return `INTERVAL ${sec / 86400} DAY`;
    if (sec % 3600 === 0) return `INTERVAL ${sec / 3600} HOUR`;
    if (sec % 60 === 0) return `INTERVAL ${sec / 60} MINUTE`;
    return `INTERVAL ${sec} SECOND`;
  }
  return `INTERVAL '${bucketToIntervalLiteral(sec)}'`;
}

/** Truncate a timestamp expression to the start of its bucket, per dialect. */
function renderTimeBucket(
  colExpr: string,
  bucketSec: number,
  dialect: SqlDialect,
): string {
  if (dialect === "clickhouse") {
    return `toStartOfInterval(${colExpr}, ${renderBucketInterval(bucketSec, dialect)})`;
  }
  if (dialect === "mysql") {
    // MySQL has no date_trunc / toStartOfInterval; floor over the unix epoch.
    return `FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(${colExpr}) / ${bucketSec}) * ${bucketSec})`;
  }
  return `to_timestamp(floor(extract(epoch from ${colExpr}) / ${bucketSec}) * ${bucketSec})`;
}

/**
 * Ranges longer than this auto-downsample to a time-bucket aggregate (when the
 * panel declares a value column). Below it, panels keep raw rows — short
 * windows are interactive and users expect individual points there, and the
 * driver row-cap rarely bites. 24h cleanly targets the multi-day / month
 * historical case where raw rows would otherwise be silently clipped.
 */
const AUTO_BUCKET_MIN_RANGE_SECONDS = 24 * 3600;

/** Duration of a time range in seconds, for bucket sizing. */
function getTimeRangeSeconds(timeRange: TimeRange): number {
  if (timeRange.type === "relative") {
    const m = /^(\d+)([smhd])$/.exec(timeRange.value);
    if (!m) return 3600;
    const n = parseInt(m[1], 10);
    const mult = { s: 1, m: 60, h: 3600, d: 86400 }[
      m[2] as "s" | "m" | "h" | "d"
    ];
    return n * mult;
  }
  const [start, end] = timeRange.value.split("/");
  if (!start || !end) return 3600;
  const diff = (Date.parse(end) - Date.parse(start)) / 1000;
  return Number.isFinite(diff) && diff > 0 ? diff : 3600;
}

/** Pick a bucket size (seconds) targeting ~500 points across the range. */
function pickBucketSeconds(rangeSeconds: number): number {
  const target = rangeSeconds / 500;
  const steps = [
    1, 5, 15, 30, 60, 300, 900, 1800, 3600, 7200, 21600, 43200, 86400,
  ];
  for (const s of steps) if (s >= target) return s;
  return 86400;
}

/** Render bucket seconds as a Postgres INTERVAL literal body. */
function bucketToIntervalLiteral(sec: number): string {
  if (sec % 86400 === 0) return `${sec / 86400} days`;
  if (sec % 3600 === 0) return `${sec / 3600} hours`;
  if (sec % 60 === 0) return `${sec / 60} minutes`;
  return `${sec} seconds`;
}

// =============================================================================
// Variable Substitution
// =============================================================================

/**
 * Substitute dashboard variables and $__timeFilter() macro into a SQL query.
 *
 * - $__timeFilter(column_name) → expands to a time range WHERE clause
 * - $variable_name or ${variable_name} → replaced with current value
 * - Longest variable names replaced first to avoid partial matches
 *
 * Returns the processed query and whether the $__timeFilter macro was used
 * (so the caller can skip automatic time injection).
 */
export function substituteVariables(
  query: string,
  variables: Record<string, string>,
  timeRange?: TimeRange,
  dialect: SqlDialect = "postgres",
): { sql: string; hadTimeMacro: boolean; hadTimeGroup: boolean } {
  let result = query;
  let hadTimeMacro = false;
  // The query already aggregates into time buckets itself (builder-emitted
  // count/agg queries). Callers use this to skip the outer auto-bucket wrap
  // in injectConditions — double-bucketing a fixed bucket is silently wrong
  // (e.g. max(count per hour) per day).
  const hadTimeGroup = /\$__timeGroup\(/.test(query);

  // $__text(expr) → dialect-appropriate text cast. Used by the query builder
  // to compare join keys of mismatched types (uuid ↔ text) without hardcoding
  // dialect syntax into stored SQL.
  result = result.replace(/\$__text\(([^)]+)\)/g, (_, expr: string) => {
    const e = expr.trim();
    if (dialect === "clickhouse") return `toString(${e})`;
    if (dialect === "mysql") return `CAST(${e} AS CHAR)`;
    return `(${e})::text`;
  });

  // Replace $__interval and $__timeGroup(col) macros
  // downsampling: pick a bucket size targeting ~500 points over the range.
  const bucketSec = timeRange
    ? pickBucketSeconds(getTimeRangeSeconds(timeRange))
    : 60;
  result = result.replace(
    /\$__interval\b/g,
    renderBucketInterval(bucketSec, dialect),
  );
  result = result.replace(/\$__intervalSeconds\b/g, String(bucketSec));
  result = result.replace(/\$__timeGroup\(([^)]+)\)/g, (_, inner: string) => {
    // Optional fixed-bucket second arg: $__timeGroup(col, 'day').
    // Without it, the bucket auto-sizes from the time range (historical form).
    const fixed = /^(.*?),\s*'(hour|day|week|month)'$/.exec(inner.trim());
    const raw = (fixed ? fixed[1] : inner).trim();
    const col = /^[\w]+$/.test(raw) ? quoteIdent(raw, dialect) : raw;
    if (fixed) {
      const unit = fixed[2];
      if (dialect === "clickhouse") {
        return `toStartOfInterval(${col}, INTERVAL 1 ${unit.toUpperCase()})`;
      }
      if (dialect === "mysql") {
        // MySQL has no date_trunc; truncate per unit with native expressions.
        switch (unit) {
          case "hour":
            return `DATE_FORMAT(${col}, '%Y-%m-%d %H:00:00')`;
          case "day":
            return `DATE_FORMAT(${col}, '%Y-%m-%d 00:00:00')`;
          case "week":
            return `DATE_SUB(DATE(${col}), INTERVAL WEEKDAY(${col}) DAY)`;
          default: // month
            return `DATE_FORMAT(${col}, '%Y-%m-01 00:00:00')`;
        }
      }
      return `date_trunc('${unit}', ${col})`;
    }
    return renderTimeBucket(col, bucketSec, dialect);
  });

  // Replace $__timeFilter(column) macro
  const timeFilterRegex = /\$__timeFilter\(([^)]+)\)/g;
  if (timeFilterRegex.test(result)) {
    hadTimeMacro = true;
    result = result.replace(
      /\$__timeFilter\(([^)]+)\)/g,
      (_, colExpr: string) => {
        const col = /^[\w]+$/.test(colExpr.trim())
          ? quoteIdent(colExpr.trim(), dialect)
          : colExpr.trim();
        if (!timeRange) return "TRUE";
        if (timeRange.type === "relative") {
          const parsed = parseRelativeRange(timeRange.value);
          if (!parsed) return "TRUE";
          return `${col} >= NOW() - ${renderInterval(parsed.n, parsed.unit, dialect)}`;
        }
        const [start, end] = timeRange.value.split("/");
        if (start && end) {
          return `${col} >= '${start}' AND ${col} <= '${end}'`;
        }
        if (start) {
          return `${col} >= '${start}'`;
        }
        return "TRUE";
      },
    );
  }

  // Replace $variable_name and ${variable_name} references
  const sortedNames = Object.keys(variables).sort(
    (a, b) => b.length - a.length,
  );
  for (const name of sortedNames) {
    const value = variables[name];
    const safeValue = value.replace(/'/g, "''");
    result = result.replace(new RegExp(`\\$\\{${name}\\}`, "g"), safeValue);
    result = result.replace(new RegExp(`\\$${name}(?![\\w])`, "g"), safeValue);
  }

  return { sql: result, hadTimeMacro, hadTimeGroup };
}

// =============================================================================
// Condition Injection
// =============================================================================

/**
 * Inject conditions (time range and filters) into a SQL query.
 *
 * Uses CTE wrapping: the user's query becomes a subquery, and conditions
 * are applied in an outer SELECT. This is robust against any query shape.
 *
 * Filter values are parameterized ($1, $2, ...) to prevent SQL injection.
 * Time range values are NOT parameterized (computed from a dropdown).
 *
 * Flux queries (InfluxDB) are passed through unchanged.
 */
export function injectConditions(
  query: string,
  options: {
    timeRange?: TimeRange;
    timeColumn?: string;
    /** Measure to aggregate when auto-bucketing a long range. */
    valueColumn?: string;
    /** Breakdown dimension — preserved as a GROUP BY key when bucketing. */
    seriesColumn?: string;
    filters?: DataFilter[];
    /** Query already filters time itself (e.g. $__timeFilter macro) — don't
     *  add a duplicate WHERE, but still allow ordering/bucketing on timeColumn. */
    timeAlreadyFiltered?: boolean;
    /** Query already aggregates into time buckets itself ($__timeGroup) —
     *  skip the outer auto-bucket wrap entirely (it would double-bucket). */
    alreadyAggregated?: boolean;
    dialect?: SqlDialect;
  },
): InjectedQuery {
  if (!query.trim()) return { sql: query, params: [] };

  // Skip for non-SQL queries (InfluxDB Flux)
  const trimmed = query.trim();
  if (/^(from\s*\(|import\s+")/i.test(trimmed) || /\|\s*>/.test(trimmed)) {
    return { sql: query, params: [] };
  }

  const {
    timeRange,
    timeColumn,
    valueColumn,
    seriesColumn,
    filters,
    timeAlreadyFiltered = false,
    alreadyAggregated = false,
    dialect = "postgres",
  } = options;
  const q = (name: string) => quoteIdent(name, dialect);
  const conditions: string[] = [];
  let filterParams: unknown[] = [];
  // Track whether we pushed a time condition on `timeColumn`. When we did, the
  // column is guaranteed to be a valid output of `_user_query`, so it's safe to
  // also ORDER BY / bucket on it below.
  let timeConditionAdded = false;

  // Inject a time filter only when the caller declared a time column AND the
  // query doesn't already filter time itself (e.g. via the $__timeFilter()
  // macro). Silently defaulting to "timestamp" caused errors on tables without
  // that column; double-filtering would fight the macro.
  if (timeRange && timeColumn && !timeAlreadyFiltered) {
    if (timeRange.type === "relative") {
      const parsed = parseRelativeRange(timeRange.value);
      if (parsed) {
        conditions.push(
          `${q(timeColumn)} >= NOW() - ${renderInterval(parsed.n, parsed.unit, dialect)}`,
        );
        timeConditionAdded = true;
      }
    } else {
      const [start, end] = timeRange.value.split("/");
      if (start && end) {
        conditions.push(
          `${q(timeColumn)} >= '${start}' AND ${q(timeColumn)} <= '${end}'`,
        );
        timeConditionAdded = true;
      } else if (start) {
        conditions.push(`${q(timeColumn)} >= '${start}'`);
        timeConditionAdded = true;
      }
    }
  }

  if (filters && filters.length > 0) {
    const result: ParameterizedConditions = filtersToSqlConditions(
      filters,
      1,
      dialect,
    );
    if (result.sql) {
      conditions.push(result.sql);
      filterParams = result.params;
    }
  }

  let innerQuery = trimmed.replace(/;$/, "");
  let limitClause = "";
  const limitMatch = innerQuery.match(/\bLIMIT\s+(\d+)\s*$/i);
  if (limitMatch) {
    limitClause = ` ${limitMatch[0]}`;
    innerQuery = innerQuery.slice(0, limitMatch.index).trimEnd();
  }

  // `timeColumn` is a usable output column when we filtered on it, or when the
  // query already filtered time itself (the builder sets `timeColumn` to the
  // output alias the macro filters on). Either way we can safely order/bucket.
  const timeColumnUsable =
    !!timeColumn && (timeConditionAdded || (timeAlreadyFiltered && !!timeRange));

  // Auto-downsample long ranges to a time-bucket aggregate so the whole window
  // is visible instead of a driver-capped slice. Requires a usable time column,
  // a declared `valueColumn` to aggregate, a range past the threshold, and no
  // user LIMIT (they own their query). Mirrors the native-metrics adaptive
  // path; ~500 buckets sit well under the row-cap, so nothing gets clipped.
  const rangeSeconds = timeRange ? getTimeRangeSeconds(timeRange) : 0;
  const shouldBucket =
    timeColumnUsable &&
    !limitClause &&
    !alreadyAggregated &&
    !!valueColumn &&
    rangeSeconds >= AUTO_BUCKET_MIN_RANGE_SECONDS;
  // Otherwise still impose a deterministic chronological order so the driver's
  // safety row-cap returns a contiguous window instead of an arbitrary slice
  // (the "missing middle of the month" bug).
  const shouldOrder = timeColumnUsable && !limitClause && !shouldBucket;

  // Nothing to inject, order, or bucket → leave the query untouched.
  if (conditions.length === 0 && !shouldBucket && !shouldOrder) {
    return { sql: query, params: [] };
  }

  const whereClause =
    conditions.length > 0 ? `\nWHERE ${conditions.join(" AND ")}` : "";

  if (shouldBucket) {
    const col = q(timeColumn!);
    const bucketSec = pickBucketSeconds(rangeSeconds);
    const bucketExpr = renderTimeBucket(col, bucketSec, dialect);
    const valCol = q(valueColumn!);
    const seriesSelect = seriesColumn ? `,\n  ${q(seriesColumn)}` : "";
    const seriesGroup = seriesColumn ? `, ${q(seriesColumn)}` : "";
    // Reduce each bucket with max(), not avg(): max() is type-safe across
    // Postgres/ClickHouse (avg() errors on boolean columns like
    // `maneuver_detected`, which would break an otherwise-working panel), and
    // for 0/1 or flag-style measures it stays faithful to the raw scatter
    // ("did it happen in this bucket") rather than producing odd fractions.
    const sql =
      `WITH _user_query AS (\n${innerQuery}\n)\n` +
      `SELECT\n  ${bucketExpr} AS ${col},\n  max(${valCol}) AS ${valCol}${seriesSelect}\n` +
      `FROM _user_query${whereClause}\n` +
      `GROUP BY ${bucketExpr}${seriesGroup}\n` +
      `ORDER BY ${bucketExpr} ASC`;
    return { sql, params: filterParams };
  }

  const orderClause = shouldOrder ? ` ORDER BY ${q(timeColumn!)} ASC` : "";
  const sql = `WITH _user_query AS (\n${innerQuery}\n)\nSELECT * FROM _user_query${whereClause}${orderClause}${limitClause}`;
  return { sql, params: filterParams };
}
