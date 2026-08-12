/**
 * Quick-start dashboard layout — the deterministic, programmatic panel builder
 * shared by:
 *   - POST /api/dashboards/quick-start (creates the real dashboard on Apply)
 *   - the Terminal dashboard proposal (renders a faithful mini-preview)
 *
 * Keeping both on this single source of truth is what lets the proposal card
 * show *exactly* the dashboard the user is about to create — same panels, same
 * order, same units — instead of a hand-built approximation.
 *
 * No AI, no I/O: given the metric names a source reports, return the Panel[] to
 * lay out. Stat tiles lead (4 across), line charts fill the rows below (2 across).
 */

import {
  type Panel,
  DEFAULT_PANEL_CONFIG,
} from "@/lib/types/dashboard";
import { DASHBOARD_COLORS } from "@/lib/dashboards/colors";

// Series colors come from the canonical config palette (the same swatches the
// panel color picker offers), so auto-built dashboards match hand-built ones.
const PALETTE = DASHBOARD_COLORS;

// 24-col grid math. Stat tiles are quarter-width (4 across); line
// charts are half-width (2 across). Tweak the heights if the
// dashboard ever feels too cramped vertically.
export const STAT_W = 6;
export const STAT_H = 4;
export const LINE_W = 12;
export const LINE_H = 6;
export const MAX_STAT_TILES = 4;
export const MAX_TOTAL_PANELS = 14;

interface MetricSpec {
  metric: string;
  /** Higher = more headline-worthy (rendered first as a stat tile). */
  tilePriority: number;
  unit?: string;
  decimals?: number;
}

/**
 * Classify a metric into a tile spec. Anything we don't recognize gets
 * tilePriority 0 — won't be picked as a stat tile, will fall through
 * to the line-chart path.
 */
export function classify(metric: string): MetricSpec {
  const lower = metric.toLowerCase();

  if (/(_pct|percent)$|^cpu_|^disk_|^memory_pct/.test(lower)) {
    return { metric, tilePriority: 90, unit: "%", decimals: 1 };
  }
  if (/voltage|_v$|battery$/.test(lower)) {
    return { metric, tilePriority: 85, unit: "V", decimals: 2 };
  }
  if (/_dbm$|signal/.test(lower)) {
    return { metric, tilePriority: 80, unit: "dBm", decimals: 0 };
  }
  if (/_ms$|latency|ping/.test(lower)) {
    return { metric, tilePriority: 75, unit: "ms", decimals: 0 };
  }
  if (/temp|_c$|celsius/.test(lower)) {
    return { metric, tilePriority: 70, unit: "°C", decimals: 1 };
  }
  if (/uptime|_seconds$|^age_/.test(lower)) {
    return { metric, tilePriority: 60, unit: "s", decimals: 0 };
  }
  return { metric, tilePriority: 0 };
}

function buildStatTile(spec: MetricSpec, sourceId: string, i: number): Panel {
  const x = (i % 4) * STAT_W;
  const y = Math.floor(i / 4) * STAT_H;
  return {
    id: `stat-${i + 1}`,
    type: "stat",
    title: humanize(spec.metric),
    metrics: [`${sourceId}:${spec.metric}`],
    sources: [sourceId],
    dataSource: { type: "realtime" },
    config: {
      ...DEFAULT_PANEL_CONFIG,
      aggregation: "last",
      colors: [PALETTE[i % PALETTE.length]],
      unit: spec.unit,
      decimals: spec.decimals,
      // Stat panel has its own sparkline rendering — no legend needed.
      showLegend: false,
    },
    layout: {
      x,
      y,
      w: STAT_W,
      h: STAT_H,
      minW: 4,
      minH: 3,
    },
  };
}

function buildLinePanel(
  metric: string,
  sourceId: string,
  i: number,
  yOffset: number,
  /** True when the same metric also has a stat tile — disambiguate the title
   *  so the pair doesn't read as an accidental duplicate. */
  hasTwin = false,
): Panel {
  const x = (i % 2) * LINE_W;
  const y = yOffset + Math.floor(i / 2) * LINE_H;
  return {
    id: `line-${i + 1}`,
    type: "line",
    title: hasTwin ? `${humanize(metric)} · trend` : humanize(metric),
    metrics: [`${sourceId}:${metric}`],
    sources: [sourceId],
    dataSource: { type: "realtime" },
    config: {
      ...DEFAULT_PANEL_CONFIG,
      colors: [PALETTE[i % PALETTE.length]],
      showLegend: false,
      smoothLines: true,
    },
    layout: {
      x,
      y,
      w: LINE_W,
      h: LINE_H,
      minW: 4,
      minH: 3,
    },
  };
}

/** Turn `network_latency_ms` into `Network latency`. Strips unit suffixes. */
export function humanize(metric: string): string {
  return metric
    .replace(/_(pct|ms|dbm|c|s|v|mb|kb|gb|hz|seconds|voltage)$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Pick the layout for the dashboard:
 *   - Top row: up to 4 stat tiles (the highest-priority headline metrics)
 *   - Below: line charts for trend-worthy metrics, capped so the
 *     dashboard doesn't sprawl on devices that emit many metrics.
 *
 * Falls back to all-line-charts (the original quick-start behavior) if
 * no metric scores as tile-worthy — one-off custom metrics still get
 * a useful starter dashboard.
 */
export function buildPanels(
  metrics: string[],
  sourceId: string,
  opts?: {
    /**
     * Extra line-chart-worthy metric pattern, unioned with the built-in
     * hardware-flavored default. Templates (lib/dashboards/templates.ts) use
     * this so e.g. a service's error/request counters aren't dropped. Omitted
     * → output is byte-identical to the historical layout (the Terminal
     * proposal preview depends on that).
     */
    trendworthy?: RegExp;
  },
): Panel[] {
  const specs = metrics.map(classify);
  const tileCandidates = specs
    .filter((s) => s.tilePriority > 0)
    .sort((a, b) => b.tilePriority - a.tilePriority)
    .slice(0, MAX_STAT_TILES);

  if (tileCandidates.length === 0) {
    return metrics
      .slice(0, MAX_TOTAL_PANELS)
      .map((m, i) => buildLinePanel(m, sourceId, i, 0));
  }

  const tiles = tileCandidates.map((spec, i) =>
    buildStatTile(spec, sourceId, i),
  );

  // Pick line-chart subjects: prefer metrics whose trend tells a story.
  // We always include CPU / memory / temp / latency-class metrics if
  // we have them, since those are the ones an engineer will actually
  // squint at. Other metrics (signal, disk_used_pct, uptime) are
  // already represented as tiles and don't need a sibling line panel.
  const trendworthy = new Set([
    ...specs
      .filter(
        (s) =>
          /(_pct|percent|memory|temp|_c$|_ms$|latency|cpu)/.test(
            s.metric.toLowerCase(),
          ) || opts?.trendworthy?.test(s.metric),
      )
      .map((s) => s.metric),
  ]);
  const lineMetrics = metrics
    .filter((m) => trendworthy.has(m))
    .slice(0, MAX_TOTAL_PANELS - tiles.length);

  // Stat tiles occupy y=0..STAT_H. Line charts start one row below.
  const tileMetricSet = new Set(tileCandidates.map((s) => s.metric));
  const lineYOffset = STAT_H;
  const lines = lineMetrics.map((m, i) =>
    buildLinePanel(m, sourceId, i, lineYOffset, tileMetricSet.has(m)),
  );

  return [...tiles, ...lines];
}

/**
 * One overlay line panel: the same metric plotted for every source that
 * reports it, on a single chart. This is the multi-source primitive — e.g.
 * `battery_voltage` from drone-001 + drone-002 as two series on one axis.
 * Each source gets a distinct palette color and the legend is on so you can
 * tell them apart.
 */
function buildOverlayLinePanel(
  metric: string,
  sources: string[],
  i: number,
): Panel {
  const x = (i % 2) * LINE_W;
  const y = Math.floor(i / 2) * LINE_H;
  return {
    id: `overlay-${i + 1}`,
    type: "line",
    title: humanize(metric),
    metrics: sources.map((s) => `${s}:${metric}`),
    sources,
    dataSource: { type: "realtime" },
    config: {
      ...DEFAULT_PANEL_CONFIG,
      colors: sources.map((_, idx) => PALETTE[idx % PALETTE.length]),
      // Overlay only makes sense if you can tell the sources apart.
      showLegend: sources.length > 1,
      smoothLines: true,
    },
    layout: { x, y, w: LINE_W, h: LINE_H, minW: 4, minH: 3 },
  };
}

/**
 * Build an overlay dashboard from several sources. For every metric, we plot
 * one chart that overlays every source reporting it — so shared metrics
 * (the comparison the user actually wants) come out as multi-series charts,
 * and source-specific metrics still get their own single-series chart.
 *
 * Metrics shared by the most sources lead, since those are the headline
 * comparisons; the rest follow. Capped so a few many-metric sources don't
 * sprawl into a hundred panels.
 */
export function buildOverlayPanels(
  metricsBySource: Record<string, string[]>,
): Panel[] {
  const sources = Object.keys(metricsBySource);

  // metric -> sources that report it, preserving first-seen order of metrics.
  const order: string[] = [];
  const sourcesByMetric = new Map<string, string[]>();
  for (const source of sources) {
    for (const metric of metricsBySource[source]) {
      const existing = sourcesByMetric.get(metric);
      if (existing) {
        existing.push(source);
      } else {
        sourcesByMetric.set(metric, [source]);
        order.push(metric);
      }
    }
  }

  // Most-shared metrics first (stable for ties via first-seen order).
  order.sort(
    (a, b) => sourcesByMetric.get(b)!.length - sourcesByMetric.get(a)!.length,
  );

  return order
    .slice(0, MAX_TOTAL_PANELS)
    .map((metric, i) =>
      buildOverlayLinePanel(metric, sourcesByMetric.get(metric)!, i),
    );
}
