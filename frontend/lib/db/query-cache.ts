/**
 * Customer Database Protection Layer
 *
 * Four layers of protection to avoid overloading customer databases:
 *
 * 1. **Singleflight** — concurrent identical requests share one DB call.
 *    10 users hitting the same dashboard panel = 1 query, not 10.
 *
 * 2. **Short-TTL cache** — identical queries return cached results for a
 *    brief window (15s). Catches sequential dashboard loads and SWR revalidation.
 *
 * 3. **Circuit breaker** — if a source errors 3+ times in 60s, all requests
 *    to that source are short-circuited for a cooldown period. Prevents
 *    piling onto an overloaded or down database.
 *
 * 4. **Per-source concurrency limit** — max 3 concurrent queries per source.
 *    Excess requests queue instead of opening more connections.
 *
 * NOTE: This module is server-only due to credential handling context.
 */

import "server-only";

import { createHash } from "crypto";

// =============================================================================
// Types
// =============================================================================

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

// =============================================================================
// Circuit Breaker
// =============================================================================

interface CircuitState {
  failures: number;
  lastFailure: number;
  openUntil: number; // timestamp when circuit closes again
}

const circuits = new Map<string, CircuitState>();
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_WINDOW = 60_000; // count failures within 60s
const CIRCUIT_COOLDOWN = 30_000; // back off for 30s after tripping

/**
 * Check if a source's circuit breaker is open (tripped).
 * Returns an error message if open, null if the source is OK to query.
 */
export function checkCircuit(sourceId: string): string | null {
  const state = circuits.get(sourceId);
  if (!state) return null;

  const now = Date.now();

  // Circuit is open — check if cooldown has passed
  if (state.openUntil > now) {
    const remainingSec = Math.ceil((state.openUntil - now) / 1000);
    return `Connection is temporarily paused (${remainingSec}s remaining). The database returned multiple errors — backing off to avoid overloading it.`;
  }

  // Cooldown passed — reset the circuit
  if (state.openUntil > 0 && state.openUntil <= now) {
    circuits.delete(sourceId);
  }

  return null;
}

/**
 * Record a successful query — resets the failure counter.
 */
export function recordSuccess(sourceId: string): void {
  circuits.delete(sourceId);
}

/**
 * Record a failed query. If failures exceed the threshold within the
 * window, trip the circuit breaker.
 */
export function recordFailure(sourceId: string): void {
  const now = Date.now();
  const state = circuits.get(sourceId);

  if (!state || now - state.lastFailure > CIRCUIT_WINDOW) {
    // First failure or outside window — start fresh
    circuits.set(sourceId, { failures: 1, lastFailure: now, openUntil: 0 });
    return;
  }

  state.failures++;
  state.lastFailure = now;

  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = now + CIRCUIT_COOLDOWN;
  }
}

// =============================================================================
// Per-Source Concurrency Limit
// =============================================================================

const MAX_CONCURRENT_PER_SOURCE = 10;

interface ConcurrencyState {
  active: number;
  queue: Array<{ resolve: () => void }>;
}

const concurrency = new Map<string, ConcurrencyState>();

/**
 * Acquire a concurrency slot for a source. If the source already has
 * MAX_CONCURRENT_PER_SOURCE queries in-flight, this promise will wait
 * until a slot opens.
 *
 * Returns a release function that MUST be called when the query finishes.
 */
export async function acquireSlot(sourceId: string): Promise<() => void> {
  let state = concurrency.get(sourceId);
  if (!state) {
    state = { active: 0, queue: [] };
    concurrency.set(sourceId, state);
  }

  if (state.active < MAX_CONCURRENT_PER_SOURCE) {
    state.active++;
    return () => releaseSlot(sourceId);
  }

  // Queue this request
  await new Promise<void>((resolve) => {
    state!.queue.push({ resolve });
  });

  return () => releaseSlot(sourceId);
}

function releaseSlot(sourceId: string): void {
  const state = concurrency.get(sourceId);
  if (!state) return;

  if (state.queue.length > 0) {
    // Hand the slot to the next waiting request
    const next = state.queue.shift()!;
    next.resolve();
  } else {
    state.active--;
    if (state.active === 0) {
      concurrency.delete(sourceId);
    }
  }
}

// =============================================================================
// Singleflight
// =============================================================================

/** In-flight requests keyed by hash — concurrent identical requests share one promise */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Execute `fn` with singleflight semantics: if an identical request (by key)
 * is already in-flight, return its promise instead of executing again.
 */
export async function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

// =============================================================================
// Query Result Cache
// =============================================================================

const queryCache = new Map<string, CacheEntry<unknown>>();
const QUERY_CACHE_TTL = 15_000; // 15 seconds
const MAX_CACHE_ENTRIES = 200;

/**
 * Build a cache key from source ID + query + params.
 */
export function queryCacheKey(
  sourceId: string,
  query: string,
  params?: Record<string, unknown>,
): string {
  const raw = `${sourceId}:${query}:${JSON.stringify(params ?? {})}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

/**
 * Get a cached query result if it exists and hasn't expired.
 */
export function getCachedQuery<T>(key: string): T | null {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > QUERY_CACHE_TTL) {
    queryCache.delete(key);
    return null;
  }
  return entry.data as T;
}

/**
 * Cache a query result.
 */
export function setCachedQuery<T>(key: string, data: T): void {
  // Evict oldest entries if we hit the cap
  if (queryCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = queryCache.keys().next().value;
    if (oldest) queryCache.delete(oldest);
  }
  queryCache.set(key, { data, cachedAt: Date.now() });
}

// =============================================================================
// Cleanup (periodic eviction of expired entries)
// =============================================================================

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of queryCache) {
    if (now - entry.cachedAt > QUERY_CACHE_TTL) {
      queryCache.delete(key);
    }
  }
  // Clean up stale circuit breaker entries
  for (const [key, state] of circuits) {
    if (state.openUntil > 0 && state.openUntil <= now) {
      circuits.delete(key);
    } else if (now - state.lastFailure > CIRCUIT_WINDOW) {
      circuits.delete(key);
    }
  }
}, 30_000);

if (cleanupTimer.unref) cleanupTimer.unref();
