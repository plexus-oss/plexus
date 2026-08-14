/**
 * Panel data pipeline — pure functions that transform raw telemetry data.
 *
 * Order of operations (matches usePanelData):
 *   1. Aggregation (time-bucket + aggregation function)
 *   2. Transforms (rolling avg, delta, rate, etc.)
 *   3. Filtering (client-side, for realtime sources)
 *
 * These are plain functions — wrapped in memoized hooks by usePanelPipeline.
 */

import type { TelemetryData } from "@/components/dashboard/telemetry-provider";
import type {
  DataAggregation,
  AggregationFunction,
  TimeBucket,
  DataFilter,
  TimeRange,
} from "@/lib/types/dashboard";
import { isNumericFilter, parseRelativeTime } from "@/lib/types/dashboard";
import {
  applyTransforms,
  type TransformPoint,
  type Transform,
} from "@/lib/transforms";

interface DataPoint {
  timestamp: string;
  value: number;
}

// =============================================================================
// AGGREGATION
// =============================================================================

const BUCKET_MS: Record<TimeBucket, number> = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

function bucketToMs(bucket: TimeBucket): number {
  return BUCKET_MS[bucket] ?? 5 * 60 * 1000;
}

function applyAggregation(values: number[], fn: AggregationFunction): number {
  if (values.length === 0) return 0;
  switch (fn) {
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "count":
      return values.length;
    case "first":
      return values[0];
    case "last":
    default:
      return values[values.length - 1];
  }
}

function aggregatePoints(
  points: DataPoint[],
  bucket: TimeBucket,
  fn: AggregationFunction,
): DataPoint[] {
  if (points.length === 0) return [];
  const bucketMs = bucketToMs(bucket);
  const buckets = new Map<number, number[]>();
  for (const point of points) {
    const ts = new Date(point.timestamp).getTime();
    const key = Math.floor(ts / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(point.value);
  }
  const result: DataPoint[] = [];
  for (const [key, values] of buckets) {
    result.push({
      timestamp: new Date(key).toISOString(),
      value: applyAggregation(values, fn),
    });
  }
  return result.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

export function aggregateTelemetryData(
  data: TelemetryData,
  aggregation: DataAggregation,
): TelemetryData {
  if (!aggregation.enabled) return data;
  const result: TelemetryData = {};
  for (const [metric, points] of Object.entries(data)) {
    result[metric] = Array.isArray(points)
      ? aggregatePoints(points as DataPoint[], aggregation.bucket, aggregation.function)
      : points;
  }
  return result;
}

// =============================================================================
// FILTERING
// =============================================================================

function valuePassesFilter(value: number, filter: DataFilter): boolean {
  if (filter.enabled === false) return true;
  const filterValue =
    typeof filter.value === "string" ? parseFloat(filter.value) : filter.value;
  switch (filter.operator) {
    case ">":
      return value > filterValue;
    case ">=":
      return value >= filterValue;
    case "<":
      return value < filterValue;
    case "<=":
      return value <= filterValue;
    case "=":
      return value === filterValue;
    case "!=":
      return value !== filterValue;
    default:
      return true;
  }
}

function filterPoints(points: DataPoint[], filters: DataFilter[]): DataPoint[] {
  if (filters.length === 0) return points;
  return points.filter((point) =>
    filters.every((filter) => {
      if (filter.enabled === false) return true;
      if (!isNumericFilter(filter)) return true;
      return valuePassesFilter(point.value, filter);
    }),
  );
}

export function filterTelemetryData(
  data: TelemetryData,
  filters: DataFilter[],
): TelemetryData {
  if (!filters || filters.length === 0) return data;
  const enabled = filters.filter((f) => f.enabled !== false);
  if (enabled.length === 0) return data;

  const result: TelemetryData = {};
  for (const [metric, points] of Object.entries(data)) {
    if (!Array.isArray(points)) {
      result[metric] = points;
      continue;
    }
    const metricName = metric.includes(":") ? metric.split(":")[1] : metric;
    const matching = enabled.filter((f) => {
      const filterField = f.field.includes(":") ? f.field.split(":")[1] : f.field;
      return filterField === metricName || f.field === metric;
    });
    result[metric] = matching.length > 0 ? filterPoints(points as DataPoint[], matching) : points;
  }
  return result;
}

// =============================================================================
// TIME-WINDOW CLIP
// =============================================================================

/**
 * The resolved clip window usePanelData applies to panel data before the
 * pipeline runs. ISO bounds are pre-formatted so per-point comparison is a
 * plain string compare (timestamps are ISO-8601). The buckets exist for cache
 * keying: bounds derived from a moving clock (relative ranges, an omitted
 * absolute end) are quantized to whole seconds so points don't flap in/out of
 * the window every render as the clock advances by a few ms; committed
 * absolute bounds are already-stable exact ms.
 */
export interface ClipWindow {
  /** Lower bound cache key: whole seconds (relative), exact ms (absolute). */
  startBucket: number;
  /** Upper bound cache key: whole seconds (relative), exact ms (absolute). */
  endBucket: number;
  startIso: string;
  endIso: string;
  /** Absolute ranges honor both bounds; relative ranges only the lower. */
  enforceUpper: boolean;
}

/** Newest point timestamp (ms) across all series, or null when there is no
 *  data. Series are time-ordered, so only each array's last element is read. */
function latestTimestampMs(data: TelemetryData | null | undefined): number | null {
  if (!data) return null;
  let latest = 0;
  for (const points of Object.values(data)) {
    if (!Array.isArray(points) || points.length === 0) continue;
    const last = points[points.length - 1] as { timestamp?: string };
    if (!last?.timestamp) continue;
    const ts = Date.parse(last.timestamp);
    if (Number.isFinite(ts) && ts > latest) latest = ts;
  }
  return latest > 0 ? latest : null;
}

/**
 * Resolve the time window panel data is clipped to before rendering.
 *
 * Absolute ranges are a closed interval the user picked on purpose — both
 * bounds are enforced exactly as given (an omitted end means "until now").
 *
 * Relative ("live") ranges MUST be anchored the same way the rendered x-domain
 * is (use-chart-domain): to the NEWEST DATA TIMESTAMP, not the wall clock.
 * The live domain parks at [latest − range, latest]; deriving the clip from
 * `Date.now() − range` instead means that whenever the data lags the wall
 * clock (an imported flight log, a source that went quiet), the clip erodes
 * the series from the left *inside* a domain that isn't moving — on screen the
 * chart collapses into a thin full-height stripe at the last-data x, then goes
 * blank once the lag exceeds the range, even though every point still sits
 * inside the rendered domain. Anchoring to the data keeps clip and domain in
 * agreement: the last `range` of data stays exactly as drawn, and for a truly
 * live stream (latest ≈ now) behavior is unchanged. Falls back to the wall
 * clock only when there is no data to anchor to.
 */
export function resolveClipWindow(
  timeRange: TimeRange,
  data: TelemetryData | null | undefined,
  nowMs: number = Date.now(),
): ClipWindow {
  let startMs: number;
  let endMs: number;
  let enforceUpper: boolean;
  /** Whether the upper bound came from the wall clock (omitted absolute end). */
  let wallClockEnd = false;
  if (timeRange.type === "absolute") {
    const [startStr, endStr] = timeRange.value.split("/");
    startMs = Date.parse(startStr);
    endMs = endStr ? Date.parse(endStr) : nowMs;
    wallClockEnd = !endStr;
    enforceUpper = true;
  } else {
    const rangeMs = parseRelativeTime(timeRange.value);
    const anchor = latestTimestampMs(data) ?? nowMs;
    startMs = anchor - rangeMs;
    endMs = Math.max(anchor, nowMs);
    enforceUpper = false;
  }

  // Committed absolute bounds are honored to the MILLISECOND. Every pan/zoom
  // commit carries ms bounds (toISOString of the gesture window), and the
  // rendered domain (getTimeRangeBounds) keeps them exactly — flooring the
  // enforced upper bound to a whole second here amputated every point in
  // (floor(end), end]: up to 999ms of the NEWEST data inside the domain, so a
  // dense (250Hz ULog) tail stopped visibly short of the right edge while the
  // crosshair still found values there. The second-quantization exists only
  // as an anti-flap cache key for bounds derived from a moving clock — the
  // relative anchor/now (lower-bound-only, so flooring merely widens) and an
  // omitted absolute end ("until now"); fixed committed bounds are already
  // stable cache keys as exact ms.
  const quantizeStart = timeRange.type !== "absolute";
  const quantizeEnd = timeRange.type !== "absolute" || wallClockEnd;
  const startBucket = quantizeStart ? Math.floor(startMs / 1000) : startMs;
  const endBucket = quantizeEnd ? Math.floor(endMs / 1000) : endMs;
  return {
    startBucket,
    endBucket,
    startIso: new Date(
      quantizeStart ? startBucket * 1000 : startMs,
    ).toISOString(),
    endIso: new Date(quantizeEnd ? endBucket * 1000 : endMs).toISOString(),
    enforceUpper,
  };
}

/**
 * Clip one time-ordered series to a resolved window. Fast path: when every
 * point is already inside, the input array is returned by reference so
 * downstream memos keep their identity.
 */
export function clipPointsToWindow<P extends { timestamp?: string }>(
  points: P[],
  window: ClipWindow,
): P[] {
  const first = points[0];
  const last = points[points.length - 1];
  const allIn =
    points.length === 0 ||
    ((!first?.timestamp || first.timestamp >= window.startIso) &&
      (!window.enforceUpper || !last?.timestamp || last.timestamp <= window.endIso));
  if (allIn) return points;
  return points.filter((p) => {
    if (!p.timestamp) return true;
    if (p.timestamp < window.startIso) return false;
    if (window.enforceUpper && p.timestamp > window.endIso) return false;
    return true;
  });
}

// =============================================================================
// FULL PIPELINE
// =============================================================================

export interface PipelineOptions {
  aggregation?: DataAggregation;
  transforms?: Transform[];
  /** Client-side filters (skipped when the source already filtered via SQL). */
  clientFilters?: DataFilter[];
}

/**
 * Run the full panel pipeline: aggregate → transform → filter.
 * Pure function; callers memoize.
 */
export function runPanelPipeline(
  data: TelemetryData,
  options: PipelineOptions,
): TelemetryData {
  let next = data;
  if (options.aggregation?.enabled) {
    next = aggregateTelemetryData(next, options.aggregation);
  }
  if (options.transforms && options.transforms.length > 0) {
    next = applyTransforms(
      next as Record<string, TransformPoint[]>,
      options.transforms,
    ) as TelemetryData;
  }
  if (options.clientFilters && options.clientFilters.length > 0) {
    next = filterTelemetryData(next, options.clientFilters);
  }
  return next;
}
