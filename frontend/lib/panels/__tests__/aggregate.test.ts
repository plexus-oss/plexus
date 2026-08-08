import { describe, expect, it } from "vitest";
import {
  aggregateOverWindow,
  avgOverWindow,
  countOverWindow,
  sumOverWindow,
  type AggregatablePoint,
} from "@/lib/panels/aggregate";

const ts = (i: number) => new Date(2026, 0, 1, 0, i).toISOString();

/** Raw-tier points as queryTelemetryAdaptive now emits them: sum=value, count=1. */
function rawPoint(i: number, value: number): AggregatablePoint {
  return { timestamp: ts(i), value, sum: value, count: 1 };
}

describe("aggregate over raw points", () => {
  // The counter scenario from the bug: every event has value=1.
  const counterRaw = Array.from({ length: 9 }, (_, i) => rawPoint(i, 1));

  it("sum totals the events", () => {
    expect(sumOverWindow(counterRaw)).toBe(9);
    expect(aggregateOverWindow(counterRaw, "sum")).toBe(9);
  });

  it("count totals the events", () => {
    expect(countOverWindow(counterRaw)).toBe(9);
    expect(aggregateOverWindow(counterRaw, "count")).toBe(9);
  });

  it("avg is the true mean", () => {
    expect(avgOverWindow(counterRaw)).toBe(1);
  });

  it("min/max/last use point values", () => {
    const pts = [rawPoint(0, 2), rawPoint(1, 10), rawPoint(2, 4)];
    expect(aggregateOverWindow(pts, "min")).toBe(2);
    expect(aggregateOverWindow(pts, "max")).toBe(10);
    expect(aggregateOverWindow(pts, "last")).toBe(4);
  });
});

describe("aggregate over downsampled points (bucket avg + sum/count)", () => {
  // Same 9 value=1 events as above, rolled into two buckets: 3 + 6 events.
  // Each bucket's `value` is the bucket AVERAGE (1.0) — summing values would
  // count buckets (2), the historical bug.
  const counterBuckets: AggregatablePoint[] = [
    { timestamp: ts(0), value: 1, sum: 3, count: 3 },
    { timestamp: ts(1), value: 1, sum: 6, count: 6 },
  ];

  it("sum matches the raw total, not the bucket count", () => {
    expect(sumOverWindow(counterBuckets)).toBe(9);
    expect(aggregateOverWindow(counterBuckets, "sum")).toBe(9);
  });

  it("count matches the raw event count", () => {
    expect(countOverWindow(counterBuckets)).toBe(9);
    expect(aggregateOverWindow(counterBuckets, "count")).toBe(9);
  });

  it("avg weights buckets by event count (Σsum/Σcount), not mean of bucket avgs", () => {
    // Raw events [2,4,6] and [10,13]: true avg = 35/5 = 7.
    // Mean of bucket averages would be (4 + 11.5)/2 = 7.75 — wrong.
    const uneven: AggregatablePoint[] = [
      { timestamp: ts(0), value: 4, sum: 12, count: 3 },
      { timestamp: ts(1), value: 11.5, sum: 23, count: 2 },
    ];
    expect(avgOverWindow(uneven)).toBe(7);
    expect(aggregateOverWindow(uneven, "avg")).toBe(7);
  });

  it("downsampled totals equal their raw equivalents", () => {
    const raw = [2, 4, 6, 10, 13].map((v, i) => rawPoint(i, v));
    const buckets: AggregatablePoint[] = [
      { timestamp: ts(0), value: 4, sum: 12, count: 3 },
      { timestamp: ts(1), value: 11.5, sum: 23, count: 2 },
    ];
    for (const agg of ["sum", "count", "avg"] as const) {
      expect(aggregateOverWindow(buckets, agg)).toBe(
        aggregateOverWindow(raw, agg),
      );
    }
  });
});

describe("legacy points without sum/count (realtime WS, old payloads)", () => {
  const legacy: AggregatablePoint[] = [
    { timestamp: ts(0), value: 2 },
    { timestamp: ts(1), value: 4 },
    { timestamp: ts(2), value: 9 },
  ];

  it("sum falls back to Σ(value) — old behavior", () => {
    expect(aggregateOverWindow(legacy, "sum")).toBe(15);
  });

  it("count falls back to one event per point", () => {
    expect(aggregateOverWindow(legacy, "count")).toBe(3);
  });

  it("avg falls back to the plain mean of values", () => {
    expect(aggregateOverWindow(legacy, "avg")).toBe(5);
  });

  it("mixed legacy + downsampled points combine correctly", () => {
    const mixed: AggregatablePoint[] = [
      { timestamp: ts(0), value: 2 }, // one raw event
      { timestamp: ts(1), value: 1, sum: 4, count: 4 }, // four events of 1
    ];
    expect(aggregateOverWindow(mixed, "sum")).toBe(6);
    expect(aggregateOverWindow(mixed, "count")).toBe(5);
    expect(aggregateOverWindow(mixed, "avg")).toBe(6 / 5);
  });
});

describe("edge cases", () => {
  it("empty input returns null (count: zero events)", () => {
    expect(aggregateOverWindow([], "sum")).toBeNull();
    expect(aggregateOverWindow([], "avg")).toBeNull();
    expect(aggregateOverWindow([], "last")).toBeNull();
    expect(aggregateOverWindow([], "count")).toBe(0);
  });

  it("non-numeric values are skipped", () => {
    const pts = [
      rawPoint(0, 3),
      { timestamp: ts(1), value: Number.NaN },
      rawPoint(2, 5),
    ];
    expect(aggregateOverWindow(pts, "sum")).toBe(8);
    expect(aggregateOverWindow(pts, "count")).toBe(2);
    expect(aggregateOverWindow(pts, "avg")).toBe(4);
    expect(aggregateOverWindow(pts, "last")).toBe(5);
  });
});
