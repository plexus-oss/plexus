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
} from "@/lib/types/dashboard";
import { isNumericFilter } from "@/lib/types/dashboard";
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
