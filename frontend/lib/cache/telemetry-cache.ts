/**
 * In-memory LRU cache for telemetry queries.
 *
 * TTL strategy:
 * - Recent data (timeRange < 1h): 10s TTL
 * - Historical data: 60s TTL
 *
 * Max 1000 entries, evicts oldest on overflow.
 */

import "server-only";
import { SECOND_MS, MINUTE_MS, HOUR_MS, DAY_MS } from "@/lib/constants/time";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const MAX_ENTRIES = 1000;

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Build a deterministic cache key from query parameters.
 */
export function buildCacheKey(
  orgId: string,
  metrics: string[],
  timeRange: string,
  sourceId?: string,
): string {
  const sorted = [...metrics].sort().join(",");
  return `${orgId}:${sourceId || "*"}:${sorted}:${timeRange}`;
}

/**
 * Get a cached value, or null if expired/missing.
 */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.data as T;
}

/**
 * Store a value in the cache.
 */
export function setCached<T>(key: string, data: T, ttlMs: number): void {
  cache.delete(key);

  while (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }

  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Determine TTL based on time range.
 * Short ranges (< 1h) get 10s TTL; longer ranges get 60s.
 */
export function getTtlForTimeRange(timeRange: string): number {
  let ms: number;

  // Absolute range "<startISO>/<endISO>": TTL keys off the window span.
  if (timeRange.includes("/")) {
    const [startStr, endStr] = timeRange.split("/");
    const start = Date.parse(startStr);
    const end = endStr ? Date.parse(endStr) : Date.now();
    if (Number.isNaN(start) || Number.isNaN(end)) return 10 * SECOND_MS;
    ms = end - start;
  } else {
    const match = timeRange.match(/^(\d+)([smhd])$/);
    if (!match) return 10 * SECOND_MS;

    const [, numStr, unit] = match;
    const num = parseInt(numStr, 10);

    ms =
      unit === "s"
        ? num * SECOND_MS
        : unit === "m"
          ? num * MINUTE_MS
          : unit === "h"
            ? num * HOUR_MS
            : num * DAY_MS;
  }

  return ms < HOUR_MS ? 10 * SECOND_MS : MINUTE_MS;
}
