import { describe, it, expect } from "vitest";
import { isOwnCommit } from "../use-chart-pan-zoom";

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
