import { describe, expect, it } from "vitest";
import {
  downsampleLTTB,
  envelopeGapCeilingMs,
  expandBucketEnvelope,
  m4Decimate,
  MAX_ENVELOPE_GAP_PX,
  sliceSeriesToWindow,
  type DataPoint,
  type EnvelopePoint,
} from "@/lib/data-utils";

function assertTimeOrdered(points: DataPoint[]) {
  for (let i = 1; i < points.length; i++) {
    expect(points[i].x).toBeGreaterThanOrEqual(points[i - 1].x);
  }
}

describe("m4Decimate", () => {
  it("returns empty input unchanged", () => {
    const empty: DataPoint[] = [];
    expect(m4Decimate(empty, 100)).toBe(empty);
  });

  it("returns a single point unchanged", () => {
    const one = [{ x: 5, y: 1 }];
    expect(m4Decimate(one, 100)).toBe(one);
  });

  it("returns input unchanged when columns < 1", () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i }));
    expect(m4Decimate(data, 0)).toBe(data);
  });

  it("passes through bins holding ≤ 4 points verbatim", () => {
    // 10 points across 5 bins → 2 per bin, all preserved as-is.
    const data = Array.from({ length: 10 }, (_, i) => ({
      x: i,
      y: Math.sin(i),
    }));
    const out = m4Decimate(data, 5);
    expect(out).toEqual(data);
    // Same object references — no copies for pass-through points.
    expect(out[0]).toBe(data[0]);
    expect(out[9]).toBe(data[9]);
  });

  it("preserves a 1-point spike in a 10k-point series at any width", () => {
    const n = 10_000;
    const spikeIdx = 6_137;
    const data = Array.from({ length: n }, (_, i) => ({
      x: i,
      y: i === spikeIdx ? 500 : Math.sin(i / 50),
    }));
    for (const columns of [10, 50, 100, 337, 800, 1920]) {
      const out = m4Decimate(data, columns);
      const spike = out.find((p) => p.y === 500);
      expect(spike, `spike lost at ${columns} columns`).toBeDefined();
      expect(spike!.x).toBe(spikeIdx);
    }
  });

  it("preserves both min and max extremes per pixel column", () => {
    // Alternating extreme dips and peaks; both envelope edges must survive.
    const data = Array.from({ length: 5_000 }, (_, i) => ({
      x: i,
      y: i === 1234 ? -900 : i === 4321 ? 900 : 0,
    }));
    const out = m4Decimate(data, 100);
    expect(out.some((p) => p.y === -900)).toBe(true);
    expect(out.some((p) => p.y === 900)).toBe(true);
  });

  it("emits time-ordered output with no duplicated points", () => {
    const data = Array.from({ length: 3_000 }, (_, i) => ({
      x: i,
      y: Math.sin(i / 7) * Math.cos(i / 13),
    }));
    const out = m4Decimate(data, 200);
    assertTimeOrdered(out);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).not.toBe(out[i - 1]);
    }
  });

  it("dedupes overlapping roles (first=min, last=max on monotone data)", () => {
    // Strictly increasing series: every dense bin's first IS its min and its
    // last IS its max → exactly 2 points per bin.
    const data = Array.from({ length: 1_000 }, (_, i) => ({ x: i, y: i }));
    const out = m4Decimate(data, 100);
    expect(out.length).toBe(200);
    assertTimeOrdered(out);
  });

  it("keeps the global first and last points (bin-edge clamping)", () => {
    const data = Array.from({ length: 1_001 }, (_, i) => ({
      x: i * 3.7,
      y: Math.random(),
    }));
    const out = m4Decimate(data, 97);
    expect(out[0]).toBe(data[0]);
    expect(out[out.length - 1]).toBe(data[data.length - 1]);
  });

  it("caps output at 4 points per column", () => {
    const data = Array.from({ length: 50_000 }, (_, i) => ({
      x: i,
      y: Math.random(),
    }));
    const out = m4Decimate(data, 250);
    expect(out.length).toBeLessThanOrEqual(4 * 250);
    assertTimeOrdered(out);
  });

  it("handles a constant series (min=max=first=last per bin)", () => {
    const data = Array.from({ length: 1_000 }, (_, i) => ({ x: i, y: 42 }));
    const out = m4Decimate(data, 50);
    // first/min/max/last collapse to first+last per bin.
    expect(out.length).toBe(100);
    expect(out.every((p) => p.y === 42)).toBe(true);
  });

  it("handles zero x-span (all points share a timestamp)", () => {
    const data = Array.from({ length: 100 }, (_, i) => ({
      x: 1000,
      y: i === 50 ? 99 : i,
    }));
    const out = m4Decimate(data, 40);
    // One bin: first, min, max, last.
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out.some((p) => p.y === 99)).toBe(true); // max survives
    expect(out.some((p) => p.y === 0)).toBe(true); // min survives
  });

  it("beats LTTB on spike retention (regression guard for the swap)", () => {
    const n = 10_000;
    const data = Array.from({ length: n }, (_, i) => ({
      x: i,
      y: i === 5_000 ? 500 : 0,
    }));
    const m4 = m4Decimate(data, 100);
    expect(m4.some((p) => p.y === 500)).toBe(true);
    // LTTB also finds this lone spike (largest triangle), but M4 must never
    // do worse — and must stay bounded.
    expect(m4.length).toBeLessThanOrEqual(400);
    expect(downsampleLTTB(data, 200).length).toBe(200);
  });
});

describe("expandBucketEnvelope", () => {
  it("returns the same reference when no point has spread", () => {
    const raw: EnvelopePoint[] = Array.from({ length: 10 }, (_, i) => ({
      x: i * 1000,
      y: i,
    }));
    expect(expandBucketEnvelope(raw)).toBe(raw);
  });

  it("returns the same reference when min/max equal the average", () => {
    const flat: EnvelopePoint[] = Array.from({ length: 5 }, (_, i) => ({
      x: i * 1000,
      y: 3,
      min: 3,
      max: 3,
    }));
    expect(expandBucketEnvelope(flat)).toBe(flat);
  });

  it("returns empty and single-point inputs unchanged", () => {
    const empty: EnvelopePoint[] = [];
    expect(expandBucketEnvelope(empty)).toBe(empty);
    const one: EnvelopePoint[] = [{ x: 0, y: 1, min: 0, max: 2 }];
    expect(expandBucketEnvelope(one)).toBe(one);
  });

  it("expands each bucket into min → avg → max with avg at its own x", () => {
    const buckets: EnvelopePoint[] = [
      { x: 0, y: 5, min: 1, max: 9 },
      { x: 100, y: 6, min: 2, max: 10 },
      { x: 200, y: 4, min: 0, max: 8 },
    ];
    const out = expandBucketEnvelope(buckets);
    expect(out).toEqual([
      { x: -25, y: 1 },
      { x: 0, y: 5 },
      { x: 25, y: 9 },
      { x: 75, y: 2 },
      { x: 100, y: 6 },
      { x: 125, y: 10 },
      { x: 175, y: 0 },
      { x: 200, y: 4 },
      { x: 225, y: 8 },
    ]);
  });

  it("keeps output strictly time-ordered, including irregular gaps", () => {
    const buckets: EnvelopePoint[] = [
      { x: 0, y: 1, min: 0, max: 2 },
      { x: 60, y: 1, min: 0, max: 2 },
      { x: 1000, y: 1, min: 0, max: 2 }, // gap jump (missing buckets)
      { x: 1060, y: 1, min: 0, max: 2 },
    ];
    const out = expandBucketEnvelope(buckets);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].x).toBeGreaterThan(out[i - 1].x);
    }
  });

  it("emits only one-sided extremes when only one side has spread", () => {
    const buckets: EnvelopePoint[] = [
      { x: 0, y: 5, min: 5, max: 12 }, // max-only spread
      { x: 100, y: 5, min: 1, max: 5 }, // min-only spread
    ];
    const out = expandBucketEnvelope(buckets);
    expect(out).toEqual([
      { x: 0, y: 5 },
      { x: 25, y: 12 },
      { x: 75, y: 1 },
      { x: 100, y: 5 },
    ]);
  });

  it("passes raw points through untouched within a mixed series", () => {
    // Merged store can hold rollup history followed by raw realtime points.
    const mixed: EnvelopePoint[] = [
      { x: 0, y: 5, min: 1, max: 9 },
      { x: 100, y: 5, min: 1, max: 9 },
      { x: 200, y: 7 },
      { x: 300, y: 8 },
    ];
    const out = expandBucketEnvelope(mixed);
    expect(out).toContainEqual({ x: 200, y: 7 });
    expect(out).toContainEqual({ x: 300, y: 8 });
    // Aggregated points expanded, raw ones not.
    expect(out.length).toBe(3 + 3 + 1 + 1);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].x).toBeGreaterThan(out[i - 1].x);
    }
  });

  it("never invents values — every y comes from a bucket's min/avg/max", () => {
    const buckets: EnvelopePoint[] = Array.from({ length: 50 }, (_, i) => ({
      x: i * 60_000,
      y: 10 + (i % 5),
      min: 10 + (i % 5) - 3,
      max: 10 + (i % 5) + 7,
    }));
    const allowed = new Set<number>();
    for (const b of buckets) {
      allowed.add(b.y);
      if (b.min !== undefined) allowed.add(b.min);
      if (b.max !== undefined) allowed.add(b.max);
    }
    const out = expandBucketEnvelope(buckets);
    for (const p of out) expect(allowed.has(p.y)).toBe(true);
  });

  it("survives M4 decimation on top (spike stays after both stages)", () => {
    // The full chart pipeline: envelope expansion → M4. A single hot bucket's
    // max must be visible after decimation to any width.
    const buckets: EnvelopePoint[] = Array.from({ length: 5_000 }, (_, i) => ({
      x: i * 60_000,
      y: 0,
      min: -1,
      max: i === 2_500 ? 800 : 1,
    }));
    const expanded = expandBucketEnvelope(buckets);
    const out = m4Decimate(expanded, 150);
    expect(out.some((p) => p.y === 800)).toBe(true);
  });

  it("suppresses expansion entirely when every gap exceeds maxGapMs", () => {
    // Deep zoom: 3.6s buckets under a 10s window — each bucket spans hundreds
    // of pixels, so the ±δ triplets would draw fake intra-bucket structure.
    const buckets: EnvelopePoint[] = Array.from({ length: 4 }, (_, i) => ({
      x: i * 3_600,
      y: 5,
      min: 1,
      max: 9,
    }));
    const out = expandBucketEnvelope(buckets, 1_000);
    // Identity preserved — no-op copies would churn downstream memos.
    expect(out).toBe(buckets);
  });

  it("gates per point: only buckets within maxGapMs expand", () => {
    const buckets: EnvelopePoint[] = [
      { x: 0, y: 5, min: 1, max: 9 },
      { x: 100, y: 5, min: 1, max: 9 },
      { x: 10_000, y: 5, min: 1, max: 9 }, // isolated — gap 9900 > gate
    ];
    const out = expandBucketEnvelope(buckets, 500);
    // First two expand (gap 100), the isolated one stays a bare average.
    expect(out).toEqual([
      { x: -25, y: 1 },
      { x: 0, y: 5 },
      { x: 25, y: 9 },
      { x: 75, y: 1 },
      { x: 100, y: 5 },
      { x: 125, y: 9 },
      { x: 10_000, y: 5 },
    ]);
  });

  it("default maxGapMs (Infinity) matches ungated behavior", () => {
    const buckets: EnvelopePoint[] = [
      { x: 0, y: 5, min: 1, max: 9 },
      { x: 100, y: 6, min: 2, max: 10 },
    ];
    expect(expandBucketEnvelope(buckets)).toEqual(
      expandBucketEnvelope(buckets, Infinity),
    );
  });
});

describe("envelopeGapCeilingMs", () => {
  it("returns Infinity when span or width is unknown", () => {
    expect(envelopeGapCeilingMs(0, 800)).toBe(Infinity);
    expect(envelopeGapCeilingMs(60_000, 0)).toBe(Infinity);
    expect(envelopeGapCeilingMs(-5, -5)).toBe(Infinity);
  });

  it("scales as ms-per-pixel × MAX_ENVELOPE_GAP_PX", () => {
    // 2h over 800px → 9s/px → ceiling 9s × MAX px.
    const spanMs = 2 * 3_600_000;
    expect(envelopeGapCeilingMs(spanMs, 800)).toBeCloseTo(
      (spanMs / 800) * MAX_ENVELOPE_GAP_PX,
    );
  });

  it("keeps 1h rollups under a 7d window expandable (~5px buckets)", () => {
    const ceiling = envelopeGapCeilingMs(7 * 86_400_000, 800);
    expect(ceiling).toBeGreaterThan(3_600_000);
  });

  it("gates 3.6s buckets once zoomed to a 10s window", () => {
    const ceiling = envelopeGapCeilingMs(10_000, 800);
    expect(ceiling).toBeLessThan(3_600);
  });
});

describe("sliceSeriesToWindow", () => {
  const series = (xs: number[], y = (x: number) => x): EnvelopePoint[] =>
    xs.map((x) => ({ x, y: y(x) }));

  it("returns the same reference when nothing needs trimming", () => {
    const data = series([0, 10, 20, 30]);
    expect(sliceSeriesToWindow(data, -5, 40)).toBe(data);
    // Points within pad slack also count as untrimmed.
    expect(sliceSeriesToWindow(data, 0, 30)).toBe(data);
    const empty: EnvelopePoint[] = [];
    expect(sliceSeriesToWindow(empty, 0, 10)).toBe(empty);
  });

  it("returns input unchanged for degenerate windows (end ≤ start)", () => {
    const data = series([0, 10, 20]);
    expect(sliceSeriesToWindow(data, 10, 10)).toBe(data);
    expect(sliceSeriesToWindow(data, 20, 10)).toBe(data);
  });

  it("keeps in-window points by reference and clamps edge segments", () => {
    const data = series([0, 100, 200, 300, 400, 500]);
    const out = sliceSeriesToWindow(data, 150, 350, 0);
    // Interpolated boundary at 150, raw 200/300 by reference, boundary at 350.
    expect(out).toEqual([
      { x: 150, y: 150 },
      { x: 200, y: 200 },
      { x: 300, y: 300 },
      { x: 350, y: 350 },
    ]);
    expect(out[1]).toBe(data[2]);
    expect(out[2]).toBe(data[3]);
  });

  it("interpolates boundary crossings at the padded edge in f64", () => {
    // y jumps 0 → 1000 across the window edge; the clamp must sit exactly on
    // the segment, not at the offscreen neighbor.
    const data: EnvelopePoint[] = [
      { x: 0, y: 0 },
      { x: 1_000, y: 1_000 },
    ];
    const out = sliceSeriesToWindow(data, 400, 600, 0.05);
    // pad = 10 → edges at 390 / 610, linearly interpolated y = x here.
    expect(out).toEqual([
      { x: 390, y: 390 },
      { x: 610, y: 610 },
    ]);
  });

  it("draws the crossing segment when the window falls between samples", () => {
    // The deep-zoom case: a 10ms window between 3.6s-spaced buckets must
    // still render the honest connecting line, not a blank chart.
    const t = 1_755_000_000_000; // epoch-ms scale, where f32 would fail
    const data: EnvelopePoint[] = [
      { x: t, y: 10 },
      { x: t + 3_600, y: 20 },
    ];
    const out = sliceSeriesToWindow(data, t + 1_000, t + 1_000 + 10);
    expect(out.length).toBe(2);
    const [p0, p1] = out;
    expect(p0.x).toBeCloseTo(t + 999.5);
    expect(p1.x).toBeCloseTo(t + 1_010.5);
    // y interpolated on the segment (slope 10/3600 per ms).
    expect(p0.y).toBeCloseTo(10 + (999.5 / 3_600) * 10);
    expect(p1.y).toBeCloseTo(10 + (1_010.5 / 3_600) * 10);
    // All retained coordinates stay within ~one pad of the window.
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(t + 1_000 - 10);
      expect(p.x).toBeLessThanOrEqual(t + 1_010 + 10);
    }
  });

  it("returns empty when the window is wholly outside the data", () => {
    const data = series([100, 200, 300]);
    expect(sliceSeriesToWindow(data, 0, 50)).toEqual([]);
    expect(sliceSeriesToWindow(data, 400, 500)).toEqual([]);
  });

  it("preserves min/max envelope fields on retained points", () => {
    const data: EnvelopePoint[] = [
      { x: 0, y: 5, min: 1, max: 9 },
      { x: 100, y: 6, min: 2, max: 10 },
      { x: 200, y: 7, min: 3, max: 11 },
    ];
    const out = sliceSeriesToWindow(data, 90, 110, 0);
    expect(out).toEqual([
      { x: 90, y: expect.closeTo(5.9, 5) },
      { x: 100, y: 6, min: 2, max: 10 },
      { x: 110, y: expect.closeTo(6.1, 5) },
    ]);
    expect(out[1]).toBe(data[1]);
  });

  it("returns input unchanged for NaN window bounds (never drops data)", () => {
    const data = series([0, 10, 20, 30]);
    expect(sliceSeriesToWindow(data, NaN, 100)).toBe(data);
    expect(sliceSeriesToWindow(data, 0, NaN)).toBe(data);
    expect(sliceSeriesToWindow(data, NaN, NaN)).toBe(data);
  });

  it("never yields fewer than 2 points when ≥2 points lie inside the window", () => {
    // The rendered-domain invariant: whatever the window's alignment to the
    // data, every in-window point must survive the slice.
    const data = series(Array.from({ length: 901 }, (_, i) => i * 200)); // 3min @5Hz
    const last = data[data.length - 1].x;
    for (const [start, end] of [
      [last - 60_000, last + 900] as const, // live-style: tail window
      [last - 60_000, last + 60_000] as const, // window extends past the data
      [-60_000, 30_000] as const, // window starts before the data
      [100, 500] as const, // deep zoom inside the data
    ]) {
      const out = sliceSeriesToWindow(data, start, end);
      const inWindow = data.filter((p) => p.x >= start && p.x <= end);
      expect(out.length).toBeGreaterThanOrEqual(Math.max(inWindow.length, 2));
      for (const p of inWindow) expect(out).toContain(p);
    }
  });

  it("keeps the tail plus one boundary interpolant when only the tail overlaps", () => {
    const data = series([0, 100, 200, 300, 400, 500]);
    const out = sliceSeriesToWindow(data, 450, 900, 0);
    expect(out).toEqual([
      { x: 450, y: 450 }, // edge-clamped crossing into the window
      { x: 500, y: 500 }, // real tail sample, by reference
    ]);
    expect(out[1]).toBe(data[5]);
  });

  it("handles duplicate timestamps at the boundary without NaN", () => {
    const data: EnvelopePoint[] = [
      { x: 100, y: 1 },
      { x: 100, y: 5 },
      { x: 500, y: 9 },
    ];
    const out = sliceSeriesToWindow(data, 300, 400, 0);
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});
