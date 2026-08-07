/**
 * Data Transformation Pipeline
 *
 * Registry of transforms that can be applied to panel data.
 * Each transform operates on an array of {timestamp, value} points.
 */

import {
  rollingAvg,
  delta,
  rate,
  ratio,
  expression,
  combine,
  type TransformPoint,
} from "./functions";

export type TransformType =
  | "rolling_avg"
  | "delta"
  | "rate"
  | "ratio"
  | "expression"
  | "combine";

export interface Transform {
  type: TransformType;
  /** Window size for rolling_avg */
  window?: number;
  /** Second metric for ratio */
  metricB?: string;
  /** Math expression with variable `x` (for expression) or metric names (for combine) */
  formula?: string;
  /** Output metric name for combine (e.g., "power", "efficiency") */
  outputMetric?: string;
}

export type { TransformPoint };

/**
 * Apply a list of transforms to panel data.
 * Transforms are applied sequentially (pipeline).
 *
 * @param data - Record<metric, TransformPoint[]>
 * @param transforms - Array of Transform configs
 * @returns Transformed data (new object)
 */
export function applyTransforms(
  data: Record<string, TransformPoint[]>,
  transforms: Transform[],
): Record<string, TransformPoint[]> {
  if (!transforms || transforms.length === 0) return data;

  let result = { ...data };

  for (const transform of transforms) {
    const next: Record<string, TransformPoint[]> = {};

    for (const [metric, points] of Object.entries(result)) {
      if (!Array.isArray(points)) {
        next[metric] = points;
        continue;
      }

      switch (transform.type) {
        case "rolling_avg":
          next[metric] = rollingAvg(points, transform.window ?? 10);
          break;
        case "delta":
          next[metric] = delta(points);
          break;
        case "rate":
          next[metric] = rate(points);
          break;
        case "ratio":
          if (transform.metricB && result[transform.metricB]) {
            next[metric] = ratio(points, result[transform.metricB]);
          } else {
            next[metric] = points;
          }
          break;
        case "expression":
          next[metric] = expression(points, transform.formula ?? "x");
          break;
        case "combine":
          // combine is handled below (operates on all metrics, not per-metric)
          next[metric] = points;
          break;
        default:
          next[metric] = points;
      }
    }

    // Handle combine transforms: operate on all metrics at once
    if (transform.type === "combine" && transform.formula && transform.outputMetric) {
      const combined = combine(next, transform.formula, transform.outputMetric);
      if (combined) {
        next[combined.metric] = combined.points;
      }
    }

    result = next;
  }

  return result;
}
