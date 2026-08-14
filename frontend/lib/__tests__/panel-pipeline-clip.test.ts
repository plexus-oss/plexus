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
import { m4Decimate, sliceSeriesToWindow } from "@/lib/data-utils";
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
