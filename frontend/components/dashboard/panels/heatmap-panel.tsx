"use client";

import { useMemo, useCallback, useRef } from "react";
import { HeatmapChart } from "@/components/ui/charts/heatmap-chart";
import { usePanelData } from "@/hooks/use-panel-data";
import { useFormattedTime } from "@/hooks/use-formatted-time";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import {
  colorScales,
  type ColorScaleName,
} from "@/components/ui/lib/color-scales";
import { useAnnotationMode } from "@/hooks/use-annotation-mode";
import {
  AnnotationToolbar,
  AnnotationModeIndicator,
} from "@/components/annotations/annotation-toolbar";
import { AnnotationPopover } from "@/components/annotations/annotation-popover";
import { AnnotationsPanel } from "@/components/annotations/annotations-panel";
import { cn } from "@/lib/utils";

interface HeatmapPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

// CSS gradients matching each color scale for the legend bar
const LEGEND_GRADIENTS: Record<string, string> = {
  viridis: "linear-gradient(to right, rgb(68,1,84), rgb(59,82,139), rgb(33,145,140), rgb(94,201,98), rgb(253,231,37))",
  plasma: "linear-gradient(to right, rgb(13,8,135), rgb(126,3,168), rgb(204,71,120), rgb(248,149,64), rgb(240,249,33))",
  inferno: "linear-gradient(to right, rgb(0,0,4), rgb(87,16,110), rgb(188,55,84), rgb(249,142,9), rgb(252,255,164))",
  cool: "linear-gradient(to right, rgb(110,64,170), rgb(74,134,232), rgb(56,194,162), rgb(128,222,100))",
  warm: "linear-gradient(to right, rgb(110,64,170), rgb(194,62,140), rgb(234,120,72), rgb(230,210,40))",
  turbo: "linear-gradient(to right, rgb(48,18,59), rgb(67,125,232), rgb(38,204,170), rgb(211,232,47), rgb(246,108,25), rgb(122,4,3))",
  grayscale: "linear-gradient(to right, rgb(0,0,0), rgb(255,255,255))",
  diverging: "linear-gradient(to right, rgb(69,117,180), rgb(224,243,248), rgb(254,224,144), rgb(215,48,39))",
};

/**
 * Heatmap panel for 2D grid visualization
 * Transforms time series data into a grid where:
 * - X axis = time buckets
 * - Y axis = metric values bucketed
 * - Color = frequency/count in that cell
 */
export function HeatmapPanel({ panel, timeRange }: HeatmapPanelProps) {
  const { formatTime } = useFormattedTime();
  const { data, isLoading, error, sourceType, metrics, connectionMeta, refresh } = usePanelData({
    panel,
    timeRange,
  });

  const sourceId = panel.config.sourceId || panel.sources?.[0] || null;
  const ann = useAnnotationMode({ sourceId, enabled: !!sourceId });
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Resolve color scale from config
  const scaleName = (panel.config.colorScale as ColorScaleName) || "viridis";
  const colorScale = colorScales[scaleName] || colorScales.viridis;
  const legendGradient = LEGEND_GRADIENTS[scaleName] || LEGEND_GRADIENTS.viridis;

  // Transform data to heatmap format
  const { heatmapData, xCategories, yCategories, maxCount, timeDomain } = useMemo(() => {
    if (!data) return { heatmapData: [], xCategories: [] as string[], yCategories: [] as string[], maxCount: 0, timeDomain: { minTime: 0, maxTime: 0, timeBuckets: 0 } };

    const allValues: number[] = [];
    const allTimestamps: number[] = [];

    // Collect all values and timestamps
    const keysToUse = metrics.length > 0 ? metrics : Object.keys(data);
    for (const key of keysToUse) {
      const metricData = data[key] || [];
      for (const point of metricData) {
        if (typeof point.value === "number") {
          allValues.push(point.value);
          allTimestamps.push(new Date(point.timestamp).getTime());
        }
      }
    }

    if (allValues.length === 0 || allTimestamps.length === 0) {
      return { heatmapData: [], xCategories: [] as string[], yCategories: [] as string[], maxCount: 0, timeDomain: { minTime: 0, maxTime: 0, timeBuckets: 0 } };
    }

    let minTime = Infinity, maxTime = -Infinity;
    let minVal = Infinity, maxVal = -Infinity;
    for (let i = 0; i < allTimestamps.length; i++) {
      const t = allTimestamps[i];
      if (t < minTime) minTime = t;
      if (t > maxTime) maxTime = t;
      const v = allValues[i];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }

    // Auto-calculate optimal bucket count based on data volume
    const dataCount = allValues.length;
    const minTimeBins = panel.config.minTimeBuckets ?? 6;
    const maxTimeBins = panel.config.maxTimeBuckets ?? 20;
    const minValueBins = panel.config.minValueBuckets ?? 5;
    const maxValueBins = panel.config.maxValueBuckets ?? 15;
    const timeBuckets = Math.max(minTimeBins, Math.min(maxTimeBins, Math.ceil(Math.sqrt(dataCount / 2))));
    const valueBuckets = Math.max(minValueBins, Math.min(maxValueBins, Math.ceil(Math.sqrt(dataCount / 3))));

    const timeBucketSize = (maxTime - minTime) / timeBuckets || 1;
    const valueBucketSize = (maxVal - minVal) / valueBuckets || 1;

    // Build axis labels
    const xCats: string[] = [];
    for (let i = 0; i < timeBuckets; i++) {
      const bucketTime = new Date(minTime + i * timeBucketSize);
      xCats.push(formatTime(bucketTime));
    }

    const yCats: string[] = [];
    for (let i = 0; i < valueBuckets; i++) {
      const bucketVal = minVal + i * valueBucketSize;
      yCats.push(Number.isInteger(bucketVal) ? String(bucketVal) : bucketVal.toFixed(1));
    }

    // Count occurrences in each cell
    const counts = new Map<string, number>();
    let max = 0;

    for (const key of keysToUse) {
      const metricData = data[key] || [];
      for (const point of metricData) {
        if (typeof point.value !== "number") continue;

        const time = new Date(point.timestamp).getTime();
        const xBucket = Math.min(Math.floor((time - minTime) / timeBucketSize), timeBuckets - 1);
        const yBucket = Math.min(Math.floor((point.value - minVal) / valueBucketSize), valueBuckets - 1);

        const cellKey = `${xBucket},${yBucket}`;
        const count = (counts.get(cellKey) || 0) + 1;
        counts.set(cellKey, count);
        if (count > max) max = count;
      }
    }

    // Convert to heatmap data points with axis labels
    const points: Array<{ x: number | string; y: number | string; value: number; label?: string }> = [];
    for (const [key, count] of counts) {
      const [x, y] = key.split(",").map(Number);
      points.push({
        x: xCats[x] || x,
        y: yCats[y] || y,
        value: count,
        label: `Count: ${count}`,
      });
    }

    return { heatmapData: points, xCategories: xCats, yCategories: yCats, maxCount: max, timeDomain: { minTime, maxTime, timeBuckets } };
  }, [data, metrics, panel.config.minTimeBuckets, panel.config.maxTimeBuckets, panel.config.minValueBuckets, panel.config.maxValueBuckets, formatTime]);

  // Click handler: convert X position to timestamp. Declared before the early
  // returns below so the hook runs in the same order every render.
  const handleChartClick = useCallback(
    (e: React.MouseEvent) => {
      if (ann.mode === "off" || !chartContainerRef.current) return;
      const { minTime, maxTime } = timeDomain;
      if (minTime === 0 && maxTime === 0) return;

      const rect = chartContainerRef.current.getBoundingClientRect();
      // Heatmap has ~60px left margin for Y axis labels, ~20px right margin
      const marginLeft = 60;
      const marginRight = 20;
      const innerWidth = rect.width - marginLeft - marginRight;
      const chartX = e.clientX - rect.left - marginLeft;
      if (chartX < 0 || chartX > innerWidth) return;

      const fraction = chartX / innerWidth;
      const range = maxTime - minTime;
      const timestamp = new Date(
        minTime + fraction * range,
      ).toISOString();

      ann.openPopover(e.clientX, e.clientY, timestamp);
    },
    [ann, timeDomain],
  );

  if (isLoading && heatmapData.length === 0) {
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

  if (heatmapData.length === 0) {
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
    <>
      <div className="h-full w-full flex flex-col">
        <div
          ref={chartContainerRef}
          className={cn(
            "flex-1 min-h-0 relative",
            ann.mode === "on" ? "cursor-cell" : "",
          )}
          onClick={handleChartClick}
        >
          <HeatmapChart
            data={heatmapData}
            width="100%"
            height="100%"
            showAxes
            showTooltip
            colorScale={colorScale}
            xAxis={{
              label: "Time",
              categories: xCategories,
            }}
            yAxis={{
              label: "Value",
              categories: yCategories,
            }}
            minValue={0}
            maxValue={maxCount}
          />
          <AnnotationModeIndicator
            mode={ann.mode}
            onClose={() => ann.setMode("off")}
          />
        </div>
        {/* Color scale legend + annotation toolbar */}
        <div className="px-3 py-1.5 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-[10px] text-muted-foreground">0</span>
            <div
              className="flex-1 h-2 rounded-sm"
              style={{ background: legendGradient }}
            />
            <span className="text-[10px] text-muted-foreground">{maxCount}</span>
          </div>
          <div className="ml-3">
            <AnnotationToolbar
              mode={ann.mode}
              setMode={ann.setMode}
              annotationCount={ann.annotations.length}
              onShowPanel={() => ann.setShowPanel(true)}
            />
          </div>
        </div>
      </div>

      {ann.popover && (
        <AnnotationPopover
          x={ann.popover.x}
          y={ann.popover.y}
          initialLabel={ann.popover.initialLabel}
          initialColor={ann.popover.initialColor}
          initialNotes={ann.popover.initialNotes}
          timestamp={ann.popover.timestamp}
          timestampEnd={ann.popover.timestampEnd}
          showDelete={!!ann.popover.editingId}
          onSave={ann.handleSave}
          onDelete={ann.handleDelete}
          onDismiss={ann.closePopover}
        />
      )}

      <AnnotationsPanel
        open={ann.showPanel}
        onOpenChange={ann.setShowPanel}
        annotations={ann.annotations}
        onEdit={ann.handlePanelEdit}
        onDelete={(id) => ann.deleteAnnotation(id)}
      />
    </>
  );
}
