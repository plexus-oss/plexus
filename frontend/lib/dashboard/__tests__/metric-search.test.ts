import { describe, it, expect } from "vitest";
import {
  tokenizeQuery,
  matchesAllTokens,
  truncateMiddle,
} from "../metric-search";

describe("tokenizeQuery", () => {
  it("splits on runs of whitespace and lowercases", () => {
    expect(tokenizeQuery("Gyro  0")).toEqual(["gyro", "0"]);
    expect(tokenizeQuery("  sensor\tgyro \n")).toEqual(["sensor", "gyro"]);
  });

  it("returns no tokens for blank input", () => {
    expect(tokenizeQuery("")).toEqual([]);
    expect(tokenizeQuery("   ")).toEqual([]);
  });
});

describe("matchesAllTokens (all-terms-must-match)", () => {
  it('matches "gyro 0" against sensor_combined.gyro_rad[0]', () => {
    expect(
      matchesAllTokens(
        "sensor_combined.gyro_rad[0]",
        tokenizeQuery("gyro 0"),
      ),
    ).toBe(true);
  });

  it("requires every token to match", () => {
    expect(
      matchesAllTokens(
        "sensor_combined.gyro_rad[0]",
        tokenizeQuery("gyro accel"),
      ),
    ).toBe(false);
  });

  it("is case-insensitive on the haystack", () => {
    expect(matchesAllTokens("Battery.Voltage", tokenizeQuery("volt"))).toBe(
      true,
    );
  });

  it("matches everything when there are no tokens", () => {
    expect(matchesAllTokens("anything", [])).toBe(true);
  });

  it("supports source-qualified haystacks (source + metric terms)", () => {
    expect(
      matchesAllTokens(
        "drone-1 sensor_combined.gyro_rad[0]",
        tokenizeQuery("drone gyro"),
      ),
    ).toBe(true);
  });
});

describe("truncateMiddle", () => {
  it("returns short strings unchanged", () => {
    expect(truncateMiddle("gyro", 10)).toBe("gyro");
  });

  it("keeps both ends and stays within the budget", () => {
    const out = truncateMiddle("sensor_combined.gyro_rad[0]", 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toContain("…");
    expect(out.startsWith("sensor_c")).toBe(true);
    expect(out.endsWith("rad[0]")).toBe(true);
  });

  it("keeps the exact-length string intact", () => {
    expect(truncateMiddle("abcdefghij", 10)).toBe("abcdefghij");
  });

  it("never truncates below a usable budget", () => {
    expect(truncateMiddle("abcdefghij", 4)).toBe("abcdefghij");
  });
});
