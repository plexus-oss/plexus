import { describe, it, expect } from "vitest";
import {
  classifySignal,
  MIN_CLASSIFY_POINTS,
  MAX_STATE_DISTINCT,
  type SignalSamplePoint,
} from "../classify-signal";

/** n points evenly spaced across spanMs, values from a generator. */
function series(
  n: number,
  spanMs: number,
  value: (i: number) => number,
  startMs = 1_700_000_000_000,
): SignalSamplePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: startMs + (n === 1 ? 0 : (i * spanMs) / (n - 1)),
    value: value(i),
  }));
}

describe("classifySignal — state signals", () => {
  it("classifies a low-cardinality integer signal as stepped scatter", () => {
    // Flight mode: 0/1/2 held over an hour, dense sampling.
    const pts = series(120, 3_600_000, (i) => Math.floor(i / 40));
    const verdict = classifySignal(pts);
    expect(verdict.chartType).toBe("scatter");
    expect(verdict.stepped).toBe(true);
    expect(verdict.reason).toContain("state signal");
  });

  it("treats a binary flag as a state signal even when sparse", () => {
    // The state rule wins before the sparse rule — same honest verdict.
    const pts = series(20, 86_400_000, (i) => (i % 2 === 0 ? 0 : 1));
    const verdict = classifySignal(pts);
    expect(verdict.chartType).toBe("scatter");
    expect(verdict.stepped).toBe(true);
  });

  it("accepts float-noise integers (2.0000000001 is integer-ish)", () => {
    const pts = series(60, 3_600_000, (i) => (i % 3) + 1e-10);
    expect(classifySignal(pts).stepped).toBe(true);
  });

  it("does not call 9+ distinct integer levels a state signal", () => {
    const pts = series(300, 3_600_000, (i) => i % (MAX_STATE_DISTINCT + 1));
    const verdict = classifySignal(pts);
    expect(verdict.stepped).toBeUndefined();
    expect(verdict.chartType).toBe("line");
  });

  it("does not call low-cardinality non-integer levels a state signal", () => {
    // Two fractional levels: falls through to density rules (dense → line).
    const pts = series(300, 3_600_000, (i) => (i % 2 === 0 ? 0.5 : 1.5));
    const verdict = classifySignal(pts);
    expect(verdict.stepped).toBeUndefined();
    expect(verdict.chartType).toBe("line");
  });
});

describe("classifySignal — sparse signals", () => {
  it("classifies sparse continuous data as scatter", () => {
    // 20 float samples across a day: median gap ≫ span/50.
    const pts = series(20, 86_400_000, (i) => Math.sin(i / 3) * 10 + 0.123);
    const verdict = classifySignal(pts);
    expect(verdict.chartType).toBe("scatter");
    expect(verdict.stepped).toBeUndefined();
    expect(verdict.reason).toContain("sparse");
  });

  it("keeps a dense burst within a huge window honest by its sampled span", () => {
    // 300 points over 30s: the span is what was sampled, so this is dense.
    const pts = series(300, 30_000, (i) => Math.sin(i / 10) + 0.001 * i);
    expect(classifySignal(pts).chartType).toBe("line");
  });
});

describe("classifySignal — dense signals", () => {
  it("classifies a dense continuous signal as line", () => {
    const pts = series(300, 3_600_000, (i) => 20 + Math.sin(i / 20) * 2.5);
    const verdict = classifySignal(pts);
    expect(verdict.chartType).toBe("line");
    expect(verdict.reason).toContain("dense");
  });

  it("accepts ISO timestamp strings (the query API's wire format)", () => {
    const pts: SignalSamplePoint[] = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(1_700_000_000_000 + i * 1_000).toISOString(),
      value: 3.14 + i * 0.01,
    }));
    expect(classifySignal(pts).chartType).toBe("line");
  });
});

describe("classifySignal — tiny and degenerate samples", () => {
  it("keeps the line default below the evidence threshold", () => {
    const pts = series(MIN_CLASSIFY_POINTS - 1, 3_600_000, (i) => i % 2);
    const verdict = classifySignal(pts);
    expect(verdict.chartType).toBe("line");
    expect(verdict.reason).toContain("insufficient");
  });

  it("returns line for an empty sample", () => {
    expect(classifySignal([]).chartType).toBe("line");
  });

  it("classifies a constant series as line", () => {
    const pts = series(50, 3_600_000, () => 42);
    const verdict = classifySignal(pts);
    expect(verdict.chartType).toBe("line");
    expect(verdict.reason).toContain("constant");
  });

  it("ignores non-finite values and unparseable timestamps", () => {
    const good = series(120, 3_600_000, (i) => Math.floor(i / 40));
    const bad: SignalSamplePoint[] = [
      { timestamp: "not-a-date", value: 1 },
      { timestamp: 1_700_000_000_000, value: NaN },
      { timestamp: 1_700_000_000_500, value: Infinity },
    ];
    const verdict = classifySignal([...bad, ...good]);
    expect(verdict.chartType).toBe("scatter");
    expect(verdict.stepped).toBe(true);
  });

  it("sorts out-of-order timestamps before measuring gaps", () => {
    const pts = series(100, 3_600_000, (i) => 1 + i * 0.37);
    const shuffled = [...pts].reverse();
    expect(classifySignal(shuffled).chartType).toBe("line");
  });
});
