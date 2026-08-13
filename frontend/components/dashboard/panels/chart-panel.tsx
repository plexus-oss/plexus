"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { UnifiedChart } from "@/components/ui/charts/unified-chart";
import { usePanelData } from "@/hooks/use-panel-data";
import { PanelRestrictedState } from "./restricted-state";
import { useUserSettings } from "@/context/user-settings-context";
import { formatTimeInZone, getTimezoneAbbr } from "@/lib/timezone";
import { DataTable } from "@/components/tables/data-table";
import type { ChartType } from "@/lib/validation/chart-schemas";
import type {
  Panel,
  TimeRange,
  ConnectionDataSource,
} from "@/lib/types/dashboard";
import { getTimeRangeBounds } from "@/lib/types/dashboard";
import { Table2, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatValue,
  getTicks,
  measureTextWidth,
} from "@/components/ui/charts/base-chart";
import { formatPanelValue } from "@/lib/dashboard/format-value";
import { Spinner } from "@/components/ui/spinner";
import {
  PanelEmptyState,
  type EmptyStateReason,
} from "@/components/dashboard/panels/panel-empty-state";
import {
  useDashboardInteraction,
  type HoveredValue,
} from "@/components/dashboard/dashboard-interaction-context";
import { useAnnotationMode } from "@/hooks/use-annotation-mode";
import {
  AnnotationToolbar,
  AnnotationModeIndicator,
} from "@/components/annotations/annotation-toolbar";
import { AnnotationPopover } from "@/components/annotations/annotation-popover";
import { AnnotationsPanel } from "@/components/annotations/annotations-panel";
import { ChartAnnotationOverlay } from "@/components/dashboard/panels/chart-annotation-overlay";
import { LabelProposals } from "@/components/dashboard/label-proposals";
import { AlertBands } from "@/components/ui/charts/alert-bands";
import { useAlerts } from "@/hooks/use-alerts";
import { useRouter } from "next/navigation";
import { useChartSeries } from "@/hooks/use-chart-series";
import {
  useComparisonSeries,
  resolutionForSpan,
} from "@/hooks/use-comparison-series";
import { useSharedQueryContext } from "@/components/dashboard/shared-query-context";
import { useChartDomain } from "@/hooks/use-chart-domain";
import { useChartPanZoom } from "@/hooks/use-chart-pan-zoom";
import { useReferenceLines } from "@/hooks/use-reference-lines";
import { useAnimatedDomain } from "@/hooks/use-animated-domain";
import { getDomain } from "@/components/ui/charts/base-chart";

interface ChartPanelProps {
  panel: Panel;
  timeRange: TimeRange;
  chartType?: "line" | "area" | "bar" | "scatter";
}

const DEFAULT_COLORS = [
  "#3b82f6",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#f97316",
  "#6366f1",
  "#14b8a6",
];

// Base margins; the left edge widens at render time to fit the Y tick labels
// (see chartMargin memo) so long values are never clipped.
const BASE_CHART_MARGIN = { top: 20, right: 20, bottom: 50, left: 60 };
const Y_TICK_FONT = "12px -apple-system, BlinkMacSystemFont, sans-serif";

// Module-level stable empty object so `panel.config.metricColors || {}` doesn't
// allocate a fresh `{}` each render — that would invalidate useChartSeries's
// baseSeries memo every render (metricColors is in its deps).
const EMPTY_METRIC_COLORS: Record<string, string> = {};

/** Binary search for closest point by x — O(log n) */
function binarySearchClosestX(
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

export function ChartPanel({
  panel,
  timeRange,
  chartType = "line",
}: ChartPanelProps) {
  const { settings: userSettings } = useUserSettings();
  const tz = userSettings.timezone;
  const tz12 = userSettings.use12HourFormat;

  // Feature flags
  const showCrosshair = panel.config.showCrosshair !== false;
  const annotationsEnabled = panel.config.showAnnotations !== false;
  const showFutureDashing = panel.config.showFutureDashing !== false;
  const showAlerts =
    panel.config.showAlerts !== false && !panel.config.xAxisField;
  const router = useRouter();

  // Data
  const {
    data,
    isLoading,
    error,
    restricted,
    sourceType,
    metrics: displayedMetrics,
    limits,
    primarySourceId,
    connectionMeta,
  } = usePanelData({
    panel,
    timeRange,
    chartType: chartType as ChartType,
    fetchLimits: !!(
      panel.config.sourceId ||
      panel.sources?.length ||
      panel.metrics?.some((m: string) => m.includes(":"))
    ),
  });

  const sourceId =
    panel.config.sourceId || panel.sources?.[0] || primarySourceId;
  const colors = panel.config.colors || DEFAULT_COLORS;
  const explicitMetricColors = panel.config.metricColors || EMPTY_METRIC_COLORS;

  // Resolve each series' color: explicit override → per-table default → palette.
  // Table defaults are injected here for the live series (incl. breakdown values)
  // using the build-time series→table hints; the palette fallback stays in
  // useChartSeries for anything still unset.
  const tableColors = panel.config.tableColors;
  const metricColors = useMemo(() => {
    const conn =
      panel.dataSource?.type === "connection"
        ? (panel.dataSource as ConnectionDataSource)
        : null;
    if (!conn || !tableColors || Object.keys(tableColors).length === 0) {
      return explicitMetricColors;
    }
    const tableOf = (key: string): string | undefined =>
      conn.seriesColumn ? conn.breakdownTable : conn.seriesTableMap?.[key];
    const out: Record<string, string> = { ...explicitMetricColors };
    for (const key of displayedMetrics) {
      if (out[key]) continue; // explicit override wins
      const t = tableOf(key);
      if (t && tableColors[t]) out[key] = tableColors[t];
    }
    return out;
  }, [explicitMetricColors, tableColors, displayedMetrics, panel.dataSource]);

  // Anonymous shared views can't reach the authed alerts/annotations APIs —
  // gate those fetches so shared pages don't spray 401s and error toasts.
  const isSharedView = !!useSharedQueryContext();

  // Annotation mode
  const ann = useAnnotationMode({
    sourceId,
    enabled: !!sourceId && !isSharedView,
  });
  const [showTable, setShowTable] = useState(panel.config.showTable ?? false);

  // Runtime marker visibility — session-only glance toggle; the persisted
  // preference stays panel.config.showAnnotations. Annotation mode overrides
  // the toggle while active so you never annotate blind.
  const [annotationsHidden, setAnnotationsHidden] = useState(false);
  const annotationsShown = !annotationsHidden || ann.mode === "on";

  // Resize tracking — callback ref (not useRef + useEffect) because the
  // chart container only mounts AFTER the loading/error/empty early returns
  // resolve. A classic useEffect([]) fires once while those branches are
  // still rendering (ref === null) and never re-runs, so chartSize stays
  // {0,0} forever — which silently hides annotations and the shift-drag
  // brush overlay since they gate on chartSize.width > 0.
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });

  const setChartContainer = useCallback((node: HTMLDivElement | null) => {
    chartContainerRef.current = node;
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setChartSize({ width: rect.width, height: rect.height });
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry)
        setChartSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  // Cross-panel hover
  const {
    hoveredTimestamp,
    setHoveredTimestamp,
    setHoveredValues,
    clearHoveredValues,
    viewWindow,
    setViewWindow,
    isLive,
    syncTooltips,
    onTimeRangeChange: contextTimeRangeChange,
    compareRuns,
  } = useDashboardInteraction();

  // Freeze the data snapshot while the user is actively panning or zooming.
  // Streaming points that arrive mid-gesture would re-run the series/domain
  // memos and visually jitter the chart under the cursor — the user wants
  // to see the same data they grabbed, not have it shift under them. We
  // release on gesture end; the next render picks up all accumulated points.
  // `viewWindow` is set by both pan and wheel-zoom, so it (not the pan
  // callback) is the freeze trigger. Latest data is mirrored into a ref so we
  // can snapshot it at the freeze transition without re-capturing every frame.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  });
  const [frozenData, setFrozenData] = useState<typeof data | null>(null);
  const isFrozen = !!viewWindow;
  useEffect(() => {
    // Capture once when the gesture starts, release when it ends. Deferred to
    // a microtask so the snapshot update isn't a synchronous effect cascade.
    if (isFrozen) {
      queueMicrotask(() => setFrozenData(dataRef.current));
    } else {
      queueMicrotask(() => setFrozenData(null));
    }
  }, [isFrozen]);
  const chartData = isFrozen && frozenData ? frozenData : data;

  // Series, domain, reference lines (extracted hooks)
  // Count series must SUM when bars collapse into wider buckets; averaging
  // "users per day" understates totals. Gauge-style measures keep avg.
  const isCountSeries =
    panel.dataSource?.type === "connection" &&
    (panel.dataSource.builder?.aggregate.fn === "count" ||
      panel.dataSource.valueColumn === "count");
  const { timeSeries, activeSeries } = useChartSeries({
    data: chartData,
    displayedMetrics,
    sourceId,
    xAxisField: panel.config.xAxisField,
    colors,
    metricColors,
    chartType,
    showFutureDashing,
    chartWidth: chartSize.width,
    tz,
    tz12,
    barAggregate: isCountSeries ? "sum" : "avg",
  });

  // Run-compare ghost: the baseline run's series, time-shifted onto this
  // window. Fetched independently of TelemetryProvider (which is locked to
  // the dashboard range). Time-shifting is meaningless for metric-vs-metric
  // panels (xAxisField) and unrepresentable for bar charts (string x).
  const compareEligible =
    compareRuns.length > 0 && !panel.config.xAxisField && chartType !== "bar";
  const { ghostSeries, baselineResolution } = useComparisonSeries({
    metrics: displayedMetrics,
    baselines: compareRuns,
    chartWidth: chartSize.width,
    enabled: compareEligible,
  });

  // Warn when the two windows were served at different aggregation
  // resolutions — a raw-vs-rollup overlay is not a fair comparison.
  const resolutionMismatch = useMemo(() => {
    if (!compareEligible || !baselineResolution) return false;
    const { start, end } = getTimeRangeBounds(timeRange);
    const span = end.getTime() - start.getTime();
    return span > 0 && resolutionForSpan(span) !== baselineResolution;
  }, [compareEligible, baselineResolution, timeRange]);

  // Ghosts render UNDER the primary series (draw order = array order).
  const seriesForChart = useMemo(
    () =>
      ghostSeries.length > 0 ? [...ghostSeries, ...activeSeries] : activeSeries,
    [ghostSeries, activeSeries],
  );

  // Newest data timestamp across visible series — the live viewport anchors to
  // this so it stays still until new data arrives, then eases to catch up.
  // Ghost series are deliberately EXCLUDED: a longer, completed baseline
  // shifted onto a live run would drag the viewport's right edge forward.
  const latestDataTime = useMemo(() => {
    let max = 0;
    for (const s of timeSeries) {
      const last = s.data[s.data.length - 1];
      if (last && last.x > max) max = last.x;
    }
    return max || undefined;
  }, [timeSeries]);

  const xDomain = useChartDomain({
    timeRange,
    xAxisField: panel.config.xAxisField,
    viewWindow,
    annotationMode: ann.mode,
    latestDataTime,
  });

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
    clearHoveredValues(panel.id);
  }, [setHoveredTimestamp, clearHoveredValues, panel.id]);

  // Target Y-domain from the visible series. This is what the chart *wants*
  // to show; `useAnimatedDomain` below eases current → target so the axis
  // doesn't snap when a new extreme arrives.
  const targetYDomain = useMemo(() => {
    // Ghosts participate so both runs share one comparable scale.
    const allPoints = [...timeSeries, ...ghostSeries].flatMap((s) => s.data);
    const auto =
      allPoints.length > 0 ? getDomain(allPoints, (p) => p.y, 0.1) : undefined;
    const yMin = panel.config.yMin;
    const yMax = panel.config.yMax;
    if (yMin === undefined && yMax === undefined) return auto;
    const min = yMin ?? auto?.[0] ?? 0;
    const max = yMax ?? auto?.[1] ?? 100;
    // Nonsense bounds (min ≥ max) fall back to auto-scaling
    if (min >= max) return auto;
    return [min, max] as [number, number];
  }, [timeSeries, ghostSeries, panel.config.yMin, panel.config.yMax]);

  // Only animate in live mode. For absolute time ranges, pan/zoom, or
  // annotation mode, match the target exactly so users get a deterministic
  // view of the data they've framed.
  const animateYDomain =
    isLive && !viewWindow && ann.mode !== "on" && !panel.config.xAxisField;
  const smoothYDomain = useAnimatedDomain(targetYDomain, animateYDomain);

  const yAxisConfig = useMemo(
    () => ({
      formatter: (v: number) =>
        v === 0
          ? "0"
          : (formatPanelValue(
              v,
              panel.config.decimals,
              panel.config.notation,
            ) ?? formatValue(v)),
      label: panel.config.yAxisLabel,
      domain: smoothYDomain,
    }),
    [
      panel.config.decimals,
      panel.config.notation,
      panel.config.yAxisLabel,
      smoothYDomain,
    ],
  );

  // Left margin sized to the widest Y tick label so values are never clipped.
  // Measured against the stable target domain (not the animated one) and
  // rounded up to an 8px step so live updates don't jitter the plot edge.
  const chartMarginLeft = useMemo(() => {
    const ticks = getTicks(targetYDomain ?? [0, 100], 6);
    const labelWidth = measureTextWidth(
      ticks.map(yAxisConfig.formatter),
      Y_TICK_FONT,
    );
    let left =
      Math.ceil(labelWidth) + 10 + (panel.config.yAxisLabel ? 24 : 8);
    left = Math.ceil(left / 8) * 8;
    const cap =
      chartSize.width > 0 ? Math.floor(chartSize.width * 0.4) : Infinity;
    return Math.min(Math.max(BASE_CHART_MARGIN.left, left), cap);
  }, [targetYDomain, yAxisConfig, panel.config.yAxisLabel, chartSize.width]);
  const chartMargin = useMemo(
    () => ({ ...BASE_CHART_MARGIN, left: chartMarginLeft }),
    [chartMarginLeft],
  );

  const { isPanning, brushRect } = useChartPanZoom({
    containerRef: chartContainerRef,
    timeRange,
    enabled: ann.mode !== "on",
    setViewWindow,
    onTimeRangeChange: handlePanZoomChange,
    onPanStart: handlePanStart,
    margin: chartMargin,
  });

  const showLimits =
    panel.config.showLimits ??
    (limits ? Object.keys(limits).length > 0 : false);
  const handleLimitClick = useCallback(
    (metric: string) => {
      const limitSourceId = limits?.[metric]?.sourceId;
      router.push(
        limitSourceId
          ? `/alerts/monitors?monitor=${encodeURIComponent(`${limitSourceId}::${metric}`)}`
          : "/alerts/monitors",
      );
    },
    [limits, router],
  );
  const referenceLines = useReferenceLines({
    showLimits,
    limits,
    displayedMetrics,
    data,
    onLimitClick: handleLimitClick,
  });

  // Alert bands — fetch alerts for every source this panel plots (open +
  // resolved) and then filter to the metrics it actually shows. Dedup because
  // `sources` and `config.sourceId` often overlap.
  const alertSourceIds = useMemo(() => {
    const ids = new Set<string>();
    if (panel.config.sourceId) ids.add(panel.config.sourceId);
    for (const id of panel.sources ?? []) ids.add(id);
    if (sourceId) ids.add(sourceId);
    return Array.from(ids);
  }, [panel.config.sourceId, panel.sources, sourceId]);
  const { alerts: alertsForSource } = useAlerts({
    sourceId: alertSourceIds,
    enabled: showAlerts && alertSourceIds.length > 0 && !isSharedView,
    // Poll for new alerts every 5 s. Without this the hook defaults to
    // refreshInterval: 0 (fetch-once-on-mount), so alerts that fire after
    // the dashboard loaded never appear on the overlay until full reload.
    refreshInterval: 5000,
  });
  const alertMetricSet = useMemo(() => {
    const set = new Set<string>();
    for (const m of displayedMetrics ?? []) {
      const bare = m.includes(":") ? m.split(":").slice(1).join(":") : m;
      if (bare) set.add(bare);
    }
    return set;
  }, [displayedMetrics]);
  // Current time for open-alert band extents, refreshed periodically so the
  // overlay stays correct even when the chart isn't actively streaming.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const visibleAlerts = useMemo(() => {
    if (!showAlerts || !xDomain || alertsForSource.length === 0) return [];
    const [domStart, domEnd] = xDomain;
    // Open alerts extend at most to the last observed data point: a silent
    // source can never "clear" a condition, so an unclosed alert would
    // otherwise stay visible in every window from trigger to now, forever.
    const openEnd = latestDataTime != null ? Math.min(now, latestDataTime) : now;
    return alertsForSource.filter((a) => {
      if (alertMetricSet.size > 0 && !alertMetricSet.has(a.metric))
        return false;
      const start = new Date(a.triggered_at).getTime();
      // Use system-set closed_at (alert-service cleared the condition),
      // not user-set resolved_at. The overlay reflects when the metric was
      // actually breaching, not when the user acknowledged.
      const end = a.closed_at ? new Date(a.closed_at).getTime() : openEnd;
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      if (!a.closed_at && end <= start) return false;
      return end >= domStart && start <= domEnd;
    });
  }, [showAlerts, xDomain, alertsForSource, alertMetricSet, now, latestDataTime]);

  const handleAlertClick = useCallback(
    (alertId: string) => {
      router.push(`/alerts?selected=${alertId}`);
    },
    [router],
  );

  // Local-model labeling — telemetry time-series panels only (connection and
  // metric-vs-metric panels don't map onto slug:metric ClickHouse queries).
  // Metrics are qualified exactly as batch-query receives them; the window is
  // the currently rendered x-domain (falls back to the panel's time range).
  const labelMetrics = useMemo(() => {
    if (sourceType === "connection" || panel.config.xAxisField) return [];
    return (displayedMetrics ?? [])
      .map((m) => (m.includes(":") ? m : sourceId ? `${sourceId}:${m}` : m))
      .filter((m) => m.includes(":"))
      .slice(0, 10);
  }, [sourceType, panel.config.xAxisField, displayedMetrics, sourceId]);
  const labelWindow = useMemo(() => {
    if (xDomain)
      return { start: Math.floor(xDomain[0]), end: Math.ceil(xDomain[1]) };
    const { start, end } = getTimeRangeBounds(timeRange);
    return { start: start.getTime(), end: end.getTime() };
  }, [xDomain, timeRange]);

  // Axis config
  const xAxisConfig = useMemo(() => {
    const isTimeAxis = !panel.config.xAxisField;
    const rangeMs = xDomain ? xDomain[1] - xDomain[0] : 0;
    const APPROX_LABEL_PX = 90;
    const innerW = chartSize.width
      ? chartSize.width - chartMargin.left - chartMargin.right
      : 0;
    const maxLabels =
      innerW > 0 ? Math.max(1, Math.floor(innerW / APPROX_LABEL_PX)) : 1;
    const msPerLabel = maxLabels > 0 ? rangeMs / maxLabels : rangeMs;
    const showSeconds =
      isTimeAxis && (rangeMs <= 15 * 60 * 1000 || msPerLabel <= 60 * 1000);
    const tzAbbr = isTimeAxis ? getTimezoneAbbr(tz) : "";
    const baseLabel = panel.config.xAxisField
      ? panel.config.xAxisLabel ||
        (panel.config.xAxisField.includes(":")
          ? panel.config.xAxisField.split(":")[1]
          : panel.config.xAxisField)
      : panel.config.xAxisLabel;
    return {
      domain: xDomain,
      formatter: panel.config.xAxisField
        ? (v: number) =>
            formatPanelValue(v, panel.config.decimals, panel.config.notation) ??
            v.toLocaleString()
        : (v: number) => formatTimeInZone(new Date(v), tz, tz12, showSeconds),
      label: isTimeAxis
        ? baseLabel
          ? `${baseLabel} (${tzAbbr})`
          : `Time (${tzAbbr})`
        : baseLabel,
    };
  }, [
    xDomain,
    panel.config.xAxisField,
    panel.config.decimals,
    panel.config.notation,
    panel.config.xAxisLabel,
    tz,
    tz12,
    chartSize.width,
    chartMargin,
  ]);

  // Crosshair — suppressed during active pan to avoid fighting the shifting domain
  const handleChartMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!showCrosshair || isPanning.current) return;
      const rect = chartContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const iw = rect.width - chartMargin.left - chartMargin.right;
      if (iw <= 0 || !xDomain) return;
      const x = Math.max(
        chartMargin.left,
        Math.min(e.clientX - rect.left, rect.width - chartMargin.right),
      );
      const absTime =
        xDomain[0] + ((x - chartMargin.left) / iw) * (xDomain[1] - xDomain[0]);
      setHoveredTimestamp(new Date(absTime).toISOString());
      const xRange = xDomain[1] - xDomain[0];
      const values: HoveredValue[] = [];
      for (const s of timeSeries) {
        const closest = binarySearchClosestX(s.data, absTime, xRange * 0.05);
        if (closest)
          values.push({ name: s.name, value: closest.y, color: s.color });
      }
      for (const s of ghostSeries) {
        const closest = binarySearchClosestX(s.data, absTime, xRange * 0.05);
        if (closest)
          values.push({ name: s.name, value: closest.y, color: s.color });
      }
      if (values.length > 0) setHoveredValues(panel.id, values);
    },
    [
      showCrosshair,
      isPanning,
      xDomain,
      timeSeries,
      ghostSeries,
      setHoveredTimestamp,
      setHoveredValues,
      panel.id,
      chartMargin,
    ],
  );

  const handleChartMouseLeave = useCallback(() => {
    setHoveredTimestamp(null);
    clearHoveredValues(panel.id);
  }, [setHoveredTimestamp, clearHoveredValues, panel.id]);

  // Annotation drag-to-select / click
  const DRAG_THRESHOLD = 8;
  const dragStartRef = useRef<{
    clientX: number;
    chartX: number;
    timestamp: number;
  } | null>(null);

  const handleAnnotationMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (ann.mode !== "on" || ann.popover || !sourceId || !xDomain) return;
      const rect = chartContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const iw = rect.width - chartMargin.left - chartMargin.right;
      const chartX = e.clientX - rect.left - chartMargin.left;
      if (chartX < 0 || chartX > iw) return;
      const absTime = xDomain[0] + (chartX / iw) * (xDomain[1] - xDomain[0]);
      dragStartRef.current = {
        clientX: e.clientX,
        chartX: chartX + chartMargin.left,
        timestamp: absTime,
      };
      ann.setPending({
        timestampStart: new Date(absTime).toISOString(),
        pxStart: chartX + chartMargin.left,
      });
    },
    [ann, sourceId, xDomain, chartMargin],
  );

  const handleAnnotationMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragStartRef.current || ann.mode !== "on" || !xDomain) return;
      const rect = chartContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const iw = rect.width - chartMargin.left - chartMargin.right;
      const chartX = Math.max(
        0,
        Math.min(iw, e.clientX - rect.left - chartMargin.left),
      );
      const absTime = xDomain[0] + (chartX / iw) * (xDomain[1] - xDomain[0]);
      const dx = Math.abs(e.clientX - dragStartRef.current.clientX);

      if (dx > DRAG_THRESHOLD) {
        ann.setIsDragging(true);
        ann.setPending({
          timestampStart: new Date(
            dragStartRef.current.timestamp,
          ).toISOString(),
          timestampEnd: new Date(absTime).toISOString(),
          pxStart: dragStartRef.current.chartX,
          pxEnd: chartX + chartMargin.left,
        });
      }
    },
    [ann, xDomain, chartMargin],
  );

  const handleAnnotationMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!dragStartRef.current || ann.mode !== "on") return;
      const dx = Math.abs(e.clientX - dragStartRef.current.clientX);

      if (dx > DRAG_THRESHOLD && ann.pending?.timestampEnd) {
        // Range annotation — sort timestamps chronologically
        const t1 = new Date(ann.pending.timestampStart).getTime();
        const t2 = new Date(ann.pending.timestampEnd).getTime();
        const [start, end] =
          t1 < t2
            ? [ann.pending.timestampStart, ann.pending.timestampEnd]
            : [ann.pending.timestampEnd, ann.pending.timestampStart];
        ann.openPopover(e.clientX, e.clientY, start, end);
      } else {
        // Point annotation
        ann.openPopover(
          e.clientX,
          e.clientY,
          new Date(dragStartRef.current.timestamp).toISOString(),
        );
      }

      dragStartRef.current = null;
      ann.setIsDragging(false);
    },
    [ann],
  );

  // ── Early returns ──

  if (isLoading && timeSeries.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Access-scope denial is an expected state for scoped viewers, not an error.
  if (restricted) {
    return <PanelRestrictedState />;
  }

  if (error) {
    const failedSql = (error as { sql?: string }).sql;
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1 px-4 text-center text-sm text-destructive overflow-y-auto">
        <span>Failed to load data</span>
        {error.message && (
          <span className="line-clamp-3 break-all font-mono text-xs text-muted-foreground">
            {error.message}
          </span>
        )}
        {failedSql && (
          <details className="max-w-full text-left">
            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
              Show query
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/30 p-2 text-[10px] font-mono whitespace-pre-wrap break-all text-muted-foreground">
              {failedSql}
            </pre>
          </details>
        )}
      </div>
    );
  }

  if (timeSeries.length === 0 || timeSeries.every((s) => s.data.length === 0)) {
    const isConn = sourceType === "connection";
    // The 0-row probe finds the table's real time span. If it exists, the data
    // is simply outside the selected window — say so and offer to jump to it.
    const actualRange = connectionMeta?.actualDataRange;
    // Live/realtime sources: an empty window is the normal state between
    // readings for batch reporters — render calm "waiting", not an error.
    let reason: EmptyStateReason = isConn ? "no_data" : "waiting_for_data";
    if (isConn && connectionMeta) {
      if (connectionMeta.rowCount === 0) {
        reason = actualRange ? "no_data_in_range" : "no_data";
      } else {
        reason = "transform_failed";
      }
    }
    const requestedTimeRange = timeRange
      ? (() => {
          const { start, end } = getTimeRangeBounds(timeRange);
          return { start: start.toISOString(), end: end.toISOString() };
        })()
      : undefined;
    const handleJumpToData = actualRange
      ? () => {
          // Pad outward by 1s so the boundary rows fall inside the window.
          const pad = (iso: string, ms: number) =>
            new Date(new Date(iso).getTime() + ms).toISOString();
          contextTimeRangeChange({
            type: "absolute",
            value: `${pad(actualRange.earliest, -1000)}/${pad(actualRange.latest, 1000)}`,
          });
        }
      : undefined;
    return (
      <PanelEmptyState
        reason={reason}
        debugInfo={{
          sourceType,
          sourceName: isConn
            ? (panel.dataSource as { sourceId?: string } | undefined)?.sourceId
            : sourceId || undefined,
          rowCount: isConn ? connectionMeta?.rowCount : undefined,
          columns: isConn
            ? connectionMeta?.columns.map((c) => c.name)
            : undefined,
          actualDataRange: actualRange,
          requestedTimeRange,
        }}
        onExpandTimeRange={handleJumpToData}
      />
    );
  }

  const showGrid = panel.config.showGrid !== false;
  const showXAxis = panel.config.showXAxis !== false;
  const showYAxis = panel.config.showYAxis !== false;
  const innerWidth = chartSize.width - chartMargin.left - chartMargin.right;
  const innerHeight = chartSize.height - chartMargin.top - chartMargin.bottom;

  return (
    <>
      <div className="h-full flex flex-col">
        <div
          ref={setChartContainer}
          className={cn(
            "relative select-none flex-1 min-h-0",
            ann.mode === "on"
              ? "cursor-cell"
              : showCrosshair
                ? "cursor-crosshair"
                : "",
          )}
          style={{ minHeight: 150 }}
          onMouseMove={(e) => {
            handleChartMouseMove(e);
            if (ann.mode === "on") handleAnnotationMouseMove(e);
          }}
          onMouseLeave={() => {
            handleChartMouseLeave();
            if (dragStartRef.current) {
              dragStartRef.current = null;
              ann.setIsDragging(false);
              ann.setPending(null);
            }
          }}
          onMouseDown={(e) => {
            if (ann.mode === "on") handleAnnotationMouseDown(e);
          }}
          onMouseUp={(e) => {
            if (ann.mode === "on") handleAnnotationMouseUp(e);
          }}
        >
          <UnifiedChart
            type={chartType}
            series={seriesForChart}
            width="100%"
            height="100%"
            margin={chartMargin}
            showGrid={showGrid}
            showXAxis={showXAxis}
            showYAxis={showYAxis}
            showTooltip={ann.mode !== "on"}
            smooth={panel.config.smoothLines !== false}
            showDataPoints={panel.config.showDataPoints === true}
            showLegend={panel.config.showLegend ?? activeSeries.length > 1}
            xAxis={chartType === "bar" ? undefined : xAxisConfig}
            yAxis={yAxisConfig}
            referenceLines={
              referenceLines.length > 0 ? referenceLines : undefined
            }
            stacked={panel.config.stacked}
            orientation={panel.config.orientation || "vertical"}
          />

          {brushRect &&
            xDomain &&
            innerWidth > 0 &&
            (() => {
              const xRange = xDomain[1] - xDomain[0];
              const tStart =
                xDomain[0] +
                ((brushRect.left - chartMargin.left) / innerWidth) * xRange;
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
                      top: chartMargin.top,
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
                          top: chartMargin.top + 4,
                          transform: "translateX(-50%)",
                        }}
                      >
                        {fmtDur(durMs)}
                      </div>
                      <div
                        className="absolute pointer-events-none z-20 text-[10px] font-mono px-1 py-0.5 rounded bg-background/90 border border-border text-foreground whitespace-nowrap"
                        style={{
                          left: brushRect.left,
                          top: chartMargin.top + innerHeight + 2,
                          transform: "translateX(-50%)",
                        }}
                      >
                        {formatTimeInZone(new Date(tStart), tz, tz12)}
                      </div>
                      <div
                        className="absolute pointer-events-none z-20 text-[10px] font-mono px-1 py-0.5 rounded bg-background/90 border border-border text-foreground whitespace-nowrap"
                        style={{
                          left: brushRect.left + brushRect.width,
                          top: chartMargin.top + innerHeight + 2,
                          transform: "translateX(-50%)",
                        }}
                      >
                        {formatTimeInZone(new Date(tEnd), tz, tz12)}
                      </div>
                    </>
                  )}
                </>
              );
            })()}

          {/* Synced crosshair from other panels */}
          {syncTooltips &&
            hoveredTimestamp &&
            xDomain &&
            innerWidth > 0 &&
            (() => {
              const hoverMs = new Date(hoveredTimestamp).getTime();
              const xRange = xDomain[1] - xDomain[0];
              if (xRange <= 0) return null;
              const px =
                chartMargin.left +
                ((hoverMs - xDomain[0]) / xRange) * innerWidth;
              if (
                px < chartMargin.left ||
                px > chartSize.width - chartMargin.right
              )
                return null;
              return (
                <div
                  className="absolute pointer-events-none z-10 bg-muted-foreground/40"
                  style={{
                    left: px,
                    top: chartMargin.top,
                    width: 1,
                    height: innerHeight,
                  }}
                />
              );
            })()}

          {/* Alert time bands */}
          {showAlerts &&
            xDomain &&
            innerWidth > 0 &&
            innerHeight > 0 &&
            visibleAlerts.length > 0 && (
              <AlertBands
                alerts={visibleAlerts}
                xDomain={xDomain}
                margin={chartMargin}
                innerWidth={innerWidth}
                innerHeight={innerHeight}
                tz={tz}
                tz12={tz12}
                onAlertClick={handleAlertClick}
                dataEndMs={latestDataTime}
              />
            )}

          {/* Annotation markers */}
          {annotationsEnabled &&
            annotationsShown &&
            xDomain &&
            chartSize.width > 0 && (
              <ChartAnnotationOverlay
                annotations={ann.annotations}
                xDomain={xDomain}
                chartWidth={chartSize.width}
                innerWidth={innerWidth}
                innerHeight={innerHeight}
                margin={chartMargin}
                tz={tz}
                tz12={tz12}
                onAnnotationClick={(annotation, x, y) =>
                  ann.openEditPopover(annotation, x, y)
                }
                pending={ann.pending}
              />
            )}

          <AnnotationModeIndicator
            mode={ann.mode}
            onClose={() => ann.setMode("off")}
          />

          {/* Compare mode: name every run's trace where the eye is — the
              primary keeps metric colors; each baseline owns one run color. */}
          {ghostSeries.length > 0 && compareRuns.length > 0 && (
            <div className="absolute top-2 left-2 z-20 pointer-events-none flex items-center gap-2.5 flex-wrap max-w-[70%] rounded-full border border-border/50 bg-popover/90 px-2.5 py-1 text-[10px] shadow-sm">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <span className="w-3 h-0.5 rounded-full bg-foreground" />
                {compareRuns[0]?.primaryLabel ?? "Current"}
              </span>
              {compareRuns.map((r) => (
                <span
                  key={r.id}
                  className="flex items-center gap-1.5 text-muted-foreground"
                >
                  <span
                    className="w-3 h-0.5 rounded-full"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className="truncate max-w-[140px]">{r.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-2 py-1 border-t border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AnnotationToolbar
              mode={ann.mode}
              setMode={ann.setMode}
              annotationCount={ann.annotations.length}
              onShowPanel={() => ann.setShowPanel(true)}
              annotationsVisible={annotationsShown}
              onToggleVisibility={() => setAnnotationsHidden((v) => !v)}
              canToggleVisibility={annotationsEnabled}
            />
            {!isSharedView && sourceId && labelMetrics.length > 0 && (
              <LabelProposals
                metrics={labelMetrics}
                timeWindow={labelWindow}
                sourceId={sourceId}
              />
            )}
            {connectionMeta?.truncated && (
              <span
                title={`This panel hit the ${connectionMeta.rowCount.toLocaleString()}-row limit, so only part of the selected range is shown. Aggregate in your query (e.g. GROUP BY a time bucket) or narrow the time range to see all the data.`}
                className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500 truncate"
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  Showing first {connectionMeta.rowCount.toLocaleString()} rows
                </span>
              </span>
            )}
            {resolutionMismatch && (
              <span
                title={`The baseline run and the current window span different aggregation tiers, so their curves are averaged differently and small features may not line up. Match the window length to the run's duration (open the run from /runs) for a raw-to-raw comparison.`}
                className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500 truncate"
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  Baseline at {baselineResolution} resolution
                </span>
              </span>
            )}
          </div>
          <button
            onClick={() => setShowTable(!showTable)}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors",
              showTable
                ? "text-foreground bg-muted"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <Table2 className="h-3.5 w-3.5" />
            <span>Data</span>
            {showTable ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        </div>

        {showTable && (
          <div className="flex-1 overflow-hidden" style={{ minHeight: 150 }}>
            <DataTable
              data={data || {}}
              metrics={displayedMetrics}
              decimals={panel.config.decimals}
              notation={panel.config.notation}
              colors={colors}
              hoveredTimestamp={hoveredTimestamp}
              onHover={setHoveredTimestamp}
            />
          </div>
        )}
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
