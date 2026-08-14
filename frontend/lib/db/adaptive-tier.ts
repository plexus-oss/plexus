/**
 * Pure tier-selection helpers for queryTelemetryAdaptive (lib/db/clickhouse.ts).
 *
 * The adaptive query historically picked its resolution tier from the window
 * SPAN alone: any window ≤ 1h took the raw path, whose row cap keeps the
 * newest `limit` rows. A dense series (e.g. a ULog import at 250Hz — ~17k
 * rows over 70s) silently lost everything older than the cap, rendering a
 * band shorter than the axis. These helpers make the raw tier density-aware:
 * the caller probes with LIMIT budget+1 and, when the window holds more rows
 * than the budget, falls back to the query-time bucket tier instead of
 * serving a truncated slice.
 *
 * Kept dependency-free so the decision logic is unit-testable without
 * importing the ClickHouse client module.
 */

/**
 * Target bucket count for query-time downsampling — matches the ~2000
 * buckets the existing 1h–6h tier aims for (`timeRangeMs / (2000 * 1000)`).
 */
export const TARGET_BUCKETS = 2000;

/**
 * Floor for the query-time bucket width. Sub-second buckets are supported
 * (the dense fallback uses a millisecond-based toStartOfInterval); below
 * 10ms the bucket count explodes with no visual gain at chart widths.
 */
export const MIN_BUCKET_MS = 10;

export type RawTierDecision =
  | { tier: "raw" }
  | { tier: "bucketed"; intervalMs: number };

/**
 * Query-time bucket width (ms) for a window span: ~`targetBuckets` buckets
 * across the span, never narrower than `minBucketMs`. A 70s window buckets
 * at 35ms; a 1h window at 1800ms.
 */
export function bucketIntervalMs(
  spanMs: number,
  targetBuckets: number = TARGET_BUCKETS,
  minBucketMs: number = MIN_BUCKET_MS,
): number {
  if (!(spanMs > 0)) return minBucketMs;
  return Math.max(Math.ceil(spanMs / targetBuckets), minBucketMs);
}

/**
 * Decide whether a raw-tier fetch may be served as-is or must fall back to
 * query-time bucketing. `probedRowCount` is the row count of a
 * LIMIT budget+1 probe: anything above `budget` means the window holds more
 * rows than the response may carry, and serving the capped slice would
 * silently drop the series' oldest points (the newest rows win inside the
 * cap — see queryTelemetry).
 *
 * Series at or under the budget must take the identical raw path — the
 * probe's rows ARE the raw result in that case, byte-identical to the
 * pre-density-aware behavior.
 */
export function decideRawTier(
  probedRowCount: number,
  budget: number,
  spanMs: number,
): RawTierDecision {
  if (probedRowCount <= budget) return { tier: "raw" };
  return { tier: "bucketed", intervalMs: bucketIntervalMs(spanMs) };
}
