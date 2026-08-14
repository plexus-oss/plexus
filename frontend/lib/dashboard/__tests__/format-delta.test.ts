import { describe, it, expect } from "vitest";
import { formatDeltaMs } from "../format-delta";

describe("formatDeltaMs (pin tracker Δt readout)", () => {
  it("formats sub-second deltas in milliseconds", () => {
    expect(formatDeltaMs(0)).toBe("0ms");
    expect(formatDeltaMs(0.4)).toBe("0ms");
    expect(formatDeltaMs(240)).toBe("240ms");
    expect(formatDeltaMs(999.4)).toBe("999ms");
  });

  it("formats seconds with trimmed decimal precision", () => {
    expect(formatDeltaMs(3240)).toBe("3.24s");
    expect(formatDeltaMs(3200)).toBe("3.2s");
    expect(formatDeltaMs(3000)).toBe("3s");
    expect(formatDeltaMs(59_990)).toBe("59.99s");
  });

  it("formats minutes as m + s, dropping a zero-second remainder", () => {
    expect(formatDeltaMs(134_000)).toBe("2m 14s");
    expect(formatDeltaMs(120_000)).toBe("2m");
    expect(formatDeltaMs(60_000)).toBe("1m");
  });

  it("formats hours as h + m, dropping a zero-minute remainder", () => {
    expect(formatDeltaMs(3_780_000)).toBe("1h 3m");
    expect(formatDeltaMs(7_200_000)).toBe("2h");
  });

  it("formats days as d + h", () => {
    expect(formatDeltaMs(93_600_000)).toBe("1d 2h");
    expect(formatDeltaMs(172_800_000)).toBe("2d");
  });

  it("returns magnitude only — callers own the sign", () => {
    expect(formatDeltaMs(-3240)).toBe("3.24s");
    expect(formatDeltaMs(-134_000)).toBe("2m 14s");
  });
});
