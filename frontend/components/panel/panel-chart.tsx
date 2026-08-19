"use client";

/**
 * <PanelChart> — the shared, shell-free panel rendering core.
 *
 * The seam that makes the product panel and the embed ONE component. Pure and
 * props-driven: no data fetching, no user-settings/router/shell hooks, no Next
 * imports — so it renders identically inside the product (chart-panel wraps it)
 * and inside a customer's React app via the embed.
 *
 * Owns the shared interaction core: the chart, pan/zoom (2b), and the hover
 * crosshair (2c) — all driven by injected geometry + callbacks. Because pan/zoom
 * and hover live together here, the hover handler reads the gesture's `isPanning`
 * directly (no cross-component bridge). Operator-only overlays that need shell
 * data (alert bands, annotations, the pinned-time tracker) stay in chart-panel
 * and ride the `overlay` slot.
 */

import { useCallback, useMemo, useRef } from "react";
import {
  UnifiedChart,
  type UnifiedChartProps,
} from "@/components/ui/charts/unified-chart";
import type { UnifiedSeries } from "@/components/ui/charts/unified-renderer";
import { useChartPanZoom } from "@/hooks/use-chart-pan-zoom";
import type { TimeRange } from "@/lib/types/dashboard";
import type { ViewWindow } from "@/components/dashboard/dashboard-interaction-context";
import type { HoveredValue } from "@/components/dashboard/dashboard-interaction-context";

/** Shared chart geometry the interaction overlays need, computed by the caller. */
export interface PanelChartGeometry {
  xDomain: [number, number] | null;
  innerWidth: number;
  innerHeight: number;
  chartSize: { width: number; height: number };
  /** Time-axis formatter for the brush selection labels. */
  formatter: (ms: number) => string;
}

/** Shift-drag zoom / pan. The environment injects commit behavior. */
export interface PanelChartPanZoom {
  timeRange: TimeRange;
  enabled?: boolean;
  setViewWindow: (window: ViewWindow | null) => void;
  onTimeRangeChange: (start: number, end: number) => void;
  onTimeRangeReset?: (range: TimeRange) => void;
  onPanStart?: () => void;
}

/** Hover crosshair. The environment owns the (possibly cross-panel) hover state. */
export interface PanelChartHover {
  showCrosshair: boolean;
  syncTooltips: boolean;
  hoveredTimestamp: string | null;
  timeSeries: UnifiedSeries[];
  ghostSeries: UnifiedSeries[];
  onHover: (ts: string) => void;
  onHoverValues: (values: HoveredValue[]) => void;
  onClearHover: () => void;
}

export interface PanelChartProps {
  type: UnifiedChartProps["type"];
  series: UnifiedSeries[];

  // ── UnifiedChart passthrough (all optional; sensible viewer defaults) ──
  margin?: UnifiedChartProps["margin"];
  showGrid?: boolean;
  showXAxis?: boolean;
  showYAxis?: boolean;
  showTooltip?: boolean;
  showLegend?: boolean;
  smooth?: boolean;
  showDataPoints?: boolean;
  stacked?: boolean;
  orientation?: UnifiedChartProps["orientation"];
  referenceLines?: UnifiedChartProps["referenceLines"];
  yAxis?: UnifiedChartProps["yAxis"];
  xAxis?: UnifiedChartProps["xAxis"];
  timeAxis?: boolean;

  height?: number | string;
  width?: number | string;

  // ── container (product wrapper forwards these; embed omits them) ──
  containerRef?: React.Ref<HTMLDivElement>;
  containerClassName?: string;
  containerStyle?: React.CSSProperties;
  onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
  onMouseUp?: React.MouseEventHandler<HTMLDivElement>;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  overlay?: React.ReactNode;

  // ── shared interactions (product; require `geometry`) ──
  geometry?: PanelChartGeometry;
  panZoom?: PanelChartPanZoom;
  hover?: PanelChartHover;

  readOnly?: boolean;
}

export function PanelChart(props: PanelChartProps) {
  // Interactive (product) path owns pan/zoom + hover; static (embed) path is a
  // plain chart. Splitting keeps the pan/zoom hook out of the static path.
  if (props.panZoom || props.hover) return <InteractiveChart {...props} />;
  return <ChartFrame {...props} containerRef={props.containerRef} />;
}

// ============================================================================
// ChartFrame — container + UnifiedChart + overlays (shared by both paths)
// ============================================================================

interface ChartFrameProps extends PanelChartProps {
  extraOverlay?: React.ReactNode;
}

function ChartFrame({
  type,
  series,
  margin,
  showGrid = true,
  showXAxis = true,
  showYAxis = true,
  showTooltip = true,
  showLegend = true,
  smooth,
  showDataPoints,
  stacked,
  orientation,
  referenceLines,
  yAxis,
  xAxis,
  timeAxis = true,
  height = "100%",
  width = "100%",
  containerRef,
  containerClassName = "relative h-full w-full",
  containerStyle,
  onMouseMove,
  onMouseLeave,
  onMouseDown,
  onMouseUp,
  onPointerDown,
  onClick,
  overlay,
  extraOverlay,
}: ChartFrameProps) {
  const derivedXAxis = useMemo<UnifiedChartProps["xAxis"]>(() => {
    if (xAxis) return xAxis;
    if (!timeAxis) return undefined;
    return { type: "time", formatter: makeTimeFormatter(seriesSpanMs(series)) };
  }, [xAxis, timeAxis, series]);

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      style={containerStyle}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <UnifiedChart
        type={type}
        series={series}
        width={width}
        height={height}
        margin={margin}
        showGrid={showGrid}
        showXAxis={showXAxis}
        showYAxis={showYAxis}
        showTooltip={showTooltip}
        showLegend={showLegend}
        smooth={smooth}
        showDataPoints={showDataPoints}
        stacked={stacked}
        orientation={orientation}
        referenceLines={referenceLines}
        yAxis={yAxis}
        xAxis={derivedXAxis}
      />
      {extraOverlay}
      {overlay}
    </div>
  );
}

// ============================================================================
// InteractiveChart — pan/zoom + hover (product). isPanning stays internal.
// ============================================================================

function InteractiveChart(props: PanelChartProps) {
  const { panZoom, hover, geometry, containerRef, margin } = props;

  const localRef = useRef<HTMLDivElement | null>(null);
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      localRef.current = node;
      assignRef(containerRef, node);
    },
    [containerRef],
  );

  const m = { top: 0, right: 0, bottom: 0, left: 0, ...(margin ?? {}) };

  // panZoom is always present on the interactive path (product passes both).
  const pz = panZoom!;
  const { isPanning, brushRect } = useChartPanZoom({
    containerRef: localRef,
    timeRange: pz.timeRange,
    enabled: pz.enabled,
    setViewWindow: pz.setViewWindow,
    onTimeRangeChange: pz.onTimeRangeChange,
    onTimeRangeReset: pz.onTimeRangeReset,
    onPanStart: pz.onPanStart,
    margin: m,
  });

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Hover crosshair — suppressed mid-gesture (isPanning, read directly).
      if (hover && geometry && hover.showCrosshair && !isPanning.current) {
        const rect = localRef.current?.getBoundingClientRect();
        const { xDomain } = geometry;
        if (rect && xDomain) {
          const iw = rect.width - m.left - m.right;
          if (iw > 0) {
            const x = Math.max(
              m.left,
              Math.min(e.clientX - rect.left, rect.width - m.right),
            );
            const absTime =
              xDomain[0] + ((x - m.left) / iw) * (xDomain[1] - xDomain[0]);
            hover.onHover(new Date(absTime).toISOString());
            const xRange = xDomain[1] - xDomain[0];
            const values: HoveredValue[] = [];
            for (const s of [...hover.timeSeries, ...hover.ghostSeries]) {
              const c = binarySearchClosestX(s.data, absTime, xRange * 0.05);
              if (c)
                values.push({ name: s.name, value: c.y, color: s.color ?? "" });
            }
            if (values.length > 0) hover.onHoverValues(values);
          }
        }
      }
      props.onMouseMove?.(e); // annotation-mode passthrough
    },
    // isPanning + localRef are stable refs; m is derived from margin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hover, geometry, m.left, m.right, props.onMouseMove],
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      hover?.onClearHover();
      props.onMouseLeave?.(e);
    },
    [hover, props],
  );

  const extraOverlay = (
    <>
      {brushRect && geometry && (
        <BrushOverlay brushRect={brushRect} geometry={geometry} margin={m} />
      )}
      {hover &&
        geometry &&
        hover.syncTooltips &&
        hover.hoveredTimestamp &&
        geometry.xDomain &&
        geometry.innerWidth > 0 &&
        (() => {
          const hoverMs = new Date(hover.hoveredTimestamp).getTime();
          const [d0, d1] = geometry.xDomain;
          const xRange = d1 - d0;
          if (xRange <= 0) return null;
          const px = m.left + ((hoverMs - d0) / xRange) * geometry.innerWidth;
          if (px < m.left || px > geometry.chartSize.width - m.right)
            return null;
          return (
            <div
              className="absolute pointer-events-none z-10 bg-muted-foreground/40"
              style={{
                left: px,
                top: m.top,
                width: 1,
                height: geometry.innerHeight,
              }}
            />
          );
        })()}
    </>
  );

  return (
    <ChartFrame
      {...props}
      containerRef={mergedRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      extraOverlay={extraOverlay}
    />
  );
}

// ============================================================================
// Brush overlay (pan/zoom selection)
// ============================================================================

function BrushOverlay({
  brushRect,
  geometry,
  margin,
}: {
  brushRect: { left: number; width: number };
  geometry: PanelChartGeometry;
  margin: { top: number; right: number; bottom: number; left: number };
}) {
  const { xDomain, innerWidth, innerHeight, formatter } = geometry;
  if (!xDomain || innerWidth <= 0) return null;
  const xRange = xDomain[1] - xDomain[0];
  const tStart = xDomain[0] + ((brushRect.left - margin.left) / innerWidth) * xRange;
  const tEnd = tStart + (brushRect.width / innerWidth) * xRange;
  const durMs = Math.max(0, tEnd - tStart);
  const fmtDur = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
    if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
    return `${(ms / 86_400_000).toFixed(1)}d`;
  };
  return (
    <>
      <div
        className="absolute pointer-events-none z-10 bg-primary/15 border-x-2 border-primary"
        style={{
          left: brushRect.left,
          top: margin.top,
          width: brushRect.width,
          height: innerHeight,
        }}
      />
      {brushRect.width > 4 && (
        <>
          <div
            className="absolute pointer-events-none z-20 text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary text-primary-foreground whitespace-nowrap"
            style={{
              left: brushRect.left + brushRect.width / 2,
              top: margin.top + 4,
              transform: "translateX(-50%)",
            }}
          >
            {fmtDur(durMs)}
          </div>
          <div
            className="absolute pointer-events-none z-20 text-[10px] font-mono px-1 py-0.5 rounded bg-background/90 border border-border text-foreground whitespace-nowrap"
            style={{
              left: brushRect.left,
              top: margin.top + innerHeight + 2,
              transform: "translateX(-50%)",
            }}
          >
            {formatter(tStart)}
          </div>
          <div
            className="absolute pointer-events-none z-20 text-[10px] font-mono px-1 py-0.5 rounded bg-background/90 border border-border text-foreground whitespace-nowrap"
            style={{
              left: brushRect.left + brushRect.width,
              top: margin.top + innerHeight + 2,
              transform: "translateX(-50%)",
            }}
          >
            {formatter(tEnd)}
          </div>
        </>
      )}
    </>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function assignRef(
  ref: React.Ref<HTMLDivElement> | undefined,
  node: HTMLDivElement | null,
) {
  if (typeof ref === "function") ref(node);
  else if (ref)
    (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
}

/** Binary search for the closest point by x — O(log n). Shared with chart-panel. */
export function binarySearchClosestX(
  data: Array<{ x: number; y: number }>,
  targetX: number,
  maxDistance: number,
): { x: number; y: number } | null {
  if (data.length === 0) return null;
  let left = 0;
  let right = data.length - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (data[mid].x < targetX) left = mid + 1;
    else right = mid;
  }
  let closestPoint: { x: number; y: number } | null = null;
  let closestDist = Infinity;
  for (const idx of [left - 1, left, left + 1]) {
    if (idx < 0 || idx >= data.length) continue;
    const dist = Math.abs(data[idx].x - targetX);
    if (dist < closestDist && dist <= maxDistance) {
      closestDist = dist;
      closestPoint = data[idx];
    }
  }
  return closestPoint;
}

/** Total time span (ms) covered by all series' points, for tick formatting. */
export function seriesSpanMs(series: UnifiedSeries[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series)
    for (const p of s.data) {
      if (p.x < min) min = p.x;
      if (p.x > max) max = p.x;
    }
  const span = max - min;
  return Number.isFinite(span) ? span : 0;
}

/** Choose a tick format from the visible time span (browser locale). */
export function makeTimeFormatter(spanMs: number): (ms: number) => string {
  const DAY = 86_400_000;
  const opts: Intl.DateTimeFormatOptions =
    spanMs > 3 * DAY
      ? { month: "short", day: "numeric" }
      : spanMs > DAY
        ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
        : spanMs > 90 * 60_000
          ? { hour: "2-digit", minute: "2-digit" }
          : { hour: "2-digit", minute: "2-digit", second: "2-digit" };
  const fmt = new Intl.DateTimeFormat(undefined, opts);
  return (ms: number) => fmt.format(new Date(ms));
}
