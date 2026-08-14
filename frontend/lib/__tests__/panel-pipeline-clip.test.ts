/**
 * Live-window clipping vs the rendered domain.
 *
 * Prod regression: a dashboard of ULog-imported flight data in LIVE mode
 * (relative range) rendered every chart as one thin full-height vertical
 * stripe at the last-data time, then went blank — while the pinned tracker
 * still read correct values, proving the points were present client-side.
 *
 * Root cause: the pre-pipeline clip anchored relative ranges to the WALL
 * CLOCK (`Date.now() − range`) while the rendered x-domain (use-chart-domain)
 * anchors to the NEWEST DATA TIMESTAMP. When the data lags the clock (an
 * imported log, a quiet source), the clip erodes the series from the left
 * inside a domain that stays parked at the data — geometry collapses against
 * the right edge into a stripe, then disappears, even though every point is
 * inside the domain the axis is drawing.
 *
 * These tests replay the exact pure pipeline ChartPanel composes in live
 * mode: resolveClipWindow + clipPointsToWindow (usePanelData.windowedData) →
 * xy conversion → window slice (xWindow is null for live relative ranges, per
 * useChartSeries) → M4 decimation → the rendered domain use-chart-domain
 * produces. The invariant: points inside the rendered domain must survive to
 * the rendered series.
 */
import { describe, expect, it } from "vitest";
import {
  clipPointsToWindow,
  resolveClipWindow,
} from "@/lib/panel-pipeline";
import {
  envelopeGapCeilingMs,
  expandBucketEnvelope,
  m4Decimate,
  sliceSeriesToWindow,
  type EnvelopePoint,
} from "@/lib/data-utils";
import { createLineGeometry } from "@/components/ui/charts/geometry/line";
import type { TimeRange } from "@/lib/types/dashboard";

const MIN = 60_000;
const T_END = Date.parse("2026-08-14T10:07:56.000Z"); // last flight sample

/** ~3-minute flight at 5 Hz, ending at T_END (901 points). */
function flightSeries() {
  const points: Array<{ timestamp: string; value: number }> = [];
  for (let t = T_END - 3 * MIN; t <= T_END; t += 200) {
    points.push({
      timestamp: new Date(t).toISOString(),
      value: Math.sin(t / 5_000) * 10,
    });
  }
  return points;
}

/**
 * Replay ChartPanel's live-mode pipeline for one series and return both the
 * rendered series and the rendered x-domain.
 *
 * Mirrors, stage for stage:
 * - usePanelData.windowedData  → resolveClipWindow + clipPointsToWindow
 * - useChartSeries baseSeries  → timestamp → x (ms) conversion
 * - useChartSeries windowing   → xWindow; null for live relative ranges
 *   (chart-panel's visibleWindow), so sliceSeriesToWindow is skipped —
 *   replicated verbatim rather than short-circuited
 * - useChartSeries decimation  → m4Decimate past the point budget
 * - use-chart-domain (relative)→ [edge − range, edge], edge = latest data
 *   + 1.5% margin (the settled value of the eased right edge)
 */
function renderLivePipeline(
  points: Array<{ timestamp: string; value: number }>,
  timeRange: TimeRange,
  nowMs: number,
  rangeMs: number,
  chartWidth = 600,
) {
  // usePanelData.windowedData
  const clipWindow = resolveClipWindow(timeRange, { m: points }, nowMs);
  const clipped = clipPointsToWindow(points, clipWindow);

  // useChartSeries: conversion
  const base = clipped.map((p) => ({
    x: Date.parse(p.timestamp),
    y: p.value,
  }));

  // useChartSeries: windowing — live relative ranges pass xWindow = null
  // (chart-panel.tsx visibleWindow), so the slice is a pass-through.
  const xWindow: [number, number] | null = null;
  const windowed = xWindow
    ? sliceSeriesToWindow(base, xWindow[0], xWindow[1])
    : base;

  // useChartSeries: decimation
  const pointBudget = Math.max(200, chartWidth * 2);
  const columns = Math.max(100, Math.ceil(pointBudget / 2));
  const rendered =
    windowed.length <= pointBudget ? windowed : m4Decimate(windowed, columns);

  // use-chart-domain, relative branch (settled ease)
  const latest = base.length > 0 ? base[base.length - 1].x : undefined;
  const edge = (latest ?? nowMs) + rangeMs * 0.015;
  const domain: [number, number] = [edge - rangeMs, edge];

  return { rendered, domain };
}

describe("live clip window vs rendered domain (stale imported flight)", () => {
  const timeRange: TimeRange = { type: "relative", value: "1m" };

  it("keeps the points the rendered domain displays when data lags the wall clock", () => {
    const points = flightSeries();
    // Viewed 50s after the flight's last sample — the ULog-import scenario.
    const nowMs = T_END + 50_000;
    const { rendered, domain } = renderLivePipeline(
      points,
      timeRange,
      nowMs,
      MIN,
    );

    const inDomain = points.filter((p) => {
      const x = Date.parse(p.timestamp);
      return x >= domain[0] && x <= domain[1];
    });
    expect(inDomain.length).toBeGreaterThan(100); // scenario sanity

    // The regression: only the last (range − lag) of data survived the clip,
    // squeezing the whole flight into a thin stripe at the last-data x.
    // Nearly everything inside the rendered domain must survive to render.
    expect(rendered.length).toBeGreaterThanOrEqual(
      Math.floor(inDomain.length * 0.9),
    );

    // And the drawn geometry must span the domain∩data overlap — not collapse
    // into a sliver against the right edge.
    const drawnSpan =
      rendered.length > 1 ? rendered[rendered.length - 1].x - rendered[0].x : 0;
    const overlap =
      Math.min(domain[1], T_END) -
      Math.max(domain[0], Date.parse(points[0].timestamp));
    expect(drawnSpan).toBeGreaterThanOrEqual(overlap * 0.9);
  });

  it("still renders the flight once the lag exceeds the range (no blank chart)", () => {
    const points = flightSeries();
    // 90s after the last sample: with a wall-clock-anchored clip the entire
    // series is evicted and the panel blanks despite a domain full of data.
    const nowMs = T_END + 90_000;
    const { rendered, domain } = renderLivePipeline(
      points,
      timeRange,
      nowMs,
      MIN,
    );

    const inDomain = points.filter((p) => {
      const x = Date.parse(p.timestamp);
      return x >= domain[0] && x <= domain[1];
    });
    expect(inDomain.length).toBeGreaterThan(100);
    expect(rendered.length).toBeGreaterThanOrEqual(
      Math.floor(inDomain.length * 0.9),
    );
  });

  it("behaves identically to the wall clock for a genuinely live stream", () => {
    // Data streaming right up to now: anchoring to the data's newest point
    // must match the old wall-clock behavior (modulo 1s quantization).
    const points = flightSeries();
    const nowMs = T_END + 500; // newest sample landed half a second ago
    const w = resolveClipWindow(timeRange, { m: points }, nowMs);
    expect(w.enforceUpper).toBe(false);
    expect(w.startBucket * 1000).toBeGreaterThanOrEqual(nowMs - MIN - 1_500);
    expect(w.startBucket * 1000).toBeLessThanOrEqual(nowMs - MIN + 1_500);
  });

  it("falls back to the wall clock when there is no data to anchor to", () => {
    const w = resolveClipWindow(timeRange, {}, T_END);
    expect(w.startBucket).toBe(Math.floor((T_END - MIN) / 1000));
  });
});

describe("resolveClipWindow — absolute ranges", () => {
  it("honors both bounds exactly as committed", () => {
    const start = "2026-08-14T10:06:45.000Z";
    const end = "2026-08-14T10:08:00.000Z";
    const w = resolveClipWindow(
      { type: "absolute", value: `${start}/${end}` },
      { m: flightSeries() },
      T_END + 999_999, // wall clock must be irrelevant
    );
    expect(w.enforceUpper).toBe(true);
    expect(w.startIso).toBe(start);
    expect(w.endIso).toBe(end);
  });

  it("treats an omitted end as 'until now'", () => {
    const start = "2026-08-14T10:06:45.000Z";
    const nowMs = Date.parse("2026-08-14T10:09:00.000Z");
    const w = resolveClipWindow(
      { type: "absolute", value: `${start}/` },
      {},
      nowMs,
    );
    expect(w.startIso).toBe(start);
    expect(w.endBucket).toBe(Math.floor(nowMs / 1000));
  });
});

// ============================================================================
// Right-edge coverage: the newest samples sitting AT/near domain max.
//
// Prod regression (third in the series): a live dashboard of ULog-imported
// 250Hz data anchors its domain to the newest data point (use-chart-domain
// adds a margin past latest), so the newest samples sit at/near domain max.
// The tooltip found values at the right edge but no line rendered there.
//
// Root cause: resolveClipWindow floors BOTH bounds to whole seconds. For
// relative (live) ranges only the lower bound is enforced, so the floor can
// only widen the window — harmless. But committed ABSOLUTE ranges (every
// pan/zoom commit — the state you're in after zooming into a flight's tail —
// carries millisecond bounds via toISOString) enforce the upper bound too:
// flooring it amputates every point in (floor(end), end] — up to 999ms of
// the NEWEST data inside the rendered domain (getTimeRangeBounds keeps exact
// ms). At 250Hz that's up to ~250 real points: the line stops visibly short
// of the right edge while the crosshair (5%-of-range tolerance) still
// reports values there.
// ============================================================================

/** Newest sample lands mid-second — the shape every real ULog tail has. */
const T_EDGE = Date.parse("2026-08-14T10:07:56.789Z");

/** 250Hz raw series ending exactly at T_EDGE. */
function denseFlight(spanMs: number): Array<{ timestamp: string; value: number }> {
  const points: Array<{ timestamp: string; value: number }> = [];
  for (let t = T_EDGE - spanMs; t <= T_EDGE; t += 4) {
    points.push({
      timestamp: new Date(t).toISOString(),
      value: Math.sin(t / 5_000) * 10,
    });
  }
  return points;
}

/** Rightmost x-pixel any line-geometry vertex reaches. */
function rightmostGeometryPx(
  data: Array<{ x: number; y: number }>,
  xScale: (x: number) => number,
): number {
  const geo = createLineGeometry(data, xScale, (y) => y, [1, 1, 1], 2, true, 1);
  let max = -Infinity;
  for (let i = 0; i < geo.positions.length; i += 2) {
    max = Math.max(max, geo.positions[i]);
  }
  return max;
}

/**
 * Replay ChartPanel's committed-absolute pipeline (the post-pan/zoom state):
 * resolveClipWindow + clipPointsToWindow → xy conversion → visible-window
 * slice (xWindow = the absolute bounds, per chart-panel's visibleWindow) →
 * envelope expansion → M4 decimation → geometry against the rendered domain
 * (getTimeRangeBounds: the exact committed bounds).
 */
function renderCommittedPipeline(
  points: Array<{ timestamp: string; value: number; min?: number; max?: number }>,
  startMs: number,
  endMs: number,
  chartWidth = 600,
) {
  const timeRange: TimeRange = {
    type: "absolute",
    value: `${new Date(startMs).toISOString()}/${new Date(endMs).toISOString()}`,
  };
  const clipWindow = resolveClipWindow(timeRange, { m: points }, endMs + 60_000);
  const clipped = clipPointsToWindow(points, clipWindow);

  const base: EnvelopePoint[] = clipped.map((p) => ({
    x: Date.parse(p.timestamp),
    y: p.value,
    ...(p.min !== undefined && { min: p.min }),
    ...(p.max !== undefined && { max: p.max }),
  }));

  const sliced = sliceSeriesToWindow(base, startMs, endMs);
  const enveloped = expandBucketEnvelope(
    sliced,
    envelopeGapCeilingMs(endMs - startMs, chartWidth),
  );

  const pointBudget = Math.max(200, chartWidth * 2);
  const columns = Math.max(100, Math.ceil(pointBudget / 2));
  const rendered =
    enveloped.length <= pointBudget
      ? enveloped
      : m4Decimate(enveloped, columns);

  const domain: [number, number] = [startMs, endMs];
  const xScale = (x: number) =>
    ((x - domain[0]) / (domain[1] - domain[0])) * chartWidth;

  return { rendered, domain, xScale, chartWidth };
}

describe("committed zoom into the data's tail (newest samples at domain max)", () => {
  it("keeps every sub-second point the committed window includes", () => {
    const points = denseFlight(60_000);
    // Brush/zoom into the last 10s; the gesture's right edge lands just past
    // the newest sample — exactly how you inspect a flight's tail.
    const startMs = T_EDGE - 10_000;
    const endMs = T_EDGE + 100;
    const { rendered, xScale, chartWidth } = renderCommittedPipeline(
      points,
      startMs,
      endMs,
    );

    const inDomain = points.filter((p) => {
      const x = Date.parse(p.timestamp);
      return x >= startMs && x <= endMs;
    });
    expect(inDomain.length).toBeGreaterThan(2000); // scenario sanity

    // The regression: the clip floored the upper bound to the last whole
    // second and ate the final ~789ms of real points inside the domain —
    // pre-fix, ZERO rendered points lay past that floor. (M4 decimation may
    // thin the tail region, but its bins always retain points there.)
    const floorSecMs = Math.floor(endMs / 1000) * 1000;
    const pastFloor = rendered.filter((p) => p.x > floorSecMs);
    expect(pastFloor.length).toBeGreaterThanOrEqual(8);

    // The newest sample itself must survive to the rendered series…
    expect(rendered[rendered.length - 1].x).toBe(T_EDGE);

    // …and produce geometry at its pixel, not stop short of the right edge.
    const latestPx = xScale(T_EDGE);
    expect(latestPx).toBeLessThanOrEqual(chartWidth);
    expect(rightmostGeometryPx(rendered, xScale)).toBeGreaterThanOrEqual(
      latestPx - 0.5,
    );
  });

  it("honors committed millisecond bounds exactly in the clip window", () => {
    const start = "2026-08-14T10:07:46.789Z";
    const end = "2026-08-14T10:07:56.889Z";
    const w = resolveClipWindow(
      { type: "absolute", value: `${start}/${end}` },
      {},
      T_EDGE + 999_999,
    );
    expect(w.enforceUpper).toBe(true);
    expect(w.startIso).toBe(start);
    expect(w.endIso).toBe(end);

    // A newest sample inside the window but past the last whole second must
    // survive the clip.
    const kept = clipPointsToWindow(
      [{ timestamp: "2026-08-14T10:07:56.789Z", value: 1 }],
      w,
    );
    expect(kept).toHaveLength(1);
  });

  it("commits of the live view itself keep the newest data (end = latest + margin)", () => {
    // Committing the live domain [latest − range + margin, latest + margin]
    // as an absolute range (any gesture does this) must never eat the tail,
    // whatever the anchor's sub-second phase.
    const points = denseFlight(60_000);
    const margin = 60_000 * 0.015;
    const { rendered } = renderCommittedPipeline(
      points,
      T_EDGE + margin - 60_000,
      T_EDGE + margin,
    );
    expect(rendered[rendered.length - 1].x).toBe(T_EDGE);
  });
});

describe("live edge-anchored window (data ends at the domain anchor)", () => {
  const rangeMs = 60_000;
  const margin = rangeMs * 0.015;

  it("renders raw 250Hz geometry all the way to the newest point", () => {
    const points = denseFlight(rangeMs);
    const timeRange: TimeRange = { type: "relative", value: "1m" };
    // Live relative pipeline: clip (lower bound only), no slice (xWindow is
    // null for relative ranges), M4, domain anchored to latest + margin.
    const clipWindow = resolveClipWindow(timeRange, { m: points }, T_EDGE + 500);
    const clipped = clipPointsToWindow(points, clipWindow);
    const base = clipped.map((p) => ({ x: Date.parse(p.timestamp), y: p.value }));
    const chartWidth = 600;
    const pointBudget = Math.max(200, chartWidth * 2);
    const columns = Math.max(100, Math.ceil(pointBudget / 2));
    const rendered =
      base.length <= pointBudget ? base : m4Decimate(base, columns);

    const domain: [number, number] = [T_EDGE + margin - rangeMs, T_EDGE + margin];
    const xScale = (x: number) =>
      ((x - domain[0]) / (domain[1] - domain[0])) * chartWidth;

    // M4 must keep the point AT the data extent's max (bin index clamps into
    // the last bin), and geometry must reach its pixel.
    expect(rendered[rendered.length - 1].x).toBe(T_EDGE);
    expect(rightmostGeometryPx(rendered, xScale)).toBeGreaterThanOrEqual(
      xScale(T_EDGE) - 0.5,
    );
  });

  it("keeps the density-fallback tail (min/avg/max buckets) through envelope + M4", () => {
    // Bucketed rows as the dense fallback serves them: bucket-START stamps,
    // 35ms interval, min/avg/max envelopes; last bucket at the domain anchor.
    const interval = 35;
    const lastBucket = Math.floor(T_EDGE / interval) * interval;
    // Walk the bucket grid backward from the newest bucket so the series
    // genuinely ends AT lastBucket (rangeMs is not a multiple of interval).
    const firstBucket = lastBucket - interval * Math.floor(rangeMs / interval);
    const points: EnvelopePoint[] = [];
    for (let t = firstBucket; t <= lastBucket; t += interval) {
      const v = Math.sin(t / 5_000) * 10;
      points.push({ x: t, y: v, min: v - 0.5, max: v + 0.5 });
    }
    const chartWidth = 600;
    const enveloped = expandBucketEnvelope(
      points,
      envelopeGapCeilingMs(rangeMs, chartWidth),
    );
    const pointBudget = Math.max(200, chartWidth * 2);
    const columns = Math.max(100, Math.ceil(pointBudget / 2));
    const rendered =
      enveloped.length <= pointBudget
        ? enveloped
        : m4Decimate(enveloped, columns);

    // The tail survives decimation: the final rendered point sits at or past
    // the last bucket's x (its +δ max lobe lies BEYOND the newest avg x and
    // must not fall out of the decimation's bin range). Note M4 may replace
    // the avg point itself with the column's first/min/max/last — that's its
    // contract; the drawn envelope extent is what must be preserved.
    expect(rendered[rendered.length - 1].x).toBeGreaterThanOrEqual(lastBucket);
    expect(rendered[rendered.length - 1].x).toBeLessThanOrEqual(
      lastBucket + interval / 4,
    );

    const domain: [number, number] = [
      lastBucket + margin - rangeMs,
      lastBucket + margin,
    ];
    const xScale = (x: number) =>
      ((x - domain[0]) / (domain[1] - domain[0])) * chartWidth;
    expect(rightmostGeometryPx(rendered, xScale)).toBeGreaterThanOrEqual(
      xScale(lastBucket) - 0.5,
    );
  });

  it("transient gesture slice with the right edge past the newest point keeps the tail verbatim", () => {
    // During a live-mode gesture the visible window IS the live domain:
    // right edge = latest + margin, i.e. nothing lies beyond the edge. The
    // slice must return the final real point untouched — the edge-clamp
    // interpolation applies only when a point exists BEYOND the edge.
    const base = denseFlight(rangeMs).map((p) => ({
      x: Date.parse(p.timestamp),
      y: p.value,
    }));
    const sliced = sliceSeriesToWindow(
      base,
      T_EDGE + margin - rangeMs,
      T_EDGE + margin,
    );
    expect(sliced[sliced.length - 1].x).toBe(T_EDGE);
    expect(sliced[sliced.length - 1].y).toBe(base[base.length - 1].y);
  });
});

describe("clipPointsToWindow", () => {
  const timeRange: TimeRange = { type: "relative", value: "15m" };

  it("returns the input array by reference when every point is inside", () => {
    const points = flightSeries();
    const w = resolveClipWindow(timeRange, { m: points }, T_END);
    expect(clipPointsToWindow(points, w)).toBe(points);
  });

  it("keeps points lacking timestamps", () => {
    const w = resolveClipWindow(
      { type: "absolute", value: "2026-08-14T10:07:00.000Z/2026-08-14T10:08:00.000Z" },
      {},
      T_END,
    );
    const points = [
      { timestamp: "2026-08-14T10:05:00.000Z", value: 2 }, // before window
      { value: 1 }, // no timestamp — always kept
      { timestamp: "2026-08-14T10:07:30.000Z", value: 3 },
    ];
    expect(clipPointsToWindow(points, w)).toEqual([points[1], points[2]]);
  });
});
