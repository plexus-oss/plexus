/**
 * Terminal tool builders — the label-flow proposals that originated from the
 * chart popover now live in the Terminal. These builders are pure: they parse
 * the model's tool input into the exact Apply payloads the product routes
 * accept (the annotations POST and the source-context POST).
 */
import { describe, it, expect } from "vitest";
import {
  parseEpochMs,
  buildAnnotationProposal,
  buildRememberProposal,
} from "../tools";

describe("parseEpochMs", () => {
  it("accepts numbers, numeric strings, and ISO timestamps", () => {
    expect(parseEpochMs(1755000000000)).toBe(1755000000000);
    expect(parseEpochMs("1755000000000")).toBe(1755000000000);
    expect(parseEpochMs("2026-08-13T12:00:00.000Z")).toBe(
      Date.parse("2026-08-13T12:00:00.000Z"),
    );
  });

  it("rejects garbage", () => {
    expect(parseEpochMs(undefined)).toBeNull();
    expect(parseEpochMs("")).toBeNull();
    expect(parseEpochMs("not a date")).toBeNull();
    expect(parseEpochMs(NaN)).toBeNull();
  });
});

describe("buildAnnotationProposal", () => {
  const input = {
    source: "drone-001",
    metric: "battery.voltage",
    start_ms: 1755000000000,
    end_ms: 1755000180000,
    label: "Voltage sag",
    note: "battery.voltage fell 12.1→10.8 V",
  };

  it("builds the exact annotations POST body the labeling flow sends", () => {
    const p = buildAnnotationProposal(input);
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("annotation");
    expect(p!.endpoint).toBe("/api/annotations");
    expect(p!.previewMetrics).toEqual(["drone-001:battery.voltage"]);
    expect(p!.body).toEqual({
      source_id: "drone-001",
      timestamp_start: new Date(1755000000000).toISOString(),
      timestamp_end: new Date(1755000180000).toISOString(),
      label: "Voltage sag",
      color: "purple",
      notes: "battery.voltage fell 12.1→10.8 V",
    });
  });

  it("treats a missing or non-positive window end as an instant", () => {
    const instant = buildAnnotationProposal({ ...input, end_ms: undefined });
    expect(
      (instant!.body as { timestamp_end: string | null }).timestamp_end,
    ).toBeNull();
    const inverted = buildAnnotationProposal({
      ...input,
      end_ms: input.start_ms - 1,
    });
    expect(
      (inverted!.body as { timestamp_end: string | null }).timestamp_end,
    ).toBeNull();
  });

  it("accepts ISO strings for the window (the seeded Explain flow hands the model ISO times)", () => {
    const p = buildAnnotationProposal({
      ...input,
      start_ms: "2026-08-13T12:00:00.000Z",
      end_ms: "2026-08-13T12:03:00.000Z",
    });
    expect((p!.body as { timestamp_start: string }).timestamp_start).toBe(
      "2026-08-13T12:00:00.000Z",
    );
  });

  it("rejects incomplete input", () => {
    expect(buildAnnotationProposal({ ...input, source: "" })).toBeNull();
    expect(buildAnnotationProposal({ ...input, metric: "" })).toBeNull();
    expect(buildAnnotationProposal({ ...input, label: " " })).toBeNull();
    expect(buildAnnotationProposal({ ...input, start_ms: "nope" })).toBeNull();
  });
});

describe("buildRememberProposal", () => {
  it("builds the source-context note POST label-proposals used to send", () => {
    const p = buildRememberProposal({
      source: "drone-001",
      content: "Baseline hover current is ~4.2 A.",
    });
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("memory");
    expect(p!.endpoint).toBe("/api/sources/drone-001/context");
    expect(p!.body).toEqual({
      context_type: "note",
      name: "Model memory",
      content: "Baseline hover current is ~4.2 A.",
    });
  });

  it("rejects missing source or content", () => {
    expect(buildRememberProposal({ source: "", content: "x" })).toBeNull();
    expect(buildRememberProposal({ source: "drone-001", content: " " })).toBeNull();
  });
});
