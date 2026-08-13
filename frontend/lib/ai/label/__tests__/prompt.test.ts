import { describe, expect, it } from "vitest";
import {
  buildLabelPrompt,
  clampObservations,
  clampRemember,
  summarizeSeries,
  LABEL_RESPONSE_SCHEMA,
  MAX_CONTEXT_CHARS,
  MAX_LABEL_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_OBSERVATIONS,
  MAX_REMEMBER,
  MAX_REMEMBER_LENGTH,
  type SeriesPoint,
  type SourceContextItem,
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

  const CONTEXT_HEADER =
    "Context about these sources (user-maintained — treat as ground truth about the subject):";

  it("renders the source-context section: note bodies, file/link name+description", () => {
    const context: SourceContextItem[] = [
      {
        slug: "pi4",
        name: "Deployment",
        description: null,
        content: "Runs in the garage, ambient ~15C in winter",
      },
      {
        slug: "pi4",
        name: "Calibration PDF",
        description: "Sensor offsets after 2026-01 recal",
        content: null, // file item — name + description only
      },
    ];
    const prompt = buildLabelPrompt({
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
      series: [],
      annotations: [],
      context,
    });
    expect(prompt).toContain(CONTEXT_HEADER);
    expect(prompt).toContain(
      "- [pi4] Deployment: Runs in the garage, ambient ~15C in winter",
    );
    expect(prompt).toContain(
      "- [pi4] Calibration PDF: Sensor offsets after 2026-01 recal",
    );
  });

  it("omits the context section when there is no context", () => {
    const prompt = buildLabelPrompt({
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
      series: [],
      annotations: [],
    });
    expect(prompt).not.toContain("Context about these sources");
  });

  it("caps context at ~1500 chars, dropping oldest items and noting the cut", () => {
    // Newest-first (as fetched); each item ~400 chars → only the first few fit.
    const context: SourceContextItem[] = Array.from({ length: 8 }, (_, i) => ({
      slug: "pi4",
      name: `Note ${i}`,
      description: null,
      content: `${i}`.repeat(400),
    }));
    const prompt = buildLabelPrompt({
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
      series: [],
      annotations: [],
      context,
    });
    expect(prompt).toContain("- [pi4] Note 0"); // newest kept
    expect(prompt).not.toContain("Note 7"); // oldest dropped
    expect(prompt).toContain("(older context truncated to fit)");

    const section = prompt.slice(prompt.indexOf(CONTEXT_HEADER));
    const itemChars = section
      .split("\n")
      .filter((l) => l.startsWith("- ["))
      .reduce((n, l) => n + l.length, 0);
    expect(itemChars).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });

  it("slices a single oversized newest context item instead of dropping it", () => {
    const prompt = buildLabelPrompt({
      windowStartMs: WINDOW_START,
      windowEndMs: WINDOW_END,
      series: [],
      annotations: [],
      context: [
        { slug: "pi4", name: "Huge", description: null, content: "z".repeat(5000) },
      ],
    });
    expect(prompt).toContain("- [pi4] Huge: zzz");
    expect(prompt).toContain("…");
    expect(prompt).toContain("(older context truncated to fit)");
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

describe("clampRemember", () => {
  it("passes valid items through, trimmed", () => {
    const out = clampRemember({
      remember: [{ content: "  Baseline RPM sits near 1200 overnight  " }],
    });
    expect(out).toEqual([{ content: "Baseline RPM sits near 1200 overnight" }]);
  });

  it("truncates content and caps the list at MAX_REMEMBER", () => {
    const out = clampRemember({
      remember: Array.from({ length: 5 }, () => ({
        content: "x".repeat(500),
      })),
    });
    expect(out).toHaveLength(MAX_REMEMBER);
    expect(out[0].content).toHaveLength(MAX_REMEMBER_LENGTH);
  });

  it("drops empty, non-string, and malformed items", () => {
    const out = clampRemember({
      remember: [
        { content: "   " },
        { content: 42 },
        "just a string",
        null,
        { note: "wrong key" },
        { content: "keeper" },
      ],
    });
    expect(out).toEqual([{ content: "keeper" }]);
  });

  it("returns empty when remember is absent or garbage", () => {
    expect(clampRemember(null)).toEqual([]);
    expect(clampRemember({})).toEqual([]);
    expect(clampRemember({ remember: "no" })).toEqual([]);
    expect(clampRemember({ observations: [] })).toEqual([]);
  });
});

describe("LABEL_RESPONSE_SCHEMA", () => {
  it("includes an optional remember array capped at MAX_REMEMBER", () => {
    const props = LABEL_RESPONSE_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(props.remember).toBeDefined();
    expect(props.remember.maxItems).toBe(MAX_REMEMBER);
    const items = props.remember.items as {
      properties: { content: { maxLength: number } };
      required: string[];
    };
    expect(items.properties.content.maxLength).toBe(MAX_REMEMBER_LENGTH);
    expect(items.required).toEqual(["content"]);
    // remember is optional — observations stays the only required key
    expect(LABEL_RESPONSE_SCHEMA.required).toEqual(["observations"]);
  });
});
