import { describe, it, expect } from "vitest";
import { ratio, type TransformPoint } from "../functions";

/** Build a point at `base + offsetMs` with the given value. */
const BASE = Date.parse("2026-01-01T00:00:00.000Z");
function pt(offsetMs: number, value: number): TransformPoint {
  return { timestamp: new Date(BASE + offsetMs).toISOString(), value };
}

describe("ratio (timestamp-aligned)", () => {
  it("pairs identical timestamp grids index-for-index (fast path)", () => {
    const a = [pt(0, 10), pt(1000, 20), pt(2000, 30)];
    const b = [pt(0, 2), pt(1000, 4), pt(2000, 5)];
    expect(ratio(a, b)).toEqual([
      { timestamp: a[0].timestamp, value: 5 },
      { timestamp: a[1].timestamp, value: 5 },
      { timestamp: a[2].timestamp, value: 6 },
    ]);
  });

  it("skips zero denominators on the identical-grid fast path", () => {
    const a = [pt(0, 10), pt(1000, 20)];
    const b = [pt(0, 0), pt(1000, 4)];
    expect(ratio(a, b)).toEqual([{ timestamp: a[1].timestamp, value: 5 }]);
  });

  it("aligns mismatched rates (1Hz numerator vs 10Hz denominator) by timestamp", () => {
    // Numerator at 0s, 1s, 2s; denominator at 100ms steps with value = t(ms).
    const a = [pt(0, 100), pt(1000, 200), pt(2000, 300)];
    const b: TransformPoint[] = [];
    for (let t = 0; t <= 2000; t += 100) b.push(pt(t, t === 0 ? 1 : t));
    // Index pairing would divide by b[0..2] = 1, 100, 200 — wrong.
    // Timestamp alignment divides by the denominator AT each numerator time.
    expect(ratio(a, b)).toEqual([
      { timestamp: a[0].timestamp, value: 100 / 1 },
      { timestamp: a[1].timestamp, value: 200 / 1000 },
      { timestamp: a[2].timestamp, value: 300 / 2000 },
    ]);
  });

  it("matches the nearest denominator when timestamps are offset", () => {
    // Denominator sampled 400ms after the numerator.
    const a = [pt(0, 10), pt(1000, 20), pt(2000, 30)];
    const b = [pt(400, 2), pt(1400, 4), pt(2400, 6)];
    expect(ratio(a, b)).toEqual([
      { timestamp: a[0].timestamp, value: 5 },
      { timestamp: a[1].timestamp, value: 5 },
      { timestamp: a[2].timestamp, value: 5 },
    ]);
  });

  it("drops numerator points falling in a denominator gap (beyond 60s tolerance)", () => {
    // Denominator has a 5-minute hole; numerator keeps reporting through it.
    const a = [pt(0, 10), pt(120_000, 20), pt(150_000, 30), pt(300_000, 40)];
    const b = [pt(0, 2), pt(300_000, 4)];
    expect(ratio(a, b)).toEqual([
      { timestamp: a[0].timestamp, value: 5 },
      // 120s and 150s points: nearest denominator is >60s away → dropped.
      { timestamp: a[3].timestamp, value: 10 },
    ]);
  });

  it("skips zero denominators when aligning by timestamp", () => {
    const a = [pt(0, 10), pt(1000, 20)];
    const b = [pt(100, 0), pt(1100, 4)];
    expect(ratio(a, b)).toEqual([{ timestamp: a[1].timestamp, value: 5 }]);
  });

  it("returns empty when either side is empty", () => {
    expect(ratio([], [pt(0, 1)])).toEqual([]);
    expect(ratio([pt(0, 1)], [])).toEqual([]);
  });

  it("does not blindly index-pair equal-length series with different grids", () => {
    // Same length, but denominator covers a different window — the old
    // index-pairing produced 3 misaligned quotients here.
    const a = [pt(0, 10), pt(1000, 20), pt(2000, 30)];
    const b = [pt(2000, 2), pt(3000, 4), pt(4000, 8)];
    expect(ratio(a, b)).toEqual([
      // All numerator points are within 60s of the t=2s denominator point,
      // so 0s/1s match it (value 2) instead of index-pairing to b[0]/b[1].
      { timestamp: a[0].timestamp, value: 5 },
      { timestamp: a[1].timestamp, value: 10 },
      { timestamp: a[2].timestamp, value: 15 },
    ]);
  });
});
