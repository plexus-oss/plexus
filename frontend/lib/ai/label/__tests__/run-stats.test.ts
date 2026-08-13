import { describe, it, expect } from "vitest";
import { computeLabelRunStats } from "@/lib/ai/label/run-stats";

const NOW = Date.parse("2026-08-13T12:00:00Z");
const iso = (hoursAgo: number) =>
  new Date(NOW - hoursAgo * 60 * 60 * 1000).toISOString();

const run = (
  overrides: Partial<Parameters<typeof computeLabelRunStats>[0][number]> = {},
) => ({
  created_at: iso(1),
  provider: "anthropic",
  latency_ms: 1000,
  input_tokens: 100,
  output_tokens: 50,
  observations: [],
  ...overrides,
});

describe("computeLabelRunStats", () => {
  it("returns zeros/nulls for no runs", () => {
    const s = computeLabelRunStats([], NOW);
    expect(s.runs).toBe(0);
    expect(s.acceptanceRate).toBeNull();
    expect(s.medianLatencyMs).toBeNull();
    expect(s.tokens).toBe(0);
  });

  it("counts only runs inside the 7d window", () => {
    const s = computeLabelRunStats(
      [run(), run({ created_at: iso(6 * 24) }), run({ created_at: iso(8 * 24) })],
      NOW,
    );
    expect(s.runs).toBe(2);
  });

  it("acceptance = applied / (applied + dismissed); pending excluded", () => {
    const s = computeLabelRunStats(
      [
        run({
          observations: [
            { verdict: "applied" },
            { verdict: "applied" },
            { verdict: "dismissed" },
            { verdict: null },
          ],
        }),
        run({ observations: [{ verdict: "applied" }] }),
      ],
      NOW,
    );
    expect(s.applied).toBe(3);
    expect(s.dismissed).toBe(1);
    expect(s.acceptanceRate).toBeCloseTo(0.75);
  });

  it("acceptance is null when every proposal is still pending", () => {
    const s = computeLabelRunStats(
      [run({ observations: [{ verdict: null }] })],
      NOW,
    );
    expect(s.acceptanceRate).toBeNull();
  });

  it("median latency: odd and even counts, nulls skipped", () => {
    expect(
      computeLabelRunStats(
        [run({ latency_ms: 100 }), run({ latency_ms: 900 }), run({ latency_ms: 300 })],
        NOW,
      ).medianLatencyMs,
    ).toBe(300);
    expect(
      computeLabelRunStats(
        [run({ latency_ms: 100 }), run({ latency_ms: 300 }), run({ latency_ms: null })],
        NOW,
      ).medianLatencyMs,
    ).toBe(200);
  });

  it("sums tokens and splits by provider", () => {
    const s = computeLabelRunStats(
      [
        run({ input_tokens: 100, output_tokens: 50 }),
        run({ provider: "ollama", input_tokens: 10, output_tokens: 5 }),
        run({ provider: "ollama", input_tokens: null, output_tokens: null }),
      ],
      NOW,
    );
    expect(s.tokens).toBe(165);
    expect(s.tokensByProvider).toEqual({ anthropic: 150, ollama: 15 });
  });
});
