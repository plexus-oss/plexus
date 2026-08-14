"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { usePanelData } from "@/hooks/use-panel-data";
import { useUserSettings } from "@/context/user-settings-context";
import { formatTimeInZone, getTimezoneAbbr } from "@/lib/timezone";
import { getTimeRangeBounds } from "@/lib/types/dashboard";
import type {
  Panel,
  TimeRange,
  AssocCategory,
  GlyphShape,
  ConnectionDataSource,
} from "@/lib/types/dashboard";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import { useDashboardInteraction } from "@/components/dashboard/dashboard-interaction-context";
import { useChartDomain } from "@/hooks/use-chart-domain";
import { useChartPanZoom } from "@/hooks/use-chart-pan-zoom";
import {
  autoDetectColumns,
  resolveCategories,
  rowsToPoints,
  buildSamplePoints,
  SAMPLE_CATEGORIES,
  type AssocRow,
} from "@/lib/panels/assoc-scatter";

interface AssocScatterPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

const MARGIN = { top: 14, right: 18, bottom: 34, left: 66 };
const MARKER_R = 5;
const LANE_PAD = 26;

/** Scout's "wrong measurement" black adapts to the theme so it shows on dark. */
function resolveColor(color: string): string {
  const c = color.toLowerCase();
  if (c === "#000" || c === "#000000" || c === "#111827" || c === "black") {
    return "hsl(var(--foreground))";
  }
  return color;
}

function Glyph({
  shape,
  cx,
  cy,
  color,
  filled,
  r = MARKER_R,
}: {
  shape: GlyphShape;
  cx: number;
  cy: number;
  color: string;
  filled: boolean;
  r?: number;
}) {
  const fill = filled ? color : "none";
  const common = {
    fill,
    stroke: color,
    strokeWidth: filled ? 0.75 : 1.6,
    vectorEffect: "non-scaling-stroke" as const,
  };
  switch (shape) {
    case "diamond":
      return (
        <polygon
          points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
          {...common}
        />
      );
    case "square":
      return (
        <rect
          x={cx - r * 0.9}
          y={cy - r * 0.9}
          width={r * 1.8}
          height={r * 1.8}
          {...common}
        />
      );
    case "triangle":
      return (
        <polygon
          points={`${cx},${cy - r} ${cx + r},${cy + r * 0.85} ${cx - r},${cy + r * 0.85}`}
          {...common}
        />
      );
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} />;
  }
}

interface Hover {
  px: number;
  py: number;
  point: AssocRow;
  category: AssocCategory | undefined;
}

export function AssocScatterPanel({
  panel,
  timeRange,
}: AssocScatterPanelProps) {
  const { settings } = useUserSettings();
  const tz = settings.timezone;
  const tz12 = settings.use12HourFormat;

  const { isLoading, error, sourceType, connectionMeta } = usePanelData({
    panel,
    timeRange,
  });

  // ── Size tracking (callback ref + ResizeObserver) ──
  const containerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const setContainer = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const r = node.getBoundingClientRect();
    setSize({ width: r.width, height: r.height });
    const obs = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e)
        setSize({ width: e.contentRect.width, height: e.contentRect.height });
    });
    obs.observe(node);
    observerRef.current = obs;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  const [hover, setHover] = useState<Hover | null>(null);

  // ── Column bindings ──
  const cfg = panel.config;
  const conn =
    panel.dataSource?.type === "connection"
      ? (panel.dataSource as ConnectionDataSource)
      : undefined;
  const cols = useMemo(() => {
    const detected = connectionMeta
      ? autoDetectColumns(connectionMeta.columns)
      : {};
    return {
      // X is time: prefer the dataSource's timeColumn (also drives time-filtering).
      timeColumn: conn?.timeColumn ?? cfg.timeColumn ?? detected.timeColumn,
      yColumn: cfg.yColumn ?? detected.yColumn,
      categoryColumn: cfg.categoryColumn ?? detected.categoryColumn,
    };
  }, [
    conn?.timeColumn,
    cfg.timeColumn,
    cfg.yColumn,
    cfg.categoryColumn,
    connectionMeta,
  ]);

  const realPoints = useMemo(
    () => (connectionMeta ? rowsToPoints(connectionMeta.rows, cols) : []),
    [connectionMeta, cols],
  );
  const isSample = realPoints.length === 0;

  // ── Shared dashboard interaction (synced crosshair, pan/zoom view window) ──
  const {
    hoveredTimestamp,
    setHoveredTimestamp,
    viewWindow,
    setViewWindow,
    onTimeRangeChange: contextTimeRangeChange,
  } = useDashboardInteraction();

  // Freeze data while panning so streaming points don't jitter under the cursor.
  // Captured into state via a guarded render-time adjustment (instead of a ref
  // written during render): snapshot realPoints when a viewWindow opens, release
  // it when the viewWindow closes.
  const [frozenPoints, setFrozenPoints] = useState<AssocRow[] | null>(null);
  if (viewWindow && frozenPoints === null) {
    setFrozenPoints(realPoints);
  } else if (!viewWindow && frozenPoints !== null) {
    setFrozenPoints(null);
  }
  const livePoints = viewWindow && frozenPoints ? frozenPoints : realPoints;

  const latestDataTime = useMemo(() => {
    let max = 0;
    for (const p of livePoints) if (p.x > max) max = p.x;
    return max || undefined;
  }, [livePoints]);

  const xDomain = useChartDomain({
    timeRange,
    viewWindow,
    annotationMode: "off",
    latestDataTime,
  });

  // Sample points span the visible domain so the panel looks designed pre-data.
  const points = useMemo(() => {
    if (!isSample) return livePoints;
    const [s, e] = xDomain ?? [
      getTimeRangeBounds(timeRange).start.getTime(),
      getTimeRangeBounds(timeRange).end.getTime(),
    ];
    return buildSamplePoints(s, e);
  }, [isSample, livePoints, xDomain, timeRange]);

  // ── Legend categories ──
  const categories = useMemo(() => {
    if (isSample)
      return cfg.assocCategories?.length
        ? cfg.assocCategories
        : SAMPLE_CATEGORIES;
    const present = Array.from(new Set(points.map((p) => p.category)));
    return resolveCategories(cfg.assocCategories, present);
  }, [isSample, cfg.assocCategories, points]);
  const styleFor = useMemo(() => {
    const m = new Map<string, AssocCategory>();
    for (const c of categories) m.set(c.value, c);
    return m;
  }, [categories]);

  // ── Y lanes (numeric-sorted when possible) ──
  const lanes = useMemo(() => {
    const uniq = Array.from(new Set(points.map((p) => p.y)));
    uniq.sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });
    return uniq;
  }, [points]);

  const showGrid = cfg.showGrid !== false;
  const showLegend = cfg.showLegend !== false;
  const innerW = Math.max(0, size.width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(0, size.height - MARGIN.top - MARGIN.bottom);

  const xPx = useCallback(
    (ms: number) => {
      if (!xDomain || innerW <= 0) return MARGIN.left;
      const t = (ms - xDomain[0]) / (xDomain[1] - xDomain[0] || 1);
      return MARGIN.left + t * innerW;
    },
    [xDomain, innerW],
  );
  const yPx = useCallback(
    (lane: string) => {
      const i = lanes.indexOf(lane);
      const n = lanes.length;
      if (n <= 1) return MARGIN.top + innerH / 2;
      const top = MARGIN.top + LANE_PAD;
      return top + (i / (n - 1)) * Math.max(0, innerH - 2 * LANE_PAD);
    },
    [lanes, innerH],
  );

  // ── Pan / zoom (wheel zoom, drag pan, dbl-click/Esc reset) + brush — shared hook ──
  const panMargin = useMemo(
    () => ({ left: MARGIN.left, right: MARGIN.right }),
    [],
  );
  const handlePanZoomChange = useCallback(
    (start: number, end: number) => {
      contextTimeRangeChange({
        type: "absolute",
        value: `${new Date(start).toISOString()}/${new Date(end).toISOString()}`,
      });
    },
    [contextTimeRangeChange],
  );
  const handlePanStart = useCallback(() => {
    setHoveredTimestamp(null);
    setHover(null);
  }, [setHoveredTimestamp]);
  const { isPanning, brushRect } = useChartPanZoom({
    containerRef,
    timeRange,
    setViewWindow,
    onTimeRangeChange: handlePanZoomChange,
    // Double-click / Escape restores the pre-zoom TimeRange directly, so a
    // relative range ("last 15m") goes back to being live after zooming.
    onTimeRangeReset: contextTimeRangeChange,
    onPanStart: handlePanStart,
    margin: panMargin,
  });

  // ── X time ticks ──
  const xTicks = useMemo(() => {
    if (!xDomain || innerW <= 0) return [];
    const APPROX = 92;
    const count = Math.max(2, Math.min(8, Math.floor(innerW / APPROX)));
    const [s, e] = xDomain;
    const rangeMs = e - s;
    const showSeconds = rangeMs <= 15 * 60 * 1000;
    return Array.from({ length: count + 1 }, (_, i) => {
      const ms = s + (i / count) * rangeMs;
      return {
        ms,
        label: formatTimeInZone(new Date(ms), tz, tz12, showSeconds),
      };
    });
  }, [xDomain, innerW, tz, tz12]);

  // ── Synced crosshair ──
  // Plain handler (not useCallback): it reads the `isPanning` ref, which the
  // React Compiler can't reconcile with a manual dependency array. The compiler
  // memoizes it automatically.
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning.current || !xDomain) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const iw = rect.width - MARGIN.left - MARGIN.right;
    if (iw <= 0) return;
    const x = Math.max(
      MARGIN.left,
      Math.min(e.clientX - rect.left, rect.width - MARGIN.right),
    );
    const absMs =
      xDomain[0] + ((x - MARGIN.left) / iw) * (xDomain[1] - xDomain[0]);
    setHoveredTimestamp(new Date(absMs).toISOString());
  };
  const handleMouseLeave = useCallback(() => {
    setHoveredTimestamp(null);
    setHover(null);
  }, [setHoveredTimestamp]);

  // ── States ──
  if (isLoading && !connectionMeta) {
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
          sourceType: sourceType === "connection" ? "connection" : "realtime",
          errorMessage: error instanceof Error ? error.message : String(error),
        }}
      />
    );
  }

  const xLabel = cfg.xAxisLabel;
  const yLabel = cfg.yAxisLabel ?? cols.yColumn ?? "";
  const tzAbbr = getTimezoneAbbr(tz);
  const crosshairPx =
    hoveredTimestamp && xDomain && innerW > 0
      ? (() => {
          const ms = new Date(hoveredTimestamp).getTime();
          const px =
            MARGIN.left +
            ((ms - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * innerW;
          return px >= MARGIN.left && px <= size.width - MARGIN.right
            ? px
            : null;
        })()
      : null;

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <div
        ref={setContainer}
        className="relative flex-1 min-h-0 select-none cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {size.width > 0 && xDomain && (
          <svg width={size.width} height={size.height} className="block">
            {/* Y lanes */}
            {lanes.map((lane) => {
              const y = yPx(lane);
              return (
                <g key={`lane-${lane}`}>
                  {showGrid && (
                    <line
                      x1={MARGIN.left}
                      x2={size.width - MARGIN.right}
                      y1={y}
                      y2={y}
                      className="stroke-border"
                      strokeWidth={1}
                      strokeDasharray="2 4"
                    />
                  )}
                  <text
                    x={MARGIN.left - 10}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="central"
                    className="fill-muted-foreground"
                    fontSize={11}
                  >
                    {lane}
                  </text>
                </g>
              );
            })}

            {/* X time ticks */}
            {xTicks.map((t, i) => {
              const x = xPx(t.ms);
              return (
                <g key={`xt-${i}`}>
                  {showGrid && (
                    <line
                      x1={x}
                      x2={x}
                      y1={MARGIN.top}
                      y2={size.height - MARGIN.bottom}
                      className="stroke-border"
                      strokeWidth={1}
                      strokeDasharray="2 4"
                    />
                  )}
                  <text
                    x={x}
                    y={size.height - MARGIN.bottom + 16}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    fontSize={11}
                  >
                    {t.label}
                  </text>
                </g>
              );
            })}

            {/* Axis labels */}
            <text
              x={MARGIN.left + innerW / 2}
              y={size.height - 4}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {xLabel ? `${xLabel} (${tzAbbr})` : `Time (${tzAbbr})`}
            </text>
            {yLabel && (
              <text
                transform={`translate(13 ${MARGIN.top + innerH / 2}) rotate(-90)`}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={11}
              >
                {yLabel}
              </text>
            )}

            {/* Synced crosshair */}
            {crosshairPx !== null && (
              <line
                x1={crosshairPx}
                x2={crosshairPx}
                y1={MARGIN.top}
                y2={size.height - MARGIN.bottom}
                className="stroke-muted-foreground/40"
                strokeWidth={1}
              />
            )}

            {/* Points (clipped to the visible domain) */}
            {points.slice(0, 8000).map((p, idx) => {
              if (p.x < xDomain[0] || p.x > xDomain[1]) return null;
              const style = styleFor.get(p.category);
              const cx = xPx(p.x);
              const cy = yPx(p.y);
              return (
                <g
                  key={idx}
                  onMouseEnter={() =>
                    setHover({ px: cx, py: cy, point: p, category: style })
                  }
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: "pointer" }}
                >
                  <circle cx={cx} cy={cy} r={MARKER_R + 4} fill="transparent" />
                  <Glyph
                    shape={style?.shape ?? "circle"}
                    cx={cx}
                    cy={cy}
                    color={resolveColor(style?.color ?? "#6b7280")}
                    filled={style?.filled ?? true}
                  />
                </g>
              );
            })}
          </svg>
        )}

        {/* Brush overlay during cmd+scroll / drag */}
        {brushRect && innerH > 0 && (
          <div
            className="absolute pointer-events-none z-10 bg-primary/15 border-x-2 border-primary"
            style={{
              left: brushRect.left,
              top: MARGIN.top,
              width: brushRect.width,
              height: innerH,
            }}
          />
        )}

        {/* Point tooltip */}
        {hover && xDomain && (
          <div
            className="pointer-events-none absolute z-20 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-md"
            style={{
              left: Math.min(hover.px + 10, size.width - 170),
              top: Math.max(hover.py - 10, 4),
            }}
          >
            <div className="flex items-center gap-1.5 font-medium text-popover-foreground">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  background: resolveColor(hover.category?.color ?? "#6b7280"),
                }}
              />
              {hover.category?.label ?? (hover.point.category || "—")}
            </div>
            <div className="mt-0.5 text-muted-foreground tabular-nums">
              {cols.yColumn ?? "id"}: {hover.point.y}
            </div>
            <div className="text-muted-foreground tabular-nums">
              {formatTimeInZone(new Date(hover.point.x), tz, tz12, true)}
            </div>
          </div>
        )}

        {/* Design-mode badge */}
        {isSample && (
          <div className="pointer-events-none absolute right-2 top-2 rounded bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Sample
          </div>
        )}
      </div>

      {/* Legend */}
      {showLegend && categories.length > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 px-3 py-1.5">
          {categories.map((c) => (
            <span
              key={c.value}
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <svg width={14} height={14} className="overflow-visible">
                <Glyph
                  shape={c.shape}
                  cx={7}
                  cy={7}
                  color={resolveColor(c.color)}
                  filled={c.filled}
                  r={4.5}
                />
              </svg>
              {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
