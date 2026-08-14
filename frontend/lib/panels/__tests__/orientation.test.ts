import { describe, it, expect } from "vitest";
import {
  samplePointAt,
  resolveOrientation,
  orientationMetrics,
  quatToEulerYXZDeg,
} from "@/lib/panels/orientation";
import type { TelemetryData, TelemetryPoint } from "@/hooks/realtime/telemetry-store";

const T0 = Date.parse("2026-08-14T12:00:00.000Z");

function series(values: number[], stepMs = 1000): TelemetryPoint[] {
  return values.map((value, i) => ({
    timestamp: new Date(T0 + i * stepMs).toISOString(),
    value,
  }));
}

describe("samplePointAt", () => {
  const pts = series([10, 20, 30, 40, 50]); // T0, +1s … +4s

  it("returns null on empty series", () => {
    expect(samplePointAt([], T0)).toBeNull();
  });

  it("finds the exact point", () => {
    expect(samplePointAt(pts, T0 + 2000)?.value).toBe(30);
  });

  it("rounds to the nearest neighbor on either side", () => {
    expect(samplePointAt(pts, T0 + 2400)?.value).toBe(30);
    expect(samplePointAt(pts, T0 + 2600)?.value).toBe(40);
  });

  it("clamps to the ends", () => {
    expect(samplePointAt(pts, T0 - 60_000)?.value).toBe(10);
    expect(samplePointAt(pts, T0 + 60_000)?.value).toBe(50);
  });

  it("honors the tolerance cutoff", () => {
    expect(samplePointAt(pts, T0 + 60_000, 5000)).toBeNull();
    expect(samplePointAt(pts, T0 + 4300, 5000)?.value).toBe(50);
  });
});

describe("resolveOrientation — euler", () => {
  it("uses explicit slot bindings regardless of metric names", () => {
    const data: TelemetryData = {
      "pod:theta": series([12]),
      "pod:phi": series([-4]),
      "pod:psi": series([90]),
    };
    const out = resolveOrientation(data, Object.keys(data), {
      pitchMetric: "pod:theta",
      rollMetric: "pod:phi",
      yawMetric: "pod:psi",
    });
    expect(out).toEqual({ kind: "euler", pitch: 12, roll: -4, yaw: 90 });
  });

  it("explicit binding beats a name-substring match (old hijack bug)", () => {
    // "pod:roll_rate" contains "roll"; explicitly bound to PITCH it must
    // drive pitch and must NOT also be stolen for the roll slot.
    const data: TelemetryData = {
      "pod:roll_rate": series([7]),
    };
    const out = resolveOrientation(data, Object.keys(data), {
      pitchMetric: "pod:roll_rate",
    });
    expect(out).toEqual({ kind: "euler", pitch: 7, roll: 0, yaw: 0 });
  });

  it("falls back to name matching for unbound slots (heading counts as yaw)", () => {
    const data: TelemetryData = {
      "pod:pitch": series([1]),
      "pod:roll": series([2]),
      "pod:heading": series([3]),
    };
    const out = resolveOrientation(data, Object.keys(data), {});
    expect(out).toEqual({ kind: "euler", pitch: 1, roll: 2, yaw: 3 });
  });

  it("an all-zero attitude still counts as orientation (old autorotate bug)", () => {
    const data: TelemetryData = {
      "pod:pitch": series([0]),
      "pod:roll": series([0]),
      "pod:yaw": series([0]),
    };
    expect(resolveOrientation(data, Object.keys(data), {})).toEqual({
      kind: "euler",
      pitch: 0,
      roll: 0,
      yaw: 0,
    });
  });

  it("returns null when nothing matches", () => {
    const data: TelemetryData = { "pod:temp": series([21]) };
    expect(resolveOrientation(data, Object.keys(data), {})).toBeNull();
    expect(resolveOrientation({}, [], {})).toBeNull();
  });

  it("samples at the scrub timestamp instead of latest", () => {
    const data: TelemetryData = { "pod:pitch": series([0, 10, 20, 30]) };
    const live = resolveOrientation(data, Object.keys(data), {}, null);
    const scrubbed = resolveOrientation(
      data,
      Object.keys(data),
      {},
      T0 + 1000,
    );
    expect(live).toMatchObject({ pitch: 30 });
    expect(scrubbed).toMatchObject({ pitch: 10 });
  });
});

describe("resolveOrientation — quaternion", () => {
  const quatConfig = {
    quatWMetric: "pod:qw",
    quatXMetric: "pod:qx",
    quatYMetric: "pod:qy",
    quatZMetric: "pod:qz",
  };

  it("quaternion wins over euler and is normalized", () => {
    const data: TelemetryData = {
      "pod:qw": series([2]), // deliberately unnormalized: [0,0,0,2] → [0,0,0,1]
      "pod:qx": series([0]),
      "pod:qy": series([0]),
      "pod:qz": series([0]),
      "pod:pitch": series([45]),
    };
    const out = resolveOrientation(data, Object.keys(data), {
      ...quatConfig,
      pitchMetric: "pod:pitch",
    });
    expect(out).toEqual({ kind: "quat", quat: [0, 0, 0, 1] });
  });

  it("falls back to euler when a quat component has no data", () => {
    const data: TelemetryData = {
      "pod:qw": series([1]),
      "pod:qx": series([0]),
      "pod:qy": series([0]),
      // qz missing
      "pod:pitch": series([45]),
    };
    const out = resolveOrientation(data, Object.keys(data), {
      ...quatConfig,
      pitchMetric: "pod:pitch",
    });
    expect(out).toMatchObject({ kind: "euler", pitch: 45 });
  });

  it("rejects a degenerate zero quaternion", () => {
    const data: TelemetryData = {
      "pod:qw": series([0]),
      "pod:qx": series([0]),
      "pod:qy": series([0]),
      "pod:qz": series([0]),
    };
    expect(
      resolveOrientation(data, Object.keys(data), quatConfig),
    ).toBeNull();
  });
});

describe("quatToEulerYXZDeg", () => {
  /** Build a YXZ-order quaternion from euler degrees — the inverse path. */
  function quatFromEulerYXZ(
    pitchDeg: number,
    yawDeg: number,
    rollDeg: number,
  ): [number, number, number, number] {
    const d = Math.PI / 360; // half-angle per degree
    const cx = Math.cos(pitchDeg * d), sx = Math.sin(pitchDeg * d);
    const cy = Math.cos(yawDeg * d), sy = Math.sin(yawDeg * d);
    const cz = Math.cos(rollDeg * d), sz = Math.sin(rollDeg * d);
    // three.js Quaternion.setFromEuler, order "YXZ"
    return [
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz - sx * sy * cz,
      cx * cy * cz + sx * sy * sz,
    ];
  }

  it("identity quaternion is level", () => {
    expect(quatToEulerYXZDeg([0, 0, 0, 1])).toEqual({
      pitch: -0,
      yaw: 0,
      roll: 0,
    });
  });

  it("round-trips euler → quat → euler", () => {
    const cases: [number, number, number][] = [
      [10, 0, 0],
      [0, 45, 0],
      [0, 0, -30],
      [12.5, -78, 33],
    ];
    for (const [p, y, r] of cases) {
      const out = quatToEulerYXZDeg(quatFromEulerYXZ(p, y, r));
      expect(out.pitch).toBeCloseTo(p, 5);
      expect(out.yaw).toBeCloseTo(y, 5);
      expect(out.roll).toBeCloseTo(r, 5);
    }
  });
});

describe("orientationMetrics", () => {
  it("collects only the bound metrics", () => {
    expect(
      orientationMetrics({
        pitchMetric: "a:p",
        quatWMetric: "a:qw",
      }),
    ).toEqual(["a:p", "a:qw"]);
    expect(orientationMetrics({})).toEqual([]);
  });
});
