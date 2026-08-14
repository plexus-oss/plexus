import { describe, it, expect } from "vitest";
import {
  getNiceTimeInterval,
  getNiceTimeTicks,
} from "../base-chart";

/**
 * Deep-zoom tick ladder: time axes step in a 1/2/5 pattern down to 10ms
 * (the pan-zoom floor, where individual 500Hz-class samples resolve), and
 * ticks stay anchored to absolute wall-clock boundaries.
 */
describe("getNiceTimeInterval (sub-10s tick-step ladder, targetCount 6)", () => {
  // span → expected step, mirroring how ChartRoot asks for ticks (count 6,
  // so idealInterval = span / 5 rounds up to the next ladder rung).
  const table: Array<[spanMs: number, stepMs: number]> = [
    [10, 10], // 10ms window (zoom floor) → 10ms steps
    [50, 10], // 50ms → 10ms
    [100, 20], // 100ms → 20ms
    [250, 50], // 250ms → 50ms
    [500, 100], // 500ms → 100ms
    [1_000, 200], // 1s → 200ms
    [2_500, 500], // 2.5s → 500ms
    [5_000, 1_000], // 5s → 1s
    [10_000, 2_000], // 10s → 2s
  ];

  it.each(table)("a %dms span steps at %dms", (span, step) => {
    expect(getNiceTimeInterval(span, 6)).toBe(step);
  });

  it("keeps wall-clock rungs above the sub-second ladder (30s span → 10s steps)", () => {
    expect(getNiceTimeInterval(30_000, 6)).toBe(10_000);
    expect(getNiceTimeInterval(60_000, 6)).toBe(15_000);
  });

  it("does not flood long spans with day ticks (90d span → multi-day rung)", () => {
    const ninetyDays = 90 * 24 * 3_600_000;
    expect(getNiceTimeInterval(ninetyDays, 6)).toBe(30 * 24 * 3_600_000);
  });
});

describe("getNiceTimeTicks (wall-clock anchoring at deep zoom)", () => {
  it("anchors sub-second ticks to absolute boundaries", () => {
    const start = Date.parse("2026-01-01T00:00:31.204Z");
    const ticks = getNiceTimeTicks([start, start + 50], 6);
    // 50ms span → 10ms steps at :31.210, :31.220, … :31.250
    expect(ticks).toEqual([
      Date.parse("2026-01-01T00:00:31.210Z"),
      Date.parse("2026-01-01T00:00:31.220Z"),
      Date.parse("2026-01-01T00:00:31.230Z"),
      Date.parse("2026-01-01T00:00:31.240Z"),
      Date.parse("2026-01-01T00:00:31.250Z"),
    ]);
  });

  it("frames a 10ms floor window with at least two ticks", () => {
    const start = Date.parse("2026-01-01T00:00:31.200Z");
    const ticks = getNiceTimeTicks([start, start + 10], 6);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(start);
      expect(t).toBeLessThanOrEqual(start + 10);
    }
  });
});
