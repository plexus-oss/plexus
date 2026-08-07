import { useMemo } from "react";
import type { ReferenceLine } from "@/components/ui/charts/reference-lines";
import type { TelemetryData } from "@/components/dashboard/telemetry-provider";
import type { UnifiedLimit } from "@/lib/limits/evaluate";

interface UseReferenceLinesOptions {
  showLimits: boolean;
  limits: Record<string, UnifiedLimit | null> | null;
  displayedMetrics: string[];
  data: TelemetryData | null;
  /** Makes limit labels clickable; receives the bare metric name. */
  onLimitClick?: (metric: string) => void;
}

/**
 * Converts source limits into chart reference lines.
 */
export function useReferenceLines({
  showLimits,
  limits,
  displayedMetrics,
  data,
  onLimitClick,
}: UseReferenceLinesOptions): ReferenceLine[] {
  return useMemo(() => {
    if (!showLimits || !limits) return [];
    const lines: ReferenceLine[] = [];
    const metricsToCheck =
      displayedMetrics.length > 0 ? displayedMetrics : Object.keys(data || {});

    for (const metric of metricsToCheck) {
      const metricName = metric.includes(":") ? metric.split(":")[1] : metric;
      const limit = limits[metricName] || limits[metric];
      if (limit) {
        const onClick = onLimitClick
          ? () => onLimitClick(metricName)
          : undefined;
        if (limit.min !== undefined) {
          lines.push({
            value: limit.min,
            severity:
              (limit.severity as "critical" | "warning" | "info") || "warning",
            style: "dashed",
            label: `${metricName} min`,
            labelPosition: "right",
            onClick,
          });
        }
        if (limit.max !== undefined) {
          lines.push({
            value: limit.max,
            severity:
              (limit.severity as "critical" | "warning" | "info") || "warning",
            style: "dashed",
            label: `${metricName} max`,
            labelPosition: "right",
            onClick,
          });
        }
      }
    }
    return lines;
  }, [showLimits, limits, displayedMetrics, data, onLimitClick]);
}
