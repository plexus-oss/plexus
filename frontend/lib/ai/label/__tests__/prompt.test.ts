import { describe, expect, it } from "vitest";
import {
  buildLabelPrompt,
  clampObservations,
  summarizeSeries,
  MAX_LABEL_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_OBSERVATIONS,
  type SeriesPoint,
} from "@/lib/ai/label/prompt";

const WINDOW_START = Date.UTC(2026, 0, 1, 0, 0, 0);
const WINDOW_END = Date.UTC(2026, 0, 1, 1, 0, 0); // 1h window

/** One point per minute across the window. */
function minutePoints(values: number[]): SeriesPoint[] {
  return values.map((value, i) => ({
    timestamp: new Date(WINDOW_START + i * 60_000).toISOString(),
    value,
  }));
}

describe("summarizeSeries", () => {
  it("computes stats and window-anchored buckets", () => {
    const s = summarizeSeries(
      "pi4:cpu_temp",
      minutePoints([10, 20, 30, 40]),
      WINDOW_START,
      WINDOW_END,
    );
    expect(s).not.toBeNull();
    expect(s!.key).toBe("pi4:cpu_temp");
    expect(s!.count).toBe(4);
    expect(s!.min).toBe(10);
    expect(s!.max).toBe(40);
    expect(s!.mean).toBe(25);
    expect(s!.firstMs).toBe(WINDOW_START);
    expect(s!.lastMs).toBe(WINDOW_START + 3 * 60_000);
    // 4 points → at most 4 buckets, each carrying real values
    expect(s!.buckets.length).toBeLessThanOrEqual(4);
    for (const b of s!.buckets) {
      expect(b.t).toBeGreaterThanOrEqual(WINDOW_START);
      expect(b.t).toBeLessThanOrEqual(WINDOW_END);
      expect(b.min).toBeLessThanOrEqual(b.avg);
      expect(b.max).toBeGreaterThanOrEqual(b.avg);
    }
  });

  it("caps the downsample at 40 buckets", () => {
    const many = minutePoints(
      Array.from({ length: 60 }, (_, i) => Math.sin(i / 5) * 100),
    );
    const s = summarizeSeries("a:m", many, WINDOW_START, WINDOW_END);
    expect(s!.buckets.length).toBeLessThanOrEqual(40);
    expect(s!.buckets.length).toBeGreaterThan(30); // dense data fills buckets
  });

  it("uses pre-aggregated min/max when the tier provides them", () => {
    const pts: SeriesPoint[] = [
      { timestamp: new Date(WINDOW_START).toISOString(), value: 50, min: 5, max: 95 },
    ];
    const s = summarizeSeries("a:m", pts, WINDOW_START, WINDOW_END);
    expect(s!.min).toBe(5);
    expect(s!.max).toBe(95);
  });

  it("returns null for empty or unparseable series", () => {
    expect(summarizeSeries("a:m", [], WINDOW_START, WINDOW_END)).toBeNull();
    expect(
      summarizeSeries(
        "a:m",
        [{ timestamp: "not-a-date", value: 1 }],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBeNull();
  });
});

describe("buildLabelPrompt", () => {
  it("includes window, series keys, and existing annotations", () => {
    const series = summarizeSeries(
      "sat:wheel_rpm",
      minutePoints([1, 2, 3]),
      WINDOW_START,
      WINDOW_END,
    )!;
    const prompt = buildLabelPrompt({
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
      series: [series],
      annotations: [
        { label: "bearing fault", startMs: WINDOW_START + 60_000, endMs: null },
      ],
    });
    expect(prompt).toContain(`${WINDOW_START} to ${WINDOW_END}`);
    expect(prompt).toContain('"sat:wheel_rpm"');
    expect(prompt).toContain("bearing fault");
    expect(prompt).toContain("(point)");
  });

  it("says none when there are no annotations", () => {
    const prompt = buildLabelPrompt({
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
      series: [],
      annotations: [],
    });
    expect(prompt).toContain("Existing annotations in window: none.");
  });
});

describe("clampObservations", () => {
  const ok = {
    start_ms: WINDOW_START + 1000,
    end_ms: WINDOW_START + 2000,
    label: "Spike",
    note: "pi4:cpu_temp peaks",
    confidence: "high",
  };

  it("passes valid observations through", () => {
    const out = clampObservations({ observations: [ok] }, WINDOW_START, WINDOW_END);
    expect(out).toEqual([ok]);
  });

  it("clamps times into the requested window", () => {
    const out = clampObservations(
      {
        observations: [
          { ...ok, start_ms: WINDOW_START - 999_999, end_ms: WINDOW_END + 999_999 },
        ],
      },
      WINDOW_START,
      WINDOW_END,
    );
    expect(out[0].start_ms).toBe(WINDOW_START);
    expect(out[0].end_ms).toBe(WINDOW_END);
  });

  it("collapses ranges that clamp to nothing into points", () => {
    const out = clampObservations(
      {
        observations: [
          { ...ok, start_ms: WINDOW_END + 10, end_ms: WINDOW_END + 20 },
        ],
      },
      WINDOW_START,
      WINDOW_END,
    );
    expect(out[0].start_ms).toBe(WINDOW_END);
    expect(out[0].end_ms).toBeNull();
  });

  it("drops observations with unparseable fields", () => {
    const out = clampObservations(
      {
        observations: [
          { ...ok, start_ms: "yesterday" }, // non-numeric start
          { ...ok, label: "   " }, // empty label
          { ...ok, confidence: "certain" }, // invalid enum
          { ...ok, end_ms: "later" }, // non-numeric end
          ok,
        ],
      },
      WINDOW_START,
      WINDOW_END,
    );
    expect(out).toEqual([ok]);
  });

  it("truncates label and note, and caps the list", () => {
    const long = {
      ...ok,
      label: "x".repeat(500),
      note: "y".repeat(500),
    };
    const out = clampObservations(
      { observations: Array.from({ length: 9 }, () => long) },
      WINDOW_START,
      WINDOW_END,
    );
    expect(out).toHaveLength(MAX_OBSERVATIONS);
    expect(out[0].label).toHaveLength(MAX_LABEL_LENGTH);
    expect(out[0].note).toHaveLength(MAX_NOTE_LENGTH);
  });

  it("returns empty for garbage payloads", () => {
    expect(clampObservations(null, WINDOW_START, WINDOW_END)).toEqual([]);
    expect(clampObservations({}, WINDOW_START, WINDOW_END)).toEqual([]);
    expect(clampObservations({ observations: "no" }, WINDOW_START, WINDOW_END)).toEqual([]);
  });
});
