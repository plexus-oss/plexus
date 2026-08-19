import { describe, it, expect } from "vitest";
import { embedDataToSeries } from "@/components/embed/plexus-panel";

describe("embedDataToSeries", () => {
  it("maps each metric key to a series of {x:epochMs, y:value}", () => {
    const series = embedDataToSeries({
      "src1:bandwidth": [
        { timestamp: "2026-01-01T00:00:00.000Z", value: 10, source_id: "src1" },
        { timestamp: "2026-01-01T00:01:00.000Z", value: 20, source_id: "src1" },
      ],
    });
    expect(series).toHaveLength(1);
    expect(series[0].name).toBe("src1:bandwidth");
    expect(series[0].data).toEqual([
      { x: Date.parse("2026-01-01T00:00:00.000Z"), y: 10 },
      { x: Date.parse("2026-01-01T00:01:00.000Z"), y: 20 },
    ]);
  });

  it("assigns colors in order when provided", () => {
    const series = embedDataToSeries(
      { a: [], b: [] },
      ["#7c4dff", "#00e5ff"],
    );
    expect(series[0].color).toBe("#7c4dff");
    expect(series[1].color).toBe("#00e5ff");
  });

  it("drops points with an unparseable timestamp or non-finite value", () => {
    const series = embedDataToSeries({
      m: [
        { timestamp: "not-a-date", value: 5, source_id: "s" },
        { timestamp: "2026-01-01T00:00:00.000Z", value: Number.NaN, source_id: "s" },
        { timestamp: "2026-01-01T00:00:00.000Z", value: 7, source_id: "s" },
      ],
    });
    expect(series[0].data).toEqual([
      { x: Date.parse("2026-01-01T00:00:00.000Z"), y: 7 },
    ]);
  });

  it("returns an empty array for no metrics", () => {
    expect(embedDataToSeries({})).toEqual([]);
  });
});
