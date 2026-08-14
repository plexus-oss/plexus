import { describe, expect, it } from "vitest";
import {
  bucketIntervalMs,
  decideRawTier,
  MIN_BUCKET_MS,
  TARGET_BUCKETS,
} from "@/lib/db/adaptive-tier";

const MINUTE = 60_000;
const HOUR = 3_600_000;

describe("decideRawTier", () => {
  it("keeps sparse series under the budget on the raw path", () => {
    // 1Hz fleet data: 70 rows in a 70s window, budget 10k — raw, untouched.
    expect(decideRawTier(70, 10_000, 70_000)).toEqual({ tier: "raw" });
  });

  it("keeps a series exactly at the budget on the raw path", () => {
    // The probe fetches budget+1; a full window of exactly `budget` rows
    // returns `budget` rows and must serve them verbatim.
    expect(decideRawTier(10_000, 10_000, HOUR)).toEqual({ tier: "raw" });
  });

  it("keeps an empty result on the raw path", () => {
    expect(decideRawTier(0, 10_000, HOUR)).toEqual({ tier: "raw" });
  });

  it("falls back to bucketed the moment the probe exceeds the budget", () => {
    const decision = decideRawTier(10_001, 10_000, HOUR);
    expect(decision.tier).toBe("bucketed");
  });

  it("buckets a dense 250Hz x 70s window at a sub-second interval", () => {
    // ~17.5k rows against a 10k budget: bucketed, 70_000ms / 2000 = 35ms.
    expect(decideRawTier(10_001, 10_000, 70_000)).toEqual({
      tier: "bucketed",
      intervalMs: 35,
    });
  });

  it("derives the interval from the span, giving ~TARGET_BUCKETS buckets", () => {
    const spanMs = 30 * MINUTE;
    const decision = decideRawTier(50_001, 50_000, spanMs);
    expect(decision).toEqual({
      tier: "bucketed",
      intervalMs: Math.ceil(spanMs / TARGET_BUCKETS), // 900ms
    });
    if (decision.tier === "bucketed") {
      const buckets = spanMs / decision.intervalMs;
      expect(buckets).toBeGreaterThan(TARGET_BUCKETS * 0.9);
      expect(buckets).toBeLessThanOrEqual(TARGET_BUCKETS);
    }
  });
});

describe("bucketIntervalMs", () => {
  it("targets ~2000 buckets across the span", () => {
    expect(bucketIntervalMs(HOUR)).toBe(1800); // 1h → 1.8s buckets
    expect(bucketIntervalMs(70_000)).toBe(35); // 70s → 35ms buckets
  });

  it("rounds non-integer widths up (never more than TARGET_BUCKETS buckets)", () => {
    // 61s / 2000 = 30.5 → 31ms
    expect(bucketIntervalMs(61_000)).toBe(31);
    expect(61_000 / bucketIntervalMs(61_000)).toBeLessThanOrEqual(
      TARGET_BUCKETS,
    );
  });

  it("clamps to the 10ms floor for short spans", () => {
    // 10s / 2000 = 5ms → clamped to 10ms
    expect(bucketIntervalMs(10_000)).toBe(MIN_BUCKET_MS);
    // 4s / 2000 = 2ms → clamped
    expect(bucketIntervalMs(4_000)).toBe(MIN_BUCKET_MS);
  });

  it("spans at the clamp boundary are exact", () => {
    // 20s / 2000 = exactly 10ms — at the floor, not clamped past it.
    expect(bucketIntervalMs(20_000)).toBe(10);
  });

  it("degenerate spans (0, negative, NaN) fall back to the floor", () => {
    expect(bucketIntervalMs(0)).toBe(MIN_BUCKET_MS);
    expect(bucketIntervalMs(-5)).toBe(MIN_BUCKET_MS);
    expect(bucketIntervalMs(Number.NaN)).toBe(MIN_BUCKET_MS);
  });

  it("honors custom target/floor overrides", () => {
    expect(bucketIntervalMs(10_000, 1000, 1)).toBe(10);
    expect(bucketIntervalMs(10_000, 100_000, 1)).toBe(1);
  });
});
