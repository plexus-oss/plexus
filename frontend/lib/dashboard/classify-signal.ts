/**
 * Signal-shape classifier for the signal rail's drop-to-create path: given a
 * cheap recent sample of a metric (one small /api/telemetry/query fetch at
 * drop time), deterministically pick the honest chart type for a new panel
 * instead of always defaulting to line.
 *
 * Rules (in order):
 *   1. Too few points → line (no evidence to overrule the default).
 *   2. Constant series → line (a flat line invents nothing).
 *   3. Low-cardinality integer-ish values (≤ 8 distinct) → a state/mode/flag
 *      signal. The proper rendering is a stepped (hold-last-value) line, but
 *      the GPU line renderer has no step interpolation mode (see
 *      components/ui/charts/geometry/line.ts — linear segments, optionally
 *      Catmull-Rom smoothed) and ChartPanelConfig has no stepped flag, so we
 *      fall back to scatter: honest points at the discrete levels, no diagonal
 *      ramp fiction between states. `stepped: true` records the intent so the
 *      create path can also disable smoothing and a future step mode can pick
 *      it up.
 *   4. Sparse (median inter-sample gap > 1/50th of the sampled span) →
 *      scatter — drawing line segments across big gaps is interpolation
 *      fiction.
 *   5. Otherwise → line (dense continuous signal), same as today.
 *
 * Pure and I/O-free (same rule as suggest.ts / column-roles) — the fetch
 * helper below is the only I/O and is kept separate so the classifier stays
 * unit-testable.
 */

export interface SignalSamplePoint {
  /** Epoch ms number or ISO timestamp string (the query API returns ISO). */
  timestamp: number | string;
  value: number;
}

export interface SignalClassification {
  chartType: "line" | "scatter";
  /**
   * True when the signal is a discrete state/mode/flag series that would
   * ideally render as a stepped (hold-last-value) line. The current renderer
   * has no step mode, so `chartType` is "scatter" whenever this is set.
   */
  stepped?: boolean;
  /** Human-readable explanation of the verdict (for debugging/telemetry). */
  reason: string;
}

/** Below this many finite points we keep the line default — not enough evidence. */
export const MIN_CLASSIFY_POINTS = 10;

/** At or below this many distinct integer-ish values a signal reads as state/mode. */
export const MAX_STATE_DISTINCT = 8;

/** Median inter-sample gap above this fraction of the sampled span → sparse. */
export const SPARSE_GAP_FRACTION = 1 / 50;

function toEpochMs(t: number | string): number {
  return typeof t === "number" ? t : new Date(t).getTime();
}

/** Integer-ish: within float noise of a whole number (scale-relative epsilon). */
function isIntegerish(v: number): boolean {
  return Math.abs(v - Math.round(v)) <= 1e-9 * Math.max(1, Math.abs(v));
}

/** Classify a recent sample of a signal into the honest chart type. */
export function classifySignal(
  points: SignalSamplePoint[],
): SignalClassification {
  // Keep only finite, time-parseable points; sort chronologically (the API
  // returns chronological rows, but the gap math must not trust that).
  const clean = points
    .map((p) => ({ t: toEpochMs(p.timestamp), v: p.value }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);

  if (clean.length < MIN_CLASSIFY_POINTS) {
    return {
      chartType: "line",
      reason: `insufficient sample (${clean.length} points < ${MIN_CLASSIFY_POINTS}) — keeping line default`,
    };
  }

  const distinct = new Set(clean.map((p) => p.v));

  if (distinct.size === 1) {
    return {
      chartType: "line",
      reason: "constant series — flat line is honest",
    };
  }

  if (
    distinct.size <= MAX_STATE_DISTINCT &&
    [...distinct].every(isIntegerish)
  ) {
    return {
      chartType: "scatter",
      stepped: true,
      reason: `state signal (${distinct.size} distinct integer levels) — renderer has no stepped-line mode, using points`,
    };
  }

  const span = clean[clean.length - 1].t - clean[0].t;
  if (span > 0) {
    const gaps: number[] = [];
    for (let i = 1; i < clean.length; i++) {
      gaps.push(clean[i].t - clean[i - 1].t);
    }
    gaps.sort((a, b) => a - b);
    const mid = gaps.length >> 1;
    const medianGap =
      gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
    if (medianGap > span * SPARSE_GAP_FRACTION) {
      return {
        chartType: "scatter",
        reason: `sparse sampling (median gap ${Math.round(medianGap)}ms > 1/50 of ${Math.round(span)}ms span) — points, no interpolation fiction`,
      };
    }
  }

  return { chartType: "line", reason: "dense continuous signal" };
}

// =============================================================================
// Drop-time sample fetch (the only I/O in this module)
// =============================================================================

/** Max points fetched for classification — cheap by construction. */
export const CLASSIFY_SAMPLE_LIMIT = 300;

/** Classification must never block the drop UX past this. */
export const CLASSIFY_TIMEOUT_MS = 1500;

/**
 * Fetch a small recent sample of one qualified metric via the existing
 * /api/telemetry/query route. Returns null on any failure or timeout — the
 * caller keeps the line default. `timeRange` accepts the same strings the
 * dashboard uses ("1h", "24h", or "startISO/endISO").
 */
export async function fetchSignalSample(
  qualifiedMetric: string,
  timeRange: string,
  timeoutMs: number = CLASSIFY_TIMEOUT_MS,
): Promise<SignalSamplePoint[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const params = new URLSearchParams({
      metrics: qualifiedMetric,
      timeRange,
      limit: String(CLASSIFY_SAMPLE_LIMIT),
    });
    const res = await fetch(`/api/telemetry/query?${params}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body: {
      data?: Record<string, { timestamp: string; value: number }[]>;
    } = await res.json();
    return body.data?.[qualifiedMetric] ?? null;
  } catch {
    // Abort, network failure, malformed JSON — all mean "keep line".
    return null;
  } finally {
    clearTimeout(timer);
  }
}
