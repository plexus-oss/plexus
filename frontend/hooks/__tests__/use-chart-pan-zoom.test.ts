import { describe, it, expect } from "vitest";
import {
  MIN_RANGE,
  MAX_RANGE,
  clampRange,
  isOwnCommit,
} from "../use-chart-pan-zoom";

/**
 * The hook's DOM gesture wiring needs a browser; what IS unit-testable in
 * this node-env suite is the reset-baseline bookkeeping: `isOwnCommit`
 * decides whether a timeRange prop change is the hook's own zoom/pan commit
 * echoing back (baseline survives → double-click/Escape still resets) or an
 * external change from the picker (baseline is invalidated).
 */
describe("isOwnCommit (pan-zoom reset baseline)", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const end = Date.parse("2026-01-01T01:00:00.000Z");
  const absolute = (s: number, e: number) => ({
    type: "absolute" as const,
    value: `${new Date(s).toISOString()}/${new Date(e).toISOString()}`,
  });

  it("recognizes the exact absolute range the hook committed", () => {
    expect(isOwnCommit(absolute(start, end), { start, end })).toBe(true);
  });

  it("tolerates sub-second rounding from callers re-deriving bounds", () => {
    expect(
      isOwnCommit(absolute(start + 400, end - 400), { start, end }),
    ).toBe(true);
  });

  it("rejects a different absolute range (external picker change)", () => {
    expect(
      isOwnCommit(absolute(start - 60_000, end), { start, end }),
    ).toBe(false);
  });

  it("rejects relative ranges (Go Live / preset picks reset the baseline)", () => {
    expect(
      isOwnCommit({ type: "relative", value: "15m" }, { start, end }),
    ).toBe(false);
  });

  it("rejects when no commit has been recorded", () => {
    expect(isOwnCommit(absolute(start, end), null)).toBe(false);
  });

  it("rejects open-ended or malformed absolute values", () => {
    expect(
      isOwnCommit(
        { type: "absolute", value: new Date(start).toISOString() },
        { start, end },
      ),
    ).toBe(false);
    expect(
      isOwnCommit({ type: "absolute", value: "not-a-date/also-not" }, { start, end }),
    ).toBe(false);
  });
});

describe("clampRange (zoom span floor/ceiling)", () => {
  it("floors at 10ms — deep enough to frame individual 500Hz-class samples", () => {
    expect(MIN_RANGE).toBe(10);
    expect(clampRange(0)).toBe(MIN_RANGE);
    expect(clampRange(9)).toBe(MIN_RANGE);
    expect(clampRange(-100)).toBe(MIN_RANGE);
  });

  it("passes sub-second and sub-10s spans through unclamped (old 10s floor is gone)", () => {
    expect(clampRange(10)).toBe(10);
    expect(clampRange(50)).toBe(50);
    expect(clampRange(500)).toBe(500);
    expect(clampRange(2_500)).toBe(2_500);
    expect(clampRange(9_999)).toBe(9_999);
  });

  it("leaves ordinary spans untouched and caps at 90 days", () => {
    expect(clampRange(15 * 60 * 1000)).toBe(15 * 60 * 1000);
    expect(clampRange(MAX_RANGE)).toBe(MAX_RANGE);
    expect(clampRange(MAX_RANGE + 1)).toBe(MAX_RANGE);
  });
});
