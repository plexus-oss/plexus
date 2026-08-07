/**
 * Built-in transform functions for computed metrics.
 */

export interface TransformPoint {
  timestamp: string;
  value: number;
}

/**
 * Rolling (moving) average over a window of N points.
 */
export function rollingAvg(
  points: TransformPoint[],
  window: number,
): TransformPoint[] {
  if (points.length === 0 || window < 1) return points;
  const result: TransformPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - window + 1);
    let sum = 0;
    for (let j = start; j <= i; j++) {
      sum += points[j].value;
    }
    result.push({
      timestamp: points[i].timestamp,
      value: sum / (i - start + 1),
    });
  }

  return result;
}

/**
 * Delta — difference between consecutive points.
 */
export function delta(points: TransformPoint[]): TransformPoint[] {
  if (points.length < 2) return [];
  const result: TransformPoint[] = [];

  for (let i = 1; i < points.length; i++) {
    result.push({
      timestamp: points[i].timestamp,
      value: points[i].value - points[i - 1].value,
    });
  }

  return result;
}

/**
 * Rate — change per second between consecutive points.
 */
export function rate(points: TransformPoint[]): TransformPoint[] {
  if (points.length < 2) return [];
  const result: TransformPoint[] = [];

  for (let i = 1; i < points.length; i++) {
    const dtMs =
      new Date(points[i].timestamp).getTime() -
      new Date(points[i - 1].timestamp).getTime();
    const dtSec = dtMs / 1000;
    if (dtSec === 0) continue;

    result.push({
      timestamp: points[i].timestamp,
      value: (points[i].value - points[i - 1].value) / dtSec,
    });
  }

  return result;
}

/**
 * Ratio — divide values of metric A by metric B, point-by-point.
 * Assumes both arrays are sorted by timestamp and of equal length.
 */
export function ratio(
  pointsA: TransformPoint[],
  pointsB: TransformPoint[],
): TransformPoint[] {
  const result: TransformPoint[] = [];
  const len = Math.min(pointsA.length, pointsB.length);

  for (let i = 0; i < len; i++) {
    if (pointsB[i].value === 0) continue;
    result.push({
      timestamp: pointsA[i].timestamp,
      value: pointsA[i].value / pointsB[i].value,
    });
  }

  return result;
}

/**
 * Simple math expression evaluator.
 * Supports: +, -, *, /, (, ), numbers, and the variable `x` for the current value.
 */
export function expression(
  points: TransformPoint[],
  formula: string,
): TransformPoint[] {
  // Validate formula — only allow safe characters
  if (!/^[0-9x+\-*/().%\s]+$/.test(formula)) {
    return points;
  }

  return points.map((p) => {
    try {
      // Replace x with the value, then evaluate
      const expr = formula.replace(/x/g, String(p.value));
      // Using Function constructor for simple math only (validated above)
      const fn = new Function(`return (${expr})`);
      const result = fn();
      return {
        timestamp: p.timestamp,
        value:
          typeof result === "number" && isFinite(result) ? result : p.value,
      };
    } catch {
      return p;
    }
  });
}

/**
 * Multi-metric expression — combine multiple metrics into a computed metric.
 *
 * Formula references metrics by name: "voltage * current" computes power.
 * Variables are metric names (lowercase, underscores allowed).
 * Supports: +, -, *, /, (, ), numbers, and metric names as variables.
 *
 * Example formulas:
 *   "voltage * current"                → P = V × I
 *   "power_output / (irradiance * 10)" → efficiency
 *   "(slice_0 + slice_1 + slice_2 + slice_3) / 4" → average across slices
 *   "abs(slice_0 - slice_1)"           → balance check
 *
 * @param allData - All metric data in the panel (Record<metricKey, points[]>)
 * @param formula - Expression with metric names as variables
 * @param outputMetric - Name for the resulting computed metric
 * @returns Points for the computed metric, aligned by nearest timestamp
 */
export function combine(
  allData: Record<string, TransformPoint[]>,
  formula: string,
  outputMetric: string,
): { metric: string; points: TransformPoint[] } | null {
  // Extract variable names from formula (sequences of letters/underscores/digits not starting with digit)
  const varPattern = /[a-zA-Z_][a-zA-Z0-9_]*/g;
  const mathFunctions = new Set(["abs", "min", "max", "sqrt", "pow", "log", "ceil", "floor", "round"]);
  const rawVars = formula.match(varPattern) || [];
  const varNames = [...new Set(rawVars.filter((v) => !mathFunctions.has(v)))];

  if (varNames.length === 0) return null;

  // Find which data keys match each variable name
  // Match by: exact key, or key ends with ":varName" (for "sourceId:metric" format)
  const varToKey: Record<string, string> = {};
  for (const varName of varNames) {
    const exactMatch = Object.keys(allData).find((k) => k === varName);
    if (exactMatch) {
      varToKey[varName] = exactMatch;
      continue;
    }
    const suffixMatch = Object.keys(allData).find(
      (k) => k.endsWith(`:${varName}`) || k.toLowerCase().endsWith(`:${varName.toLowerCase()}`),
    );
    if (suffixMatch) {
      varToKey[varName] = suffixMatch;
    }
  }

  // Need all variables to have data
  if (Object.keys(varToKey).length !== varNames.length) return null;

  // Build a time-aligned dataset using the first variable's timestamps as reference
  const refKey = varToKey[varNames[0]];
  const refPoints = allData[refKey];
  if (!refPoints || refPoints.length === 0) return null;

  // For each reference timestamp, find nearest value in each other series
  const otherSeries: Record<string, TransformPoint[]> = {};
  for (const [varName, key] of Object.entries(varToKey)) {
    if (key !== refKey) {
      otherSeries[varName] = allData[key] || [];
    }
  }

  // Validate formula safety — only allow safe characters + variable names + math functions
  const safeFormula = formula.replace(varPattern, "0"); // replace vars with 0 for validation
  if (!/^[0-9+\-*/().%,\s]+$/.test(safeFormula)) {
    return null;
  }

  const result: TransformPoint[] = [];

  for (const refPoint of refPoints) {
    const refTs = new Date(refPoint.timestamp).getTime();
    const values: Record<string, number> = {};
    values[varNames[0]] = refPoint.value;

    // Find nearest value in each other series
    let allFound = true;
    for (const [varName, points] of Object.entries(otherSeries)) {
      const nearest = findNearest(points, refTs);
      if (nearest === null) {
        allFound = false;
        break;
      }
      values[varName] = nearest;
    }

    if (!allFound) continue;

    try {
      // Build expression with values substituted
      let expr = formula;
      // Replace math function names with Math.fn
      for (const fn of mathFunctions) {
        expr = expr.replace(new RegExp(`\\b${fn}\\b`, "g"), `Math.${fn}`);
      }
      // Replace variable names with their values (longest first to avoid partial replacement)
      const sortedVars = [...varNames].sort((a, b) => b.length - a.length);
      for (const varName of sortedVars) {
        expr = expr.replace(new RegExp(`\\b${varName}\\b`, "g"), String(values[varName]));
      }

      const fn = new Function(`return (${expr})`);
      const val = fn();

      if (typeof val === "number" && isFinite(val)) {
        result.push({ timestamp: refPoint.timestamp, value: val });
      }
    } catch {
      // Skip this point on evaluation error
    }
  }

  return result.length > 0 ? { metric: outputMetric, points: result } : null;
}

/** Find the nearest point by timestamp */
function findNearest(points: TransformPoint[], targetMs: number): number | null {
  if (points.length === 0) return null;

  let best = 0;
  let bestDist = Math.abs(new Date(points[0].timestamp).getTime() - targetMs);

  for (let i = 1; i < points.length; i++) {
    const dist = Math.abs(new Date(points[i].timestamp).getTime() - targetMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    } else {
      break; // points are sorted, distance increasing = we passed it
    }
  }

  // Don't match if nearest point is more than 60s away
  if (bestDist > 60_000) return null;

  return points[best].value;
}
