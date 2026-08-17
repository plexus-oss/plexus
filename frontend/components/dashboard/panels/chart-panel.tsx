"use client";

import {
  Fragment,
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
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
import {
  Table2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  HelpCircle,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatValue,
  getNiceTimeInterval,
  getTicks,
  measureTextWidth,
} from "@/components/ui/charts/base-chart";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatPanelValue } from "@/lib/dashboard/format-value";
import { formatDeltaMs } from "@/lib/dashboard/format-delta";
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
import { ExplainButton } from "@/components/dashboard/label-proposals";
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
import { sliceSeriesToWindow } from "@/lib/data-utils";
import type { TelemetryData } from "@/components/dashboard/telemetry-provider";
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

/** True when a telemetry snapshot holds at least one point in any series. */
function telemetryHasPoints(data: TelemetryData | null | undefined): boolean {
  if (!data) return false;
  return Object.values(data).some(
    (pts) => Array.isArray(pts) && pts.length > 0,
  );
}

/**
 * True when any series in a telemetry snapshot could intersect [start, end].
 * Cheap: only each series' first/last timestamps are parsed.
 */
function telemetryOverlapsWindow(
  data: TelemetryData,
  window: [number, number],
): boolean {
  for (const points of Object.values(data)) {
    if (!Array.isArray(points) || points.length === 0) continue;
    const first = new Date(points[0].timestamp).getTime();
    const last = new Date(points[points.length - 1].timestamp).getTime();
    if (first <= window[1] && last >= window[0]) return true;
  }
  return false;
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
    pinnedTimestamp,
    setPinnedTimestamp,
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
  const dataHasPoints = useMemo(() => telemetryHasPoints(data), [data]);
  useEffect(() => {
    // Capture once when the gesture starts, release when it ends. Deferred to
    // a microtask so the snapshot update isn't a synchronous effect cascade.
    // The release waits for the post-commit refetch to actually deliver
    // points: committing a zoom empties the SWR-keyed data until the new
    // window's fetch lands, and at deep spans that fetch can legitimately
    // return nothing (a 10ms window between samples). Holding the gesture
    // snapshot through that gap keeps the surrounding samples on screen
    // (windowed + edge-interpolated) instead of flashing the panel blank.
    if (isFrozen) {
      queueMicrotask(() => {
        // Never snapshot an EMPTY payload over a useful held one — panning
        // right after a deep commit (data still empty) must keep showing the
        // pre-zoom snapshot, not blank the chart.
        if (telemetryHasPoints(dataRef.current)) {
          setFrozenData(dataRef.current);
        }
      });
    } else if (dataHasPoints) {
      queueMicrotask(() => setFrozenData(null));
    }
  }, [isFrozen, dataHasPoints]);

  // The x-window (ms) the chart is displaying: the transient pan/zoom window
  // while a gesture is in flight, else the committed absolute range. Relative
  // (live) ranges pass null — their data extent ≈ the window and the right
  // edge is data-anchored. Drives series windowing + the snapshot fallback.
  const visibleWindow = useMemo<[number, number] | null>(() => {
    if (panel.config.xAxisField) return null;
    if (viewWindow) return [viewWindow.start, viewWindow.end];
    if (timeRange?.type === "absolute") {
      const { start, end } = getTimeRangeBounds(timeRange);
      return [start.getTime(), end.getTime()];
    }
    return null;
  }, [panel.config.xAxisField, viewWindow, timeRange]);

  // Post-commit fallback: while the refetched window has no points, keep
  // rendering the held snapshot — but only when it can actually intersect the
  // window. A jump to a genuinely disjoint empty range must still show the
  // real empty state, not stale data.
  const snapshotFallback =
    !isFrozen &&
    !dataHasPoints &&
    !!frozenData &&
    !!visibleWindow &&
    telemetryOverlapsWindow(frozenData, visibleWindow);
  const chartData =
    (isFrozen || snapshotFallback) && frozenData ? frozenData : data;

  // Series, domain, reference lines (extracted hooks)
  // Count series must SUM when bars collapse into wider buckets; averaging
  // "users per day" understates totals. Gauge-style measures keep avg.
  const isCountSeries =
    panel.dataSource?.type === "connection" &&
    (panel.dataSource.builder?.aggregate.fn === "count" ||
      panel.dataSource.valueColumn === "count");
  const { timeSeries, activeSeries, hasData, latestDataTime } = useChartSeries({
    data: chartData,
    displayedMetrics,
    sourceId,
    xAxisField: panel.config.xAxisField,
    colors,
    metricColors,
    chartType,
    showFutureDashing,
    chartWidth: chartSize.width,
    xWindow: visibleWindow,
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
  // Ghosts get the same visible-window slice as the primary series (see
  // useChartSeries) so a transient deep zoom never maps their offscreen
  // points to Float32-hostile pixel coordinates.
  const seriesForChart = useMemo(() => {
    if (ghostSeries.length === 0) return activeSeries;
    const ghosts = visibleWindow
      ? ghostSeries.map((g) => {
          const sliced = sliceSeriesToWindow(
            g.data,
            visibleWindow[0],
            visibleWindow[1],
          );
          return sliced === g.data ? g : { ...g, data: sliced };
        })
      : ghostSeries;
    return [...ghosts, ...activeSeries];
  }, [ghostSeries, activeSeries, visibleWindow]);

  // Observed stream rate over the visible window — how fast data is
  // actually arriving at the platform, so high-rate users can verify
  // nothing is being dropped ("I send 60 Hz, am I getting 60 Hz?").
  // Σ(count ?? 1) is tier-independent: downsampled buckets carry their
  // raw-event counts, so the chip reads true received Hz whether the
  // window is served raw or rolled up. Hidden below 1 Hz unless the
  // panel opts in — sparse metrics don't need a rate badge.
  const streamRateHz = useMemo(() => {
    if (panel.config.showStreamRate === false) return null;
    if (panel.config.xAxisField) return null;
    if (panel.dataSource?.type === "connection") return null;
    let best: number | null = null;
    const win = visibleWindow;
    for (const key of displayedMetrics) {
      const points = chartData?.[key];
      if (!points || points.length < 2) continue;
      let total = 0;
      let first = Infinity;
      let last = -Infinity;
      for (const p of points) {
        const t = new Date(p.timestamp).getTime();
        if (!Number.isFinite(t)) continue;
        if (win && (t < win[0] || t > win[1])) continue;
        total += (p as { count?: number }).count ?? 1;
        if (t < first) first = t;
        if (t > last) last = t;
      }
      const spanSec = (last - first) / 1000;
      if (total < 2 || spanSec <= 0) continue;
      const hz = (total - 1) / spanSec;
      if (best === null || hz > best) best = hz;
    }
    if (best === null) return null;
    if (best < 1) return null;
    return best;
  }, [
    chartData,
    displayedMetrics,
    visibleWindow,
    panel.config.showStreamRate,
    panel.config.xAxisField,
    panel.dataSource?.type,
  ]);

  // Newest data timestamp (pre-windowing, from useChartSeries) — the live
  // viewport anchors to this so it stays still until new data arrives, then
  // eases to catch up. Ghost series are deliberately EXCLUDED: a longer,
  // completed baseline shifted onto a live run would drag the right edge.

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
    let left = Math.ceil(labelWidth) + 10 + (panel.config.yAxisLabel ? 24 : 8);
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
    // Double-click / Escape restores the pre-zoom TimeRange directly, so a
    // relative range ("last 15m") goes back to being live after zooming.
    onTimeRangeReset: contextTimeRangeChange,
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
    const openEnd =
      latestDataTime != null ? Math.min(now, latestDataTime) : now;
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
  }, [
    showAlerts,
    xDomain,
    alertsForSource,
    alertMetricSet,
    now,
    latestDataTime,
  ]);

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

  // Sub-second label precision at deep zoom, derived from the same tick
  // ladder the axis renders (getNiceTimeInterval @ targetCount 6): steps ≥ 1s
  // need no fraction, 100–500ms steps read with one digit ("31.2"), and
  // 10–50ms steps need full ms so neighbors stay distinct ("31.240"/"31.250").
  const xMsDigits = useMemo<0 | 1 | 3>(() => {
    if (panel.config.xAxisField || !xDomain) return 0;
    const rangeMs = xDomain[1] - xDomain[0];
    if (rangeMs <= 0) return 0;
    const tickMs = getNiceTimeInterval(rangeMs, 6);
    if (tickMs >= 1000) return 0;
    return tickMs >= 100 ? 1 : 3;
  }, [panel.config.xAxisField, xDomain]);

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
      isTimeAxis &&
      (rangeMs <= 15 * 60 * 1000 || msPerLabel <= 60 * 1000 || xMsDigits > 0);
    const tzAbbr = isTimeAxis ? getTimezoneAbbr(tz) : "";
    const baseLabel = panel.config.xAxisField
      ? panel.config.xAxisLabel ||
        (panel.config.xAxisField.includes(":")
          ? panel.config.xAxisField.split(":")[1]
          : panel.config.xAxisField)
      : panel.config.xAxisLabel;
    return {
      domain: xDomain,
      // "time" opts the axis into wall-clock-anchored ticks (base-chart's
      // nice-interval ladder) instead of generic numeric 1/2/5 steps.
      type: isTimeAxis ? ("time" as const) : undefined,
      formatter: panel.config.xAxisField
        ? (v: number) =>
            formatPanelValue(v, panel.config.decimals, panel.config.notation) ??
            v.toLocaleString()
        : (v: number) =>
            formatTimeInZone(
              new Date(v),
              tz,
              tz12,
              showSeconds,
              xMsDigits || undefined,
            ),
      label: isTimeAxis
        ? baseLabel
          ? `${baseLabel} (${tzAbbr})`
          : `Time (${tzAbbr})`
        : baseLabel,
    };
  }, [
    xDomain,
    xMsDigits,
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

  // ── Pinned time tracker ──
  // A plain click (no drag, no modifiers) pins a shared tracker at the clicked
  // timestamp. Time-axis charts only: metric-vs-metric (xAxisField) panels have
  // no time x-axis, and bar charts plot discrete category slots, so a
  // pixel↔time mapping there would lie.
  const isTimeAxisChart = !panel.config.xAxisField && chartType !== "bar";
  const pinMs = useMemo(() => {
    if (!pinnedTimestamp) return null;
    const ms = new Date(pinnedTimestamp).getTime();
    return Number.isFinite(ms) ? ms : null;
  }, [pinnedTimestamp]);

  // Series values at the pinned time — same closest-point machinery as the
  // hover readout (binarySearchClosestX + HoveredValue), recomputed as live
  // data streams in.
  const pinnedValues = useMemo<HoveredValue[]>(() => {
    if (pinMs == null || !isTimeAxisChart || !xDomain) return [];
    const xRange = xDomain[1] - xDomain[0];
    if (xRange <= 0) return [];
    const values: HoveredValue[] = [];
    for (const s of timeSeries) {
      const closest = binarySearchClosestX(s.data, pinMs, xRange * 0.05);
      if (closest)
        values.push({ name: s.name, value: closest.y, color: s.color });
    }
    return values;
  }, [pinMs, isTimeAxisChart, xDomain, timeSeries]);

  // Click-vs-drag: mirror use-chart-pan-zoom's 4px threshold with our own
  // pointer-down tracking — the hook resets its isPanning flag on pointerup,
  // before the click event fires, so it can't be consulted here.
  const PIN_CLICK_TOLERANCE_PX = 4;
  const pinDownRef = useRef<{ x: number; y: number } | null>(null);
  // Pin placement is deferred ~200ms so the second click of a double-click
  // (pan-zoom's reset gesture) can cancel it — zoom reset must not also pin.
  const pinClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pinClickTimer.current) clearTimeout(pinClickTimer.current);
    },
    [],
  );

  const handleChartPointerDown = useCallback((e: React.PointerEvent) => {
    pinDownRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleChartClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isTimeAxisChart) return;
      // Annotation mode owns click/drag on the plot, exactly like it does for pan.
      if (ann.mode === "on") return;
      // Shift = brush, Ctrl/Cmd = pan modifier — never pin from those.
      if (e.shiftKey || e.ctrlKey || e.metaKey) return;
      // Interactive overlay children (alert bands, annotation markers,
      // reference-line chips) own their clicks — don't also pin.
      if (e.target instanceof Element && e.target.closest("button")) return;
      if (e.detail > 1) {
        // Second click of a double-click (zoom reset) — abort the pending pin.
        if (pinClickTimer.current) {
          clearTimeout(pinClickTimer.current);
          pinClickTimer.current = null;
        }
        return;
      }
      // A drag that ended here is a pan/brush, not a click.
      const down = pinDownRef.current;
      if (down && Math.abs(e.clientX - down.x) >= PIN_CLICK_TOLERANCE_PX)
        return;
      const rect = chartContainerRef.current?.getBoundingClientRect();
      if (!rect || !xDomain) return;
      const iw = rect.width - chartMargin.left - chartMargin.right;
      const xRange = xDomain[1] - xDomain[0];
      if (iw <= 0 || xRange <= 0) return;
      const clickX = e.clientX - rect.left;
      if (clickX < chartMargin.left || clickX > rect.width - chartMargin.right)
        return;
      // Clicking on (±4px of) the existing pin clears it; elsewhere moves it.
      const nearPin =
        pinMs != null &&
        Math.abs(
          clickX - (chartMargin.left + ((pinMs - xDomain[0]) / xRange) * iw),
        ) <= PIN_CLICK_TOLERANCE_PX;
      const next = nearPin
        ? null
        : new Date(
            xDomain[0] + ((clickX - chartMargin.left) / iw) * xRange,
          ).toISOString();
      if (pinClickTimer.current) clearTimeout(pinClickTimer.current);
      pinClickTimer.current = setTimeout(() => {
        setPinnedTimestamp(next);
        pinClickTimer.current = null;
      }, 200);
    },
    [isTimeAxisChart, ann.mode, xDomain, chartMargin, pinMs, setPinnedTimestamp],
  );

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

  // Key the loading/empty branches on hasData (pre-windowing), NOT on the
  // windowed timeSeries: a deep-zoom window that sits between samples empties
  // timeSeries, and unmounting the chart for it would kill the pan/zoom
  // listeners mid-interaction (no way to zoom back out).
  if (isLoading && !hasData) {
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

  if (!hasData) {
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
          onPointerDown={handleChartPointerDown}
          onClick={handleChartClick}
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

          {streamRateHz !== null && (
            <div
              className="absolute top-2 right-2 z-10 pointer-events-none text-[9px] font-mono px-1.5 py-0.5 rounded bg-background/70 text-muted-foreground border border-border/50"
              title="Observed ingest rate over the visible window"
            >
              avg{" "}
              {streamRateHz >= 10
                ? Math.round(streamRateHz)
                : streamRateHz.toFixed(1)}{" "}
              Hz
            </div>
          )}

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
                        {xAxisConfig.formatter(tStart)}
                      </div>
                      <div
                        className="absolute pointer-events-none z-20 text-[10px] font-mono px-1 py-0.5 rounded bg-background/90 border border-border text-foreground whitespace-nowrap"
                        style={{
                          left: brushRect.left + brushRect.width,
                          top: chartMargin.top + innerHeight + 2,
                          transform: "translateX(-50%)",
                        }}
                      >
                        {xAxisConfig.formatter(tEnd)}
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

          {/* Pinned time tracker — solid accent line (vs the hairline hover
              crosshair), per-series readout, and Δt to the hovered time.
              Renders on every time-axis chart regardless of syncTooltips. */}
          {pinMs != null &&
            isTimeAxisChart &&
            xDomain &&
            innerWidth > 0 &&
            (() => {
              const xRange = xDomain[1] - xDomain[0];
              if (xRange <= 0) return null;
              const px =
                chartMargin.left + ((pinMs - xDomain[0]) / xRange) * innerWidth;
              if (
                px < chartMargin.left ||
                px > chartSize.width - chartMargin.right
              )
                return null;
              const hoverMs = hoveredTimestamp
                ? new Date(hoveredTimestamp).getTime()
                : null;
              const deltaMs =
                hoverMs != null && Number.isFinite(hoverMs)
                  ? hoverMs - pinMs
                  : null;
              // Keep the readout inside the plot: flip sides past the midline.
              const flip = px > chartSize.width / 2;
              return (
                <>
                  <div
                    className="absolute pointer-events-none z-10 bg-primary/70"
                    style={{
                      left: px,
                      top: chartMargin.top,
                      width: 1,
                      height: innerHeight,
                    }}
                  />
                  {ann.mode !== "on" && (
                    <button
                      type="button"
                      aria-label="Clear pinned time"
                      title="Clear pinned time"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPinnedTimestamp(null);
                      }}
                      className="absolute z-30 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-primary/50 bg-background text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                      style={{ left: px - 7, top: chartMargin.top - 7 }}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                  <div
                    className="absolute pointer-events-none z-20 space-y-0.5 rounded border border-border bg-popover/95 px-1.5 py-1 shadow-sm"
                    style={{
                      top: chartMargin.top + 8,
                      ...(flip
                        ? { right: chartSize.width - px + 6 }
                        : { left: px + 6 }),
                    }}
                  >
                    <div className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                      <span>
                        {/* Same ms precision as the axis at deep zoom */}
                        {formatTimeInZone(
                          new Date(pinMs),
                          tz,
                          tz12,
                          true,
                          xMsDigits || undefined,
                        )}
                      </span>
                      {deltaMs != null && (
                        <span className="text-primary">
                          Δ {deltaMs < 0 ? "−" : ""}
                          {formatDeltaMs(deltaMs)}
                        </span>
                      )}
                    </div>
                    {pinnedValues.map((v, i) => (
                      <div
                        key={`${v.name}-${i}`}
                        className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[10px]"
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: v.color }}
                        />
                        <span className="max-w-[140px] truncate text-muted-foreground">
                          {v.name}
                        </span>
                        <span className="ml-auto text-foreground">
                          {yAxisConfig.formatter(v.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
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
            {!isSharedView && labelMetrics.length > 0 && (
              <ExplainButton metrics={labelMetrics} timeWindow={labelWindow} />
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
          <div className="flex items-center gap-1">
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
            <ChartGesturesHelp />
          </div>
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

/**
 * Passive gesture cheatsheet — a muted `?` in the bottom toolbar opening a
 * compact popover; user-invoked only, dismissed by click-away or Escape.
 *
 * Escape here cannot double as the chart's zoom-reset: Radix's dismissable
 * layer handles Escape on document capture and calls preventDefault() before
 * dismissing, and use-chart-pan-zoom's window listener already ignores
 * defaultPrevented Escapes.
 */
const GESTURE_ROWS: Array<[gesture: string, action: string]> = [
  ["Scroll", "Zoom"],
  ["Drag", "Pan"],
  ["Double-click", "Reset"],
  ["Click", "Pin a moment"],
  ["Shift+drag", "Zoom to selection"],
  ["Annotate", "Mark a moment or range"],
  ["Explain", "Ask the model"],
];

function ChartGesturesHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Chart gestures"
          title="Chart gestures"
          className="flex items-center px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={6} className="w-auto p-3">
        <p className="mb-2 text-xs font-medium text-foreground">
          Chart gestures
        </p>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
          {GESTURE_ROWS.map(([gesture, action]) => (
            <Fragment key={gesture}>
              <kbd className="justify-self-start rounded border border-border bg-muted px-1 py-px font-mono text-[9px] text-muted-foreground">
                {gesture}
              </kbd>
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                {action}
              </span>
            </Fragment>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
