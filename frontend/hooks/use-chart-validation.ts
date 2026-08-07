/**
 * Chart data validation hook
 *
 * Validates telemetry data against chart type requirements and returns
 * a validation result with valid data subset, issues, and stats.
 */

import { useMemo } from "react";
import type { ChartType } from "@/lib/validation/chart-schemas";
import { ChartTypeSchemas } from "@/lib/validation/chart-schemas";
import {
  coerceToNumber,
  isNumericValue,
  isValidTimestamp,
} from "@/lib/validation/type-guards";
import {
  CHART_REQUIREMENTS,
  type ValidationResult,
  type ValidationIssue,
  type ValidatedChartData,
} from "@/lib/validation/types";
import type { FlexValue } from "@/lib/types/dashboard";

// Telemetry data structure from useTelemetryQuery
interface TelemetryData {
  [metricName: string]: Array<{
    id?: string;
    timestamp: string;
    value: number | FlexValue;
    source_id?: string | null;
  }>;
}

export interface UseChartValidationOptions {
  chartType: ChartType;
  data: TelemetryData;
  metrics: string[];
  coerceValues?: boolean;
  strictMode?: boolean;
}

export function useChartValidation({
  chartType,
  data,
  metrics,
  coerceValues = true,
  strictMode = false,
}: UseChartValidationOptions): ValidationResult<ValidatedChartData> {
  return useMemo(() => {
    const issues: ValidationIssue[] = [];
    const requirements = CHART_REQUIREMENTS[chartType];

    // Unknown chart type
    if (!requirements) {
      return {
        isValid: false,
        validData: null,
        issues: [
          {
            type: "error",
            code: "UNKNOWN_CHART_TYPE",
            message: `Unknown chart type: ${chartType}`,
          },
        ],
        stats: {
          totalPoints: 0,
          validPoints: 0,
          skippedPoints: 0,
          coercedPoints: 0,
        },
      };
    }

    let totalPoints = 0;
    let validPoints = 0;
    let skippedPoints = 0;
    let coercedPoints = 0;
    const series: Array<{
      name: string;
      data: Array<{ x: number; y: number }>;
      color?: string;
    }> = [];

    for (const metric of metrics) {
      const points = data[metric] || [];
      totalPoints += points.length;

      const seriesData: Array<{ x: number; y: number }> = [];

      for (const point of points) {
        // Validate timestamp
        if (!isValidTimestamp(point.timestamp)) {
          skippedPoints++;
          if (strictMode) {
            issues.push({
              type: "warning",
              code: "INVALID_TIMESTAMP",
              message: `Invalid timestamp: ${point.timestamp}`,
              field: metric,
            });
          }
          continue;
        }

        // X-axis value (timestamp as numeric milliseconds)
        const xValue = new Date(point.timestamp).getTime();

        // Y-axis value
        const yValue = coerceValues
          ? coerceToNumber(point.value as FlexValue)
          : isNumericValue(point.value)
          ? point.value
          : null;

        if (yValue === null) {
          skippedPoints++;
          if (strictMode) {
            issues.push({
              type: "warning",
              code: "NON_NUMERIC_Y",
              message: `Cannot use "${point.value}" as y-value`,
              field: metric,
              suggestion: "Select a metric with numeric values",
            });
          }
          continue;
        }

        seriesData.push({ x: xValue, y: yValue });
        validPoints++;
        if (!isNumericValue(point.value)) coercedPoints++;
      }

      if (seriesData.length > 0 && seriesData.length < requirements.minPoints) {
        issues.push({
          type: chartType === "scatter" ? "warning" : "error",
          code: "SERIES_INSUFFICIENT_DATA",
          message: `Series "${metric}" has ${seriesData.length} point(s), need at least ${requirements.minPoints}`,
          field: metric,
          suggestion:
            seriesData.length === 1 && chartType === "line"
              ? "Line charts need 2+ points to draw lines. Try scatter plot for single points."
              : undefined,
        });
      }

      if (seriesData.length > 0) {
        seriesData.sort((a, b) => {
          const aNum = typeof a.x === "number" ? a.x : 0;
          const bNum = typeof b.x === "number" ? b.x : 0;
          return aNum - bNum;
        });

        series.push({
          name: metric,
          data: seriesData,
        });
      }
    }

    // Check if we have any valid series that meet requirements
    const hasValidSeries = series.some(
      (s) => s.data.length >= requirements.minPoints
    );

    if (series.length === 0) {
      // Provide more specific error message based on what failed
      if (totalPoints === 0) {
        issues.push({
          type: "error",
          code: "NO_DATA",
          message: "No data points found in the selected time range",
          suggestion:
            "Try expanding the time range or check that data is being collected",
        });
      } else if (skippedPoints === totalPoints) {
        issues.push({
          type: "error",
          code: "ALL_VALUES_INVALID",
          message: `All ${totalPoints} data point(s) have non-numeric values`,
          suggestion: "This metric may contain text or other non-numeric data",
        });
      } else {
        issues.push({
          type: "error",
          code: "NO_VALID_SERIES",
          message:
            "No valid data series could be created from the selected metrics",
          suggestion: "Select metrics with numeric values",
        });
      }
    } else if (!hasValidSeries) {
      issues.push({
        type: "error",
        code: "ALL_SERIES_INSUFFICIENT",
        message: `All series have fewer than ${requirements.minPoints} point(s)`,
        suggestion: `${
          chartType === "line" || chartType === "area" ? "Line/area" : "This"
        } chart requires at least ${requirements.minPoints} points per series`,
      });
    }

    // Add summary warnings
    if (coercedPoints > 0) {
      issues.push({
        type: "warning",
        code: "COERCED_VALUES",
        message: `${coercedPoints} string value(s) converted to numbers`,
        suggestion: "Consider using numeric values in your data source",
      });
    }

    if (skippedPoints > 0 && !strictMode) {
      issues.push({
        type: "warning",
        code: "SKIPPED_VALUES",
        message: `${skippedPoints} non-numeric value(s) skipped`,
      });
    }

    if (series.length > 0) {
      const schema = ChartTypeSchemas[chartType];
      if (schema) {
        const schemaResult = schema.safeParse({ series });
        if (!schemaResult.success) {
          for (const zodError of schemaResult.error.issues) {
            // Only add if not duplicate of existing issues
            const isDuplicate = issues.some(
              (i) =>
                i.code === "SCHEMA_VALIDATION" && i.message === zodError.message
            );
            if (!isDuplicate) {
              issues.push({
                type: "warning",
                code: "SCHEMA_VALIDATION",
                message: zodError.message,
                field: zodError.path.join("."),
              });
            }
          }
        }
      }
    }

    const isValid =
      hasValidSeries && issues.filter((i) => i.type === "error").length === 0;

    return {
      isValid,
      validData: { series },
      issues,
      stats: { totalPoints, validPoints, skippedPoints, coercedPoints },
    };
  }, [chartType, data, metrics, coerceValues, strictMode]);
}

