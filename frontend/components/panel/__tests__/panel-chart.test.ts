import { describe, it, expect } from "vitest";
import { seriesSpanMs, makeTimeFormatter } from "@/components/panel/panel-chart";

describe("seriesSpanMs", () => {
  it("spans across all series' points", () => {
    const span = seriesSpanMs([
      { name: "a", data: [{ x: 1000, y: 1 }, { x: 5000, y: 2 }] },
      { name: "b", data: [{ x: 3000, y: 1 }, { x: 9000, y: 2 }] },
    ]);
    expect(span).toBe(8000); // 9000 - 1000
  });

  it("is 0 for empty input", () => {
    expect(seriesSpanMs([])).toBe(0);
    expect(seriesSpanMs([{ name: "a", data: [] }])).toBe(0);
  });
});

describe("makeTimeFormatter", () => {
  const ms = Date.parse("2026-01-02T15:04:05.000Z");

  it("uses a date format for multi-day spans", () => {
    // > 3 days → month/day only (no time component).
    const s = makeTimeFormatter(10 * 86_400_000)(ms);
    expect(s).toMatch(/\d/);
    expect(s).not.toMatch(/:/); // no clock time
  });

  it("includes clock time for sub-day spans", () => {
    const s = makeTimeFormatter(3 * 3_600_000)(ms);
    expect(s).toMatch(/:/); // has HH:MM
  });

  it("includes seconds for very short spans", () => {
    const s = makeTimeFormatter(30_000)(ms);
    expect(s.split(":").length).toBe(3); // HH:MM:SS
  });
});
