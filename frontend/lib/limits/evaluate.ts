/**
 * Limit Evaluation Utilities
 *
 * Pure functions for evaluating values against defined limits.
 * Used for both in-memory (streaming) and query-based evaluation.
 * Supports both SourceLimit (for device metrics) and ColumnLimit (for Plexus Tables).
 */

import type { SourceLimit, ColumnLimit, LimitSeverity } from "@/lib/db/types";

/**
 * Unified limit type that works for both sources and columns
 */
export type UnifiedLimit = SourceLimit | ColumnLimit;

/**
 * Normalize severity from string to LimitSeverity
 * ColumnLimit has severity as string, SourceLimit has it typed
 */
export function normalizeSeverity(
  severity: string | LimitSeverity,
): LimitSeverity {
  const normalized = severity?.toLowerCase() as LimitSeverity;
  if (
    normalized === "critical" ||
    normalized === "warning" ||
    normalized === "info"
  ) {
    return normalized;
  }
  return "warning"; // default fallback
}

/**
 * Result of evaluating a value against a limit
 */
export interface LimitEvaluationResult {
  /** Whether the value violates the limit */
  isViolation: boolean;
  /** The status of the evaluation */
  status: "normal" | "warning" | "critical";
  /** Which bound was violated (if any) */
  violatedBound?: "min" | "max";
  /** The actual value that was checked */
  value: number;
  /** The limit that was checked against */
  limit: UnifiedLimit;
  /** Normalized severity */
  severity: LimitSeverity;
  /** Distance from the violated bound (negative if within bounds) */
  distance?: number;
}

/**
 * A limit violation event with context
 */
export interface LimitViolation {
  /** Unique ID for this violation instance */
  id: string;
  /** Source ID */
  sourceId: string;
  /** Metric name */
  metric: string;
  /** The value that violated the limit */
  value: number;
  /** Timestamp of the violation */
  timestamp: string;
  /** Severity of the violation */
  severity: LimitSeverity;
  /** Which bound was violated */
  bound: "min" | "max";
  /** The limit value that was violated */
  limitValue: number;
  /** Custom message from the limit (if any) */
  message?: string;
  /** Whether this violation has been acknowledged */
  acknowledged: boolean;
}

/**
 * Configuration for limit evaluation
 */
export interface EvaluationConfig {
  /** Percentage of range to consider as warning zone (default: 0.15 = 15%) */
  warningThreshold?: number;
  /** Whether to include warning status for values approaching limits */
  includeWarnings?: boolean;
}

const DEFAULT_CONFIG: EvaluationConfig = {
  warningThreshold: 0.15,
  includeWarnings: true,
};

/**
 * Evaluate a single value against a limit
 * Works with both SourceLimit (device metrics) and ColumnLimit (Plexus Tables)
 */
export function evaluateLimit(
  value: number,
  limit: UnifiedLimit,
  config: EvaluationConfig = DEFAULT_CONFIG,
): LimitEvaluationResult {
  const { warningThreshold = 0.15, includeWarnings = true } = config;
  const severity = normalizeSeverity(limit.severity);

  const hasMin = limit.min !== undefined && limit.min !== null;
  const hasMax = limit.max !== undefined && limit.max !== null;

  // Check for critical violations (outside bounds)
  if (hasMin && value < limit.min!) {
    return {
      isViolation: true,
      status: "critical",
      violatedBound: "min",
      value,
      limit,
      severity,
      distance: limit.min! - value,
    };
  }

  if (hasMax && value > limit.max!) {
    return {
      isViolation: true,
      status: "critical",
      violatedBound: "max",
      value,
      limit,
      severity,
      distance: value - limit.max!,
    };
  }

  // Check for warning zone (approaching limits)
  if (includeWarnings && hasMin && hasMax) {
    const range = limit.max! - limit.min!;
    if (range > 0) {
      const warningDistance = range * warningThreshold;

      // Close to min
      if (value < limit.min! + warningDistance) {
        return {
          isViolation: false,
          status: "warning",
          value,
          limit,
          severity,
          distance: value - limit.min!,
        };
      }

      // Close to max
      if (value > limit.max! - warningDistance) {
        return {
          isViolation: false,
          status: "warning",
          value,
          limit,
          severity,
          distance: limit.max! - value,
        };
      }
    }
  }

  // Value is within normal bounds
  return {
    isViolation: false,
    status: "normal",
    value,
    limit,
    severity,
  };
}

/**
 * Evaluate multiple values against their respective limits
 * Works with both SourceLimit and ColumnLimit
 */
export function evaluateLimits(
  values: Record<string, number>,
  limits: Record<string, UnifiedLimit>,
  config: EvaluationConfig = DEFAULT_CONFIG,
): Record<string, LimitEvaluationResult> {
  const results: Record<string, LimitEvaluationResult> = {};

  for (const [metric, value] of Object.entries(values)) {
    const limit = limits[metric];
    if (limit) {
      results[metric] = evaluateLimit(value, limit, config);
    }
  }

  return results;
}
