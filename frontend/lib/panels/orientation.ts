/**
 * Orientation resolution for the 3D model panel.
 *
 * Pure functions so the binding precedence and time-scrub sampling are unit
 * testable without three.js or React. The panel feeds the result into the
 * viewer; `null` means "no orientation data" and the viewer may autorotate.
 */

/**
 * Structural minimum of a telemetry point. Both TelemetryPoint variants in
 * the app (telemetry-store's and telemetry-provider's, which differ on
 * `source_id` nullability) satisfy it.
 */
export interface SamplablePoint {
  timestamp: string;
  value: number | string | null;
}

export type SamplableData = Record<string, SamplablePoint[]>;

export type ResolvedOrientation =
  /** Quaternion drive — [x, y, z, w], normalized. Wins over euler. */
  | { kind: "quat"; quat: [number, number, number, number] }
  /** Euler drive — degrees, heading-pitch-roll ("YXZ") convention. */
  | { kind: "euler"; pitch: number; roll: number; yaw: number };

export interface OrientationBindings {
  pitchMetric?: string;
  rollMetric?: string;
  yawMetric?: string;
  quatWMetric?: string;
  quatXMetric?: string;
  quatYMetric?: string;
  quatZMetric?: string;
}

/** All orientation metrics named in a config — for subscription unions. */
export function orientationMetrics(config: OrientationBindings): string[] {
  return [
    config.pitchMetric,
    config.rollMetric,
    config.yawMetric,
    config.quatWMetric,
    config.quatXMetric,
    config.quatYMetric,
    config.quatZMetric,
  ].filter((m): m is string => !!m);
}

/**
 * Nearest point to `atMs` in an ISO-timestamped, time-sorted series.
 * Binary search; returns null when the series is empty or the closest
 * point is farther than `toleranceMs` (aggregation/decimation can thin a
 * series, so exact-timestamp lookups are a trap).
 */
export function samplePointAt(
  points: SamplablePoint[],
  atMs: number,
  toleranceMs = Infinity,
): SamplablePoint | null {
  if (points.length === 0) return null;

  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Date.parse(points[mid].timestamp) < atMs) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first point >= atMs (or the last point). Compare with its
  // predecessor to find the true nearest.
  let best = points[lo];
  if (lo > 0) {
    const prev = points[lo - 1];
    if (
      Math.abs(Date.parse(prev.timestamp) - atMs) <
      Math.abs(Date.parse(best.timestamp) - atMs)
    ) {
      best = prev;
    }
  }
  if (Math.abs(Date.parse(best.timestamp) - atMs) > toleranceMs) return null;
  return best;
}

function valueAt(
  data: SamplableData,
  metric: string | undefined,
  atMs: number | null,
  toleranceMs: number,
): number | null {
  if (!metric) return null;
  const series = data[metric];
  if (!series || series.length === 0) return null;
  const point =
    atMs === null
      ? series[series.length - 1]
      : samplePointAt(series, atMs, toleranceMs);
  return point && typeof point.value === "number" ? point.value : null;
}

/**
 * Resolve the model's orientation from telemetry.
 *
 * Precedence:
 *   1. Quaternion — when all four quat metrics are bound and have samples.
 *   2. Explicit euler slots (`pitchMetric` / `rollMetric` / `yawMetric`).
 *   3. Name-substring fallback (pitch / roll / yaw|heading) — only for slots
 *      the config leaves unbound, and never stealing an explicitly-bound
 *      metric for a different slot.
 *
 * A slot with data but value 0 still counts as "has orientation" — a level
 * vehicle is an attitude, not an absence of one.
 *
 * `atMs === null` samples the latest point (live); otherwise the nearest
 * point within `toleranceMs` (time-scrub replay).
 */
export function resolveOrientation(
  data: SamplableData,
  metrics: string[],
  config: OrientationBindings,
  atMs: number | null = null,
  toleranceMs = Infinity,
): ResolvedOrientation | null {
  // ── Quaternion mode ──
  const qw = valueAt(data, config.quatWMetric, atMs, toleranceMs);
  const qx = valueAt(data, config.quatXMetric, atMs, toleranceMs);
  const qy = valueAt(data, config.quatYMetric, atMs, toleranceMs);
  const qz = valueAt(data, config.quatZMetric, atMs, toleranceMs);
  if (qw !== null && qx !== null && qy !== null && qz !== null) {
    const norm = Math.hypot(qx, qy, qz, qw);
    if (norm > 1e-9) {
      return {
        kind: "quat",
        quat: [qx / norm, qy / norm, qz / norm, qw / norm],
      };
    }
  }

  // ── Euler mode: explicit slots first ──
  let pitch = valueAt(data, config.pitchMetric, atMs, toleranceMs);
  let roll = valueAt(data, config.rollMetric, atMs, toleranceMs);
  let yaw = valueAt(data, config.yawMetric, atMs, toleranceMs);

  // Name-substring fallback for unbound slots. A metric explicitly bound to
  // any slot is excluded so it can't be hijacked into another one.
  const explicitly = new Set(orientationMetrics(config));
  const keysToUse = metrics.length > 0 ? metrics : Object.keys(data);
  for (const metric of keysToUse) {
    if (explicitly.has(metric)) continue;
    const lower = metric.toLowerCase();
    if (pitch === null && !config.pitchMetric && lower.includes("pitch")) {
      pitch = valueAt(data, metric, atMs, toleranceMs);
    } else if (roll === null && !config.rollMetric && lower.includes("roll")) {
      roll = valueAt(data, metric, atMs, toleranceMs);
    } else if (
      yaw === null &&
      !config.yawMetric &&
      (lower.includes("yaw") || lower.includes("heading"))
    ) {
      yaw = valueAt(data, metric, atMs, toleranceMs);
    }
  }

  if (pitch === null && roll === null && yaw === null) return null;
  return {
    kind: "euler",
    pitch: pitch ?? 0,
    roll: roll ?? 0,
    yaw: yaw ?? 0,
  };
}

/**
 * Quaternion [x,y,z,w] → euler degrees in the viewer's "YXZ"
 * (yaw-pitch-roll) convention. Pure math (same derivation as three.js
 * Euler.setFromRotationMatrix) so the panel's HUD readout doesn't need to
 * import three.js outside the dynamically-loaded viewer chunk.
 */
export function quatToEulerYXZDeg(quat: [number, number, number, number]): {
  pitch: number;
  roll: number;
  yaw: number;
} {
  const [x, y, z, w] = quat;
  // Rotation-matrix elements needed for the YXZ extraction.
  const m11 = 1 - 2 * (y * y + z * z);
  const m13 = 2 * (x * z + y * w);
  const m21 = 2 * (x * y + z * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m31 = 2 * (x * z - y * w);
  const m33 = 1 - 2 * (x * x + y * y);

  const clamped = Math.min(1, Math.max(-1, m23));
  const pitchRad = Math.asin(-clamped);
  let yawRad: number;
  let rollRad: number;
  if (Math.abs(m23) < 0.9999999) {
    yawRad = Math.atan2(m13, m33);
    rollRad = Math.atan2(m21, m22);
  } else {
    // Gimbal-lock at pitch ±90° — fold roll into yaw.
    yawRad = Math.atan2(-m31, m11);
    rollRad = 0;
  }
  const r2d = 180 / Math.PI;
  return { pitch: pitchRad * r2d, yaw: yawRad * r2d, roll: rollRad * r2d };
}
