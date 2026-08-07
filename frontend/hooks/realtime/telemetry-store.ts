/**
 * Telemetry Store
 *
 * Pub-sub store for streaming telemetry data. Notifies subscribers
 * synchronously — RAF batching happens one layer up in the gateway
 * connection provider. Used with useSyncExternalStore at the leaf level.
 */

export interface TelemetryPoint {
  timestamp: string;
  value: number;
  source_id?: string;
  metric?: string;
}

export type TelemetryData = Record<string, TelemetryPoint[]>;

type TelemetrySubscriber = () => void;

// Near-miss dedup parameters. Tolerance must be smaller than the inter-sample
// interval of every supported stream — at 10ms we're safe for anything ≤ 50Hz.
// If we ever support kHz-rate streams, drop this to 1ms and accept that some
// catch-up bursts may slip through (still bounded by exact-set dedup).
const DEDUP_TOLERANCE_MS = 10;
// How far back to scan when checking for near-miss duplicates. Re-emits land
// in the recent replay window so we don't need to scan the whole buffer.
const DEDUP_SCAN_WINDOW = 50;

export interface TelemetryStore {
  subscribe: (callback: TelemetrySubscriber) => () => void;
  getSnapshot: () => TelemetryData;
  addPoints: (points: TelemetryPoint[]) => void;
  initMetrics: (metrics: string[]) => void;
  /**
   * Drop everything cached for a single metric. Called by the gateway
   * provider when a metric goes from 0 → 1 subscriber so a re-mounted
   * chart doesn't see points from a previous viewing session.
   */
  clearMetric: (metric: string) => void;
  clear: () => void;
}

export interface CreateTelemetryStoreOptions {
  /** Hard cap on points retained per metric. */
  maxPoints?: number;
  /**
   * Max age in ms for any point in the buffer. Points older than this
   * are evicted on every `addPoints` call. Bounds memory for long-lived
   * sessions and prevents stale frozen windows when a metric stops
   * streaming (e.g. you navigate away and come back).
   * Set to 0 to disable.
   */
  maxAgeMs?: number;
}

export function createTelemetryStore(
  optionsOrMaxPoints: CreateTelemetryStoreOptions | number = {},
): TelemetryStore {
  // Back-compat: accept a bare number for the old `createTelemetryStore(1000)`
  // call shape used by the gateway provider.
  const options: CreateTelemetryStoreOptions =
    typeof optionsOrMaxPoints === "number"
      ? { maxPoints: optionsOrMaxPoints }
      : optionsOrMaxPoints;
  const maxPoints = options.maxPoints ?? 1000;
  const maxAgeMs = options.maxAgeMs ?? 5 * 60_000; // 5 minutes default

  let data: TelemetryData = {};
  // Per-metric set of stored timestamps for O(1) dedup. The gateway can
  // re-emit points on stream restart (e.g. flipping the "recording" toggle
  // stops+starts the stream, and the catch-up burst overlaps points we
  // already have) or on WS reconnect. Without dedup those points append and
  // the chart draws a line through the duplicate — visible as two
  // overlapping lines on the canvas.
  const seenTimestamps: Record<string, Set<string>> = {};
  const subscribers = new Set<TelemetrySubscriber>();

  // Notify synchronously. The caller (the gateway provider's
  // flushPendingPoints) already runs inside a requestAnimationFrame
  // callback, so adding another RAF here would delay rendering by ~16ms
  // for no benefit.
  const notify = () => {
    subscribers.forEach((cb) => cb());
  };

  const subscribe = (callback: TelemetrySubscriber) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  };

  const getSnapshot = () => data;

  const addPoints = (points: TelemetryPoint[]) => {
    let changed = false;

    for (const point of points) {
      const metric = point.metric;
      if (!metric) continue;

      // Normalize: HTTP ingest and the device WS both accept numeric
      // (epoch-millis) timestamps and forward them through as JSON numbers.
      // The store's dedup, eviction, and downstream sort all assume ISO
      // strings — mixing types silently breaks every comparison (number >=
      // ISO-string coerces the string to NaN and is always false), which
      // caused the eviction pass to wipe every metric on every flush.
      if (typeof point.timestamp === "number") {
        point.timestamp = new Date(point.timestamp).toISOString();
      }

      if (!data[metric]) {
        data[metric] = [];
        seenTimestamps[metric] = new Set();
      }

      // Skip duplicates by (metric, timestamp) — exact match. Handles the
      // common case where the gateway re-emits a point with byte-identical
      // ISO timestamps (catch-up burst on stream restart, WS reconnect).
      const seen = seenTimestamps[metric];
      if (seen.has(point.timestamp)) continue;

      // Near-miss dedup: the gateway sometimes re-emits a logical sample
      // with a slightly drifted timestamp string (different ISO precision,
      // sub-ms rounding, epoch realignment after restart). The exact-set
      // check misses these and the chart draws a second line on top of
      // the first. A real new sample at a near-timestamp has a different
      // value; a re-emission has the same value — so we treat
      // (within ±tolerance) AND (identical value) as a duplicate.
      //
      // Scan a bounded window of the recent tail since re-emits happen
      // within the gateway's short replay window. O(K) per point with K
      // capped at 50 → cheap even on batched flushes.
      const incomingMs = Date.parse(point.timestamp);
      if (!Number.isNaN(incomingMs)) {
        const arr = data[metric];
        const start = Math.max(0, arr.length - DEDUP_SCAN_WINDOW);
        let isNearDup = false;
        for (let i = arr.length - 1; i >= start; i--) {
          const existing = arr[i];
          const existingMs = Date.parse(existing.timestamp);
          if (Number.isNaN(existingMs)) continue;
          if (
            Math.abs(incomingMs - existingMs) <= DEDUP_TOLERANCE_MS &&
            existing.value === point.value
          ) {
            isNearDup = true;
            break;
          }
        }
        if (isNearDup) continue;
      }

      seen.add(point.timestamp);
      data[metric].push(point);
      changed = true;

      // Trim if over limit — evict oldest from both the array and the seen
      // set so re-emission of a point older than the window is still allowed
      // through (rare, but keeps the invariant: seen reflects what's in the array).
      if (data[metric].length > maxPoints) {
        const excess = data[metric].length - maxPoints;
        const dropped = data[metric].slice(0, excess);
        for (const d of dropped) seen.delete(d.timestamp);
        data[metric] = data[metric].slice(excess);
      }
    }

    // Time-based eviction. Drops anything older than `maxAgeMs` from every
    // metric — bounds memory and prevents a metric whose stream went idle
    // (e.g. user navigated away from a non-recording chart) from holding a
    // frozen-in-time window that reappears when the user comes back.
    if (maxAgeMs > 0) {
      const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString();
      for (const metric of Object.keys(data)) {
        const arr = data[metric];
        if (arr.length === 0) continue;
        // Fast path: oldest point is inside the window — nothing to evict.
        if (arr[0].timestamp >= cutoffIso) continue;
        const firstFresh = arr.findIndex((p) => p.timestamp >= cutoffIso);
        const seen = seenTimestamps[metric];
        if (firstFresh === -1) {
          for (const d of arr) seen.delete(d.timestamp);
          data[metric] = [];
        } else {
          for (let i = 0; i < firstFresh; i++) seen.delete(arr[i].timestamp);
          data[metric] = arr.slice(firstFresh);
        }
        changed = true;
      }
    }

    if (changed) {
      // Create new reference to trigger useSyncExternalStore
      data = { ...data };

      notify();
    }
  };

  const initMetrics = (metrics: string[]) => {
    let changed = false;
    for (const metric of metrics) {
      if (!data[metric]) {
        data[metric] = [];
        seenTimestamps[metric] = new Set();
        changed = true;
      }
    }
    if (changed) {
      data = { ...data };
    }
  };

  const clearMetric = (metric: string) => {
    if (!(metric in data) && !(metric in seenTimestamps)) return;
    delete data[metric];
    delete seenTimestamps[metric];
    data = { ...data };
    notify();
  };

  const clear = () => {
    data = {};
    for (const key of Object.keys(seenTimestamps)) {
      delete seenTimestamps[key];
    }
    notify();
  };

  return { subscribe, getSnapshot, addPoints, initMetrics, clearMetric, clear };
}
