"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { usePanelData } from "@/hooks/use-panel-data";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatPanelValue,
  type ValueNotation,
} from "@/lib/dashboard/format-value";
import {
  aggregateOverWindow,
  sumOverWindow,
} from "@/lib/panels/aggregate";

interface StatPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

/** Seconds → "45s" / "3m 04s" / "1h 12m". Used when config.unit === "duration". */
function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function AnimatedValue({
  value,
  decimals,
  notation,
  className,
}: {
  value: number;
  decimals: number;
  notation?: ValueNotation;
  className?: string;
}) {
  const [displayed, setDisplayed] = useState(value);
  const prevRef = useRef(value);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = to;
    if (from === to) return;

    const duration = 300;
    const start = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(from + (to - from) * eased);
      if (progress < 1) frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value]);

  return (
    <span className={className}>
      {formatPanelValue(displayed, decimals, notation)}
    </span>
  );
}

/** Tiny inline sparkline — just an SVG polyline */
function Sparkline({
  points,
  color,
  width = 80,
  height = 24,
}: {
  points: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const pathPoints = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      className="shrink-0"
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        points={pathPoints}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StatPanel({ panel, timeRange }: StatPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(48);

  const {
    data,
    isLoading,
    error,
    sourceType,
    limits,
    connectionMeta,
    refresh,
  } = usePanelData({
    panel,
    timeRange,
    fetchLimits: true,
  });

  const panelMetrics = useMemo(() => panel.metrics || [], [panel.metrics]);
  const metric = panelMetrics[0] || connectionMeta?.columns?.[0]?.name;
  const sourceId = panel.config.sourceId || panel.sources?.[0];

  const { currentValue, recentPoints, trendPercent, metricName } =
    useMemo(() => {
      const empty = {
        currentValue: null as { value: number; timestamp: string } | null,
        recentPoints: [] as number[],
        trendPercent: 0,
        metricName: metric || "",
      };
      if (!data || !metric) return empty;

      const aggregation = panel.config.aggregation || "last";

      // Expand panel.metrics × panel.sources into fully-qualified keys
      // so fleet-wide aggregations (max ambient across 9 sources,
      // count of online devices, etc.) can reduce across sources
      // rather than silently picking metrics[0]/sources[0].
      const qualifiedKeys: string[] = [];
      for (const m of panelMetrics) {
        if (m.includes(":")) {
          qualifiedKeys.push(m);
        } else if (panel.sources && panel.sources.length > 0) {
          for (const s of panel.sources) qualifiedKeys.push(`${s}:${m}`);
        } else {
          qualifiedKeys.push(m);
        }
      }
      const keysWithData = qualifiedKeys.filter(
        (k) => (data[k] || []).length > 0,
      );

      // Multi-source path — reduce across each key's latest value.
      // "count" is also handled here so it works even with one key: panel-level
      // "count" means number of SOURCES with data in the window (see
      // lib/types/dashboard.ts Aggregation) — NOT the raw event count. The
      // tier-independent event count lives in lib/panels/aggregate.ts
      // countOverWindow and only applies where a series is reduced over time.
      if (aggregation === "count" || keysWithData.length > 1) {
        const derivedName = metric.includes(":")
          ? metric.split(":")[1]
          : metric;

        if (aggregation === "count") {
          let latestTs = "";
          for (const k of keysWithData) {
            const last = data[k][data[k].length - 1];
            if (last?.timestamp && last.timestamp > latestTs) {
              latestTs = last.timestamp;
            }
          }
          return {
            currentValue: {
              value: keysWithData.length,
              timestamp: latestTs || new Date().toISOString(),
            },
            recentPoints: [],
            trendPercent: 0,
            metricName: derivedName,
          };
        }

        const latestPerKey: { v: number; ts: string }[] = [];
        for (const k of keysWithData) {
          const pts = data[k];
          const last = pts[pts.length - 1];
          if (typeof last?.value === "number") {
            latestPerKey.push({ v: last.value, ts: last.timestamp });
          }
        }
        if (latestPerKey.length === 0) return empty;

        const vs = latestPerKey.map((x) => x.v);
        let agg: number;
        switch (aggregation) {
          case "avg":
            agg = vs.reduce((a, b) => a + b, 0) / vs.length;
            break;
          case "min":
            agg = Math.min(...vs);
            break;
          case "max":
            agg = Math.max(...vs);
            break;
          case "sum":
            // Σ of raw event values across every source's whole window
            // (p.sum ?? p.value per point) — NOT Σ of per-source latest
            // values: on downsampled tiers "latest value" is a bucket
            // average, which makes counter totals tier-dependent. Matches
            // the single-source path's sum-over-window semantics.
            agg = keysWithData.reduce(
              (acc, k) => acc + sumOverWindow(data[k]),
              0,
            );
            break;
          case "last":
          default: {
            const newest = latestPerKey.reduce((a, b) => (a.ts > b.ts ? a : b));
            agg = newest.v;
            break;
          }
        }
        const latestTs = latestPerKey.reduce((a, b) =>
          a.ts > b.ts ? a : b,
        ).ts;
        return {
          currentValue: { value: agg, timestamp: latestTs },
          // Sparkline + trend across multiple sources is ambiguous
          // (whose time series?). Intentionally omitted — the value
          // already conveys current fleet state.
          recentPoints: [],
          trendPercent: 0,
          metricName: derivedName,
        };
      }

      // Single-source path — aggregate over time for one (source, metric).
      const qualifiedKey = sourceId ? `${sourceId}:${metric}` : metric;
      let points = data[qualifiedKey] || data[metric] || [];
      let resolvedName = metric.includes(":") ? metric.split(":")[1] : metric;

      if (points.length === 0) {
        for (const key of Object.keys(data)) {
          if (data[key] && data[key].length > 0) {
            points = data[key];
            resolvedName = key.includes(":") ? key.split(":")[1] : key;
            break;
          }
        }
      }

      if (points.length === 0) return empty;

      const last = points[points.length - 1];
      const vals = points
        .map((p) => p.value)
        .filter((v): v is number => typeof v === "number");
      const recent = vals.slice(-(panel.config.trendWindow ?? 20));

      // Tier-independent reduction (lib/panels/aggregate.ts): sum/avg use the
      // per-bucket sum/count carried by downsampled points so a counter shows
      // the same total whether the window hit raw data or a rollup tier.
      // ("count" never reaches this path — it's intercepted above as
      // number-of-sources; the lib's count means raw event count.)
      let aggregatedValue: number | string = last.value;
      if (vals.length > 0) {
        aggregatedValue = aggregateOverWindow(points, aggregation) ?? last.value;
      }

      let trend = 0;
      if (recent.length >= 4) {
        const half = Math.floor(recent.length / 2);
        const avgOld = recent.slice(0, half).reduce((a, b) => a + b, 0) / half;
        const avgNew =
          recent.slice(half).reduce((a, b) => a + b, 0) /
          (recent.length - half);
        trend = avgOld !== 0 ? ((avgNew - avgOld) / Math.abs(avgOld)) * 100 : 0;
      }

      return {
        currentValue: { value: aggregatedValue, timestamp: last.timestamp },
        recentPoints: recent,
        trendPercent: trend,
        metricName: resolvedName,
      };
    }, [
      data,
      metric,
      sourceId,
      panelMetrics,
      panel.sources,
      panel.config.trendWindow,
      panel.config.aggregation,
    ]);

  // Responsive font sizing
  const measureAndSize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { width, height } = container.getBoundingClientRect();
    const target = Math.min(width * 0.25, height * 0.4);
    setFontSize(Math.max(20, Math.min(72, target)));
  }, []);

  useEffect(() => {
    measureAndSize();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(measureAndSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureAndSize]);

  const decimals = panel.config.decimals ?? 2;
  const unit = panel.config.unit || "";
  const numericValue =
    typeof currentValue?.value === "number"
      ? currentValue.value
      : Number(currentValue?.value);
  const isNumeric = !Number.isNaN(numericValue) && currentValue !== null;

  if (isLoading && !currentValue) {
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

  if (!currentValue) {
    return (
      <PanelEmptyState
        reason={sourceType === "connection" ? "no_data" : "waiting_for_data"}
        debugInfo={{
          sourceType,
          rowCount: connectionMeta?.rowCount || 0,
          columns: connectionMeta?.columns?.map((c) => c.name),
        }}
        onRetry={refresh}
      />
    );
  }

  // Limit check
  const limitCheck = metric ? limits?.[metric] : undefined;
  let limitStatus: "normal" | "warning" | "critical" = "normal";
  if (isNumeric && limitCheck) {
    const { min, max } = limitCheck;
    if (
      (min != null && numericValue < min) ||
      (max != null && numericValue > max)
    ) {
      limitStatus = "critical";
    } else if (min != null && max != null) {
      const range = max - min;
      const threshold = range * 0.15;
      if (numericValue < min + threshold || numericValue > max - threshold) {
        limitStatus = "warning";
      }
    }
  }

  const valueColor =
    limitStatus === "critical"
      ? "text-red-500"
      : limitStatus === "warning"
        ? "text-amber-500"
        : "text-foreground";

  const trendColor =
    Math.abs(trendPercent) < 1
      ? "text-muted-foreground"
      : trendPercent > 0
        ? "text-emerald-500"
        : "text-red-400";

  const TrendIcon =
    Math.abs(trendPercent) < 1
      ? Minus
      : trendPercent > 0
        ? TrendingUp
        : TrendingDown;

  const sparkColor =
    limitStatus === "critical"
      ? "#ef4444"
      : limitStatus === "warning"
        ? "#f59e0b"
        : "#6366f1";

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col items-center justify-center px-4 py-3 gap-1"
    >
      {/* Metric name — only when the panel has no title of its own; the grid
          chrome already names titled panels, and a raw ALL-CAPS metric slug
          above the value read as noise. */}
      {!panel.title && (
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider truncate max-w-full">
          {metricName}
        </span>
      )}

      {/* Value */}
      <div
        className={cn(
          "font-semibold tabular-nums leading-none transition-colors",
          valueColor,
        )}
        style={{ fontSize: `${fontSize}px` }}
      >
        {isNumeric ? (
          unit === "duration" ? (
            formatDuration(numericValue)
          ) : (
            <AnimatedValue
              value={numericValue}
              decimals={decimals}
              notation={panel.config.notation}
            />
          )
        ) : (
          String(currentValue.value)
        )}
        {unit && unit !== "duration" && (
          <span
            className="text-muted-foreground font-normal ml-1"
            style={{ fontSize: `${Math.max(12, fontSize * 0.3)}px` }}
          >
            {unit}
          </span>
        )}
      </div>
      {(panel.config.showSparkline !== false ||
        panel.config.showTrend !== false) && (
        <div className="flex items-center gap-2 mt-1">
          {panel.config.showSparkline !== false && recentPoints.length >= 2 && (
            <Sparkline
              points={recentPoints}
              color={sparkColor}
              width={60}
              height={18}
            />
          )}
          {panel.config.showTrend !== false && recentPoints.length >= 4 && (
            <div
              className={cn(
                "flex items-center gap-0.5 text-xs font-medium",
                trendColor,
              )}
            >
              <TrendIcon className="h-3 w-3" />
              <span>{Math.abs(trendPercent).toFixed(1)}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
