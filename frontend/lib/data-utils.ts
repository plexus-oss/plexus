export interface DataPoint {
  x: number;
  y: number;
}

export type Point = DataPoint;

/**
 * A chart point that may carry its source bucket's min/max (rollup /
 * downsampled telemetry tiers). Raw and realtime points leave them unset.
 */
export interface EnvelopePoint extends DataPoint {
  min?: number;
  max?: number;
}

/**
 * M4 downsampling: partition the x-range into `columns` pixel-column bins and
 * keep each bin's first, min, max, and last points (deduped, time-ordered).
 *
 * Unlike LTTB (one representative point per bucket) or averaged buckets, M4 is
 * lossless for line rendering at pixel resolution: the vertical extent drawn in
 * every pixel column is exactly the extent of the underlying data, so a
 * single-sample spike survives at any width. O(n) — one pass over the data,
 * one pass over the bins; no sorting of the input.
 *
 * Input is assumed time-ordered (ascending x), which all chart series are.
 * Bins holding ≤ 4 points pass through unchanged (lossless there too).
 */
export function m4Decimate(data: DataPoint[], columns: number): DataPoint[] {
  const n = data.length;
  if (n === 0 || columns < 1) return data;
  // With ≤ 4 points every bin passes through — nothing to do.
  if (n <= 4) return data;

  const minX = data[0].x;
  const maxX = data[n - 1].x;
  const span = maxX - minX;
  // Zero/invalid span (all points share one x): a single bin holds everything.
  const cols = span > 0 ? columns : 1;
  const invBinWidth = span > 0 ? cols / span : 0;

  // Per-bin state. `firstFour` keeps up to 4 raw indices so sparse bins can
  // pass through verbatim; dense bins fall back to first/min/max/last.
  const counts = new Int32Array(cols);
  const firstFour = new Int32Array(cols * 4).fill(-1);
  const firstIdx = new Int32Array(cols).fill(-1);
  const lastIdx = new Int32Array(cols).fill(-1);
  const minIdx = new Int32Array(cols).fill(-1);
  const maxIdx = new Int32Array(cols).fill(-1);

  for (let i = 0; i < n; i++) {
    const p = data[i];
    let b = Math.floor((p.x - minX) * invBinWidth);
    if (b < 0) b = 0;
    else if (b >= cols) b = cols - 1;

    const c = counts[b];
    if (c < 4) firstFour[b * 4 + c] = i;
    counts[b] = c + 1;

    if (firstIdx[b] === -1) firstIdx[b] = i;
    lastIdx[b] = i;
    if (minIdx[b] === -1 || p.y < data[minIdx[b]].y) minIdx[b] = i;
    if (maxIdx[b] === -1 || p.y > data[maxIdx[b]].y) maxIdx[b] = i;
  }

  const result: DataPoint[] = [];
  // Scratch for ordering a bin's ≤ 4 selected indices (constant work per bin).
  const sel: number[] = [0, 0, 0, 0];
  for (let b = 0; b < cols; b++) {
    const c = counts[b];
    if (c === 0) continue;
    if (c <= 4) {
      // Sparse bin: pass its points through untouched.
      for (let k = 0; k < c; k++) result.push(data[firstFour[b * 4 + k]]);
      continue;
    }
    // Dense bin: first / min / max / last, deduped, in original time order.
    sel[0] = firstIdx[b];
    sel[1] = minIdx[b];
    sel[2] = maxIdx[b];
    sel[3] = lastIdx[b];
    // Insertion-sort 4 elements — O(1) per bin, no array sort over the data.
    for (let i = 1; i < 4; i++) {
      const v = sel[i];
      let j = i - 1;
      while (j >= 0 && sel[j] > v) {
        sel[j + 1] = sel[j];
        j--;
      }
      sel[j + 1] = v;
    }
    let prev = -1;
    for (let i = 0; i < 4; i++) {
      if (sel[i] !== prev) result.push(data[sel[i]]);
      prev = sel[i];
    }
  }

  return result;
}

/**
 * Expand aggregated-tier points into a spike-preserving envelope.
 *
 * Rollup/downsampled telemetry points plot the bucket AVERAGE, which erases
 * every excursion inside the bucket. For each point carrying a min/max spread,
 * emit up to 3 time-ordered points: min at (x − δ), avg at x, max at (x + δ),
 * where δ = ¼ of the smaller adjacent bucket gap — so ordering stays strictly
 * increasing and the avg point keeps its original timestamp. Convention: min
 * before avg before max. Points without spread (raw tier, realtime, constant
 * buckets) pass through unchanged; inputs with no spread anywhere return the
 * same array reference.
 *
 * `maxGapMs` gates the expansion per point: when the bucket gap exceeds it,
 * the point passes through as its plain average. The envelope is only honest
 * while a whole bucket collapses into (roughly) one pixel column — once the
 * viewer zooms in far enough that a single bucket spans many pixels, the ±δ
 * offsets would draw a fake zigzag of structure the server never reported.
 * Callers derive the ceiling from the visible span via envelopeGapCeilingMs.
 */
export function expandBucketEnvelope(
  points: EnvelopePoint[],
  maxGapMs: number = Infinity,
): DataPoint[] {
  const n = points.length;
  // A single point has no bucket-width context to place min/max against.
  if (n < 2) return points;

  let hasSpread = false;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (
      (p.min !== undefined && p.min < p.y) ||
      (p.max !== undefined && p.max > p.y)
    ) {
      hasSpread = true;
      break;
    }
  }
  if (!hasSpread) return points;

  const result: DataPoint[] = [];
  let expandedAny = false;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const gapPrev = i > 0 ? p.x - points[i - 1].x : Infinity;
    const gapNext = i < n - 1 ? points[i + 1].x - p.x : Infinity;
    let gap = Math.min(gapPrev, gapNext);
    if (!Number.isFinite(gap) || gap <= 0) gap = 0;
    const delta = gap / 4;
    const withinGate = delta > 0 && gap <= maxGapMs;

    const hasMin = p.min !== undefined && p.min < p.y && withinGate;
    const hasMax = p.max !== undefined && p.max > p.y && withinGate;
    if (hasMin || hasMax) expandedAny = true;

    if (hasMin) result.push({ x: p.x - delta, y: p.min! });
    result.push({ x: p.x, y: p.y });
    if (hasMax) result.push({ x: p.x + delta, y: p.max! });
  }
  // The gate suppressed every expansion — keep the input's identity so
  // downstream memos don't churn on a no-op copy.
  return expandedAny ? result : points;
}

/**
 * How many pixels a rollup bucket may span on screen before its envelope
 * expansion stops (see expandBucketEnvelope). Below this a bucket is ~a pixel
 * column and the min→avg→max triplet honestly paints its vertical extent; a
 * 7d window over 1h rollups (~5px/bucket) stays under it. Above it each
 * bucket is individually resolvable and the ±δ offsets would read as fake
 * intra-bucket oscillation.
 */
export const MAX_ENVELOPE_GAP_PX = 12;

/**
 * Largest bucket gap (ms) whose envelope expansion is still honest for a
 * given visible span and chart width. Infinity (no gate) when either is
 * unknown — matching pre-gate behavior.
 */
export function envelopeGapCeilingMs(
  visibleSpanMs: number,
  chartWidthPx: number,
): number {
  if (!(visibleSpanMs > 0) || !(chartWidthPx > 0)) return Infinity;
  return (visibleSpanMs / chartWidthPx) * MAX_ENVELOPE_GAP_PX;
}

/**
 * Fraction of the window span kept as slack beyond each edge by
 * sliceSeriesToWindow, so edge segments stay continuous and smoothing has a
 * neighbor to lean on without reintroducing huge offscreen coordinates.
 */
export const WINDOW_PAD_FRACTION = 0.05;

/**
 * Slice a time-ordered series to the points relevant to a visible x-window.
 *
 * Deep zoom can put the visible window many-thousand-fold inside the data's
 * span (2h of buckets under a 10ms window during a transient wheel zoom).
 * Rendering the full series then breaks two ways: the M4 point budget is
 * spent on offscreen columns (the window collapses into one column → a giant
 * step), and offscreen points map to pixel coordinates so large that the
 * GPU's Float32 vertex math loses whole pixels of precision (jumping/garbage
 * lines). This keeps only points inside [start − pad, end + pad] and, where a
 * segment crosses a pad edge, replaces the offscreen neighbor with the exact
 * f64-interpolated crossing at that edge — every retained coordinate stays
 * within ~5% of the window, and a window that falls between two samples still
 * draws the honest connecting segment.
 *
 * Returns the input array by reference when nothing needs trimming (the
 * common non-zoomed case), so memo identities are preserved. A window wholly
 * outside the data returns an empty array (nothing is visible, and there is
 * no crossing segment).
 */
export function sliceSeriesToWindow<P extends EnvelopePoint>(
  points: P[],
  start: number,
  end: number,
  padFraction: number = WINDOW_PAD_FRACTION,
): EnvelopePoint[] {
  const n = points.length;
  if (n === 0 || !(end > start)) return points;

  const pad = (end - start) * padFraction;
  const lo = start - pad;
  const hi = end + pad;
  if (points[0].x >= lo && points[n - 1].x <= hi) return points;

  // lower bound: first index with x >= lo
  let a = 0;
  let b = n;
  while (a < b) {
    const m = (a + b) >> 1;
    if (points[m].x < lo) a = m + 1;
    else b = m;
  }
  const firstIn = a;
  // last index with x <= hi
  let c = 0;
  let d = n;
  while (c < d) {
    const m = (c + d) >> 1;
    if (points[m].x <= hi) c = m + 1;
    else d = m;
  }
  const lastIn = c - 1;

  const interp = (p0: DataPoint, p1: DataPoint, x: number): DataPoint => {
    const dx = p1.x - p0.x;
    const t = dx > 0 ? (x - p0.x) / dx : 0;
    return { x, y: p0.y + (p1.y - p0.y) * t };
  };

  // Window entirely before the first point or after the last one.
  if (firstIn >= n || lastIn < 0) return [];

  // No point inside, but one segment spans the whole window — clamp both ends.
  if (firstIn > lastIn) {
    const p0 = points[firstIn - 1];
    const p1 = points[firstIn];
    return [interp(p0, p1, lo), interp(p0, p1, hi)];
  }

  const out: EnvelopePoint[] = [];
  if (firstIn > 0) out.push(interp(points[firstIn - 1], points[firstIn], lo));
  for (let i = firstIn; i <= lastIn; i++) out.push(points[i]);
  if (lastIn < n - 1) out.push(interp(points[lastIn], points[lastIn + 1], hi));
  return out;
}

/**
 * Downsample data using LTTB (Largest Triangle Three Buckets) algorithm.
 * Preserves visual fidelity of time-series charts at lower point counts.
 */
export function downsampleLTTB(
  data: DataPoint[],
  targetPoints: number
): DataPoint[] {
  if (data.length <= targetPoints) return data;
  if (targetPoints < 3) return [data[0], data[data.length - 1]];

  const result: DataPoint[] = [];
  const bucketSize = (data.length - 2) / (targetPoints - 2);

  result.push(data[0]);

  for (let i = 0; i < targetPoints - 2; i++) {
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(
      Math.floor((i + 2) * bucketSize) + 1,
      data.length
    );
    const avgRangeLength = avgRangeEnd - avgRangeStart;

    let avgX = 0;
    let avgY = 0;

    if (avgRangeLength > 0) {
      for (let j = avgRangeStart; j < avgRangeEnd; j++) {
        avgX += data[j].x;
        avgY += data[j].y;
      }
      avgX /= avgRangeLength;
      avgY /= avgRangeLength;
    } else {
      avgX = data[data.length - 1].x;
      avgY = data[data.length - 1].y;
    }

    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.min(
      Math.floor((i + 1) * bucketSize) + 1,
      data.length
    );

    const pointAX = result[result.length - 1].x;
    const pointAY = result[result.length - 1].y;

    let maxArea = -1;
    let maxAreaPoint: DataPoint = data[Math.min(rangeStart, data.length - 1)];

    for (let j = rangeStart; j < rangeEnd && j < data.length; j++) {
      const area = Math.abs(
        (pointAX - avgX) * (data[j].y - pointAY) -
          (pointAX - data[j].x) * (avgY - pointAY)
      );

      if (area > maxArea) {
        maxArea = area;
        maxAreaPoint = data[j];
      }
    }

    result.push(maxAreaPoint);
  }

  result.push(data[data.length - 1]);

  return result;
}
