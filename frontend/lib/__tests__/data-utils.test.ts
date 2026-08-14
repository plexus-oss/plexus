import { describe, expect, it } from "vitest";
import {
  downsampleLTTB,
  expandBucketEnvelope,
  m4Decimate,
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
});
