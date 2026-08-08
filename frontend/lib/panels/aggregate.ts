/**
 * Tier-independent aggregation over telemetry points (stat panel et al.).
 *
 * Downsampled resolutions (windows >1h — query-time downsample, 1-min rollup,
 * hourly rollup) deliver one point per time bucket whose `value` is the bucket
 * AVERAGE of the raw events; `sum`/`count` carry the bucket's raw totals
 * (lib/db/clickhouse.ts AdaptivePoint). Aggregating with `value` alone makes
 * counter-style stats tier-dependent: Σ(bucket averages) counts buckets, not
 * events, so the same metric shows different totals at 23h (raw) than at 7d
 * (hourly rollup).
 *
 * Every helper here uses `sum ?? value` / `count ?? 1` per point:
 *   - raw / realtime-WS / legacy points (no bucket fields): each point IS one
 *     event, so the fallback reproduces the old behavior exactly;
 *   - downsampled points: bucket totals are used, so totals and averages match
 *     what the raw data would have produced.
 */

export interface AggregatablePoint {
  timestamp: string;
  /** Raw value (raw tier) or bucket average (downsampled tiers). */
  value: number;
  /** Σ of raw values inside this point's bucket, when downsampled. */
  sum?: number;
  /** Number of raw events inside this point's bucket, when downsampled. */
  count?: number;
}

export type WindowAggregation =
  | "last"
  | "avg"
  | "min"
  | "max"
  | "sum"
  | "count";

function isNum(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

/** Σ of raw event values across the window — same total at every tier. */
export function sumOverWindow(points: AggregatablePoint[]): number {
  let total = 0;
  for (const p of points) {
    const s = isNum(p.sum) ? p.sum : p.value;
    if (isNum(s)) total += s;
  }
  return total;
}

/**
 * Number of raw EVENTS across the window — same at every tier.
 *
 * NOT the stat panel's "count" aggregation, which counts SOURCES with data
 * (see lib/types/dashboard.ts `Aggregation` and stat-panel.tsx).
 */
export function countOverWindow(points: AggregatablePoint[]): number {
  let total = 0;
  for (const p of points) {
    if (!isNum(isNum(p.sum) ? p.sum : p.value)) continue;
    total += isNum(p.count) ? p.count : 1;
  }
  return total;
}

/**
 * True average across the window: Σ(raw sums) / Σ(raw counts).
 * A plain mean of downsampled `value`s weights every bucket equally regardless
 * of how many events it contains; this doesn't. For points without bucket
 * fields it reduces to the plain mean. Null when no numeric points.
 */
export function avgOverWindow(points: AggregatablePoint[]): number | null {
  const count = countOverWindow(points);
  if (count === 0) return null;
  return sumOverWindow(points) / count;
}

/**
 * Aggregate one (source, metric) series over its time window.
 *
 * "count" here means raw EVENT count (Σ of bucket counts) — callers that want
 * number-of-sources semantics (the stat panel's multi-source "count") must
 * handle that before calling this. Returns null when no numeric points exist.
 */
export function aggregateOverWindow(
  points: AggregatablePoint[],
  aggregation: WindowAggregation,
): number | null {
  const vals = points.map((p) => p.value).filter(isNum);

  switch (aggregation) {
    case "sum":
      return vals.length > 0 ? sumOverWindow(points) : null;
    case "count":
      return countOverWindow(points);
    case "avg":
      return avgOverWindow(points);
    case "min":
      return vals.length > 0 ? Math.min(...vals) : null;
    case "max":
      return vals.length > 0 ? Math.max(...vals) : null;
    case "last":
    default:
      return vals.length > 0 ? vals[vals.length - 1] : null;
  }
}
