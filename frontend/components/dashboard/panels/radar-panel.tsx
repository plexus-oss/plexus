"use client";

import { useMemo } from "react";
import { RadarChart } from "@/components/ui/charts/radar-chart";
import { usePanelData } from "@/hooks/use-panel-data";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";

interface RadarPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

const DEFAULT_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

/**
 * Radar panel for polar coordinate visualization
 * Supports realtime, table, and connection data sources
 */
export function RadarPanel({ panel, timeRange }: RadarPanelProps) {
  const { data, isLoading, error, sourceType, metrics, connectionMeta, refresh } = usePanelData({
    panel,
    timeRange,
  });

  const colors = panel.config.colors || DEFAULT_COLORS;
  const maxPoints = panel.config.maxPoints || 360;
  const maxRange = panel.config.maxRange;

  // Transform data to radar series
  const series = useMemo(() => {
    if (!data) return [];

    const keysToUse = metrics.length > 0 ? metrics : Object.keys(data);
    if (keysToUse.length === 0) return [];

    // If we have exactly 2 metrics, treat first as angle and second as distance
    if (keysToUse.length === 2) {
      const angleMetric = keysToUse[0];
      const distMetric = keysToUse[1];
      const angleData = data[angleMetric] || [];
      const distData = data[distMetric] || [];

      const isAntennaPattern =
        angleMetric.includes("antenna_pattern") ||
        distMetric.includes("antenna_pattern");

      const distLookup = new Map<string, typeof distData[0]>();
      for (const d of distData) { distLookup.set(d.timestamp, d); }

      const combined: Array<{ angle: number; distance: number }> = [];
      for (const anglePt of angleData) {
        const distPt = distLookup.get(anglePt.timestamp);
        if (
          distPt &&
          typeof anglePt.value === "number" &&
          typeof distPt.value === "number"
        ) {
          const distance = maxRange
            ? Math.min(1, Math.max(0, distPt.value / maxRange))
            : Math.min(1, Math.max(0, distPt.value));
          combined.push({
            angle: anglePt.value % 360,
            distance,
          });
        }
      }

      return [
        {
          name: isAntennaPattern ? "Pattern" : "Track",
          data: combined.slice(-maxPoints),
          color: colors[0],
          connectPoints: isAntennaPattern,
        },
      ];
    }

    // Single or multiple metrics - interpret as angle, with distance as count/intensity
    return keysToUse.map((metric, idx) => {
      const metricData = data[metric] || [];
      const points = metricData
        .filter((p) => typeof p.value === "number")
        .slice(-maxPoints)
        .map((p, i, arr) => ({
          angle: (typeof p.value === "number" ? p.value : 0) % 360,
          distance: 0.3 + (i / arr.length) * 0.7,
        }));

      return {
        name: metric,
        data: points,
        color: colors[idx % colors.length],
      };
    });
  }, [data, metrics, colors, maxPoints, maxRange]);

  if (isLoading && series.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <PanelEmptyState
        reason="query_error"
        debugInfo={{
          sourceType,
          errorMessage: error instanceof Error ? error.message : String(error),
        }}
        onRetry={refresh}
      />
    );
  }

  if (series.length === 0 || series.every((s) => s.data.length === 0)) {
    return (
      <PanelEmptyState
        reason="no_data"
        debugInfo={{
          sourceType,
          rowCount: connectionMeta?.rowCount || 0,
          columns: connectionMeta?.columns?.map(c => c.name),
        }}
        onRetry={refresh}
      />
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 min-h-0">
        <RadarChart
          series={series}
          width="100%"
          height="100%"
          rings={5}
          sectors={12}
          showSweep={panel.config.showSweep !== false}
        />
      </div>
      {/* Series legend */}
      {series.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border flex items-center gap-3 flex-wrap">
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.name}</span>
              <span className="text-muted-foreground/60">({s.data.length}pts)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
