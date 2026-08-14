/**
 * Dashboard system types
 */

import type {
  AlertsPanelConfig,
  AssocScatterPanelConfig,
  ChartPanelConfig,
  DashboardPanelConfig,
  DataGridPanelConfig,
  DevicesPanelConfig,
  EarthPanelConfig,
  EventLogPanelConfig,
  EventsPanelConfig,
  FleetTablePanelConfig,
  GanttPanelConfig,
  ListPanelConfig,
  Model3DPanelConfig,
  SatelliteInfoPanelConfig,
  StatPanelConfig,
  StatusCardLegacyConfig,
  VideoPanelConfig,
} from "./panel-configs";

/**
 * Binding a GLTF mesh part to a live metric with optional thresholds.
 *
 * `invertThreshold` flips the comparison: default fires when value goes
 * ABOVE the threshold (high-is-bad — temp, pressure, RPM). Set true for
 * "low-is-bad" metrics like UPS charge or oxygen level.
 */
export interface Model3DPartBinding {
  partName: string;
  metric: string;
  thresholdWarning?: number;
  thresholdCritical?: number;
  invertThreshold?: boolean;
}

/**
 * Where a TelemetryBinding attaches to its artifact.
 *
 *   svg-id     → pin sticks to <g id="…"> / element id in the uploaded SVG.
 *                Survives re-uploads of the same schematic with stable ids.
 *   svg-point  → fallback when there's no id under the user's click.
 *                Stored as raw viewBox-space coordinates (NOT normalized).
 *   mesh-name  → 3D analog — anchored to a named Object3D in a GLTF/GLB.
 */
export type AnchorRef =
  | { kind: "svg-id"; id: string }
  | { kind: "svg-point"; x: number; y: number }
  | { kind: "mesh-name"; name: string };

/**
 * Unified binding shape used by both the 2D Schematic panel and the
 * 3D Model panel. Same threshold semantics, same display modes, just a
 * different anchor type.
 */
export interface TelemetryBinding {
  id: string;
  anchor: AnchorRef;
  metric: string; // "sourceId:metricName"
  display: "value" | "state" | "indicator";
  label?: string;
  unit?: string;
  decimals?: number;
  thresholdWarning?: number;
  thresholdCritical?: number;
  /** State pins: map raw value to a display label + optional color. */
  enumMap?: Record<string | number, { label: string; color?: string }>;
  /** Screen-pixel offset of the callout from the anchor (so the user can nudge callouts off the geometry). */
  calloutOffset?: { dx: number; dy: number };
}

/**
 * Built-in panel types — sourced from the runtime registry so the union can
 * never drift from what's actually registered.
 */
export type { KnownPanelType as BuiltinPanelType } from "@/lib/panels/registry";

/**
 * Panel type - string for extensibility
 */
export type PanelType = string;

/** Marker glyphs for the association-scatter panel legend. */
export type GlyphShape = "circle" | "diamond" | "square" | "triangle";

/**
 * One legend entry for the association-scatter panel: a category value from the
 * data (e.g. "correct_association") rendered as a colored, optionally-filled
 * glyph with a human label.
 */
export interface AssocCategory {
  /** Raw value as it appears in the category column. */
  value: string;
  /** Human-readable legend label. */
  label: string;
  /** Marker color (hex or CSS color). */
  color: string;
  /** Marker shape. */
  shape: GlyphShape;
  /** Filled vs. outline-only marker. */
  filled: boolean;
}

// Aggregation methods for stat panels
// "count" returns the number of sources with data in the time window —
// the only aggregation that reduces across sources without requiring
// numeric values. max/min/avg/sum also reduce across sources when the
// panel lists multiple (source, metric) pairs (see stat-panel.tsx).
export type Aggregation = "last" | "avg" | "min" | "max" | "sum" | "count";

// Time range configuration
export interface TimeRange {
  type: "relative" | "absolute";
  value: string; // "5m", "15m", "1h", "6h", "24h", "7d" or ISO dates
}

// =============================================================================
// Data Filtering
// =============================================================================

/** Operators for numeric comparisons */
export type NumericOperator = ">" | ">=" | "<" | "<=" | "=" | "!=";

/** Operators for string comparisons */
export type StringOperator =
  | "="
  | "!="
  | "contains"
  | "startsWith"
  | "endsWith";

/** Filter condition for a single metric/column */
export interface DataFilter {
  /** The metric name (for devices) or column name (for tables/connections) */
  field: string;
  /** Comparison operator */
  operator: NumericOperator | StringOperator;
  /** Value to compare against */
  value: string | number;
  /** Whether this filter is enabled (default true) */
  enabled?: boolean;
}

// =============================================================================
// SQL Helpers (re-exported from lib/transforms/sql.ts)
// =============================================================================

export {
  isNumericFilter,
  filtersToSqlConditions,
  timeBucketToInterval,
} from "@/lib/transforms/sql";
export type { ParameterizedConditions } from "@/lib/transforms/sql";

// =============================================================================
// Aggregation
// =============================================================================

/** Time bucket sizes for aggregation */
export type TimeBucket = "1m" | "5m" | "15m" | "1h" | "6h" | "1d";

/** Aggregation function types */
export type AggregationFunction =
  | "avg"
  | "min"
  | "max"
  | "sum"
  | "count"
  | "first"
  | "last";

/** Panel-level aggregation configuration */
export interface DataAggregation {
  /** Time bucket for grouping data points */
  bucket: TimeBucket;
  /** Aggregation function to apply */
  function: AggregationFunction;
  /** Whether aggregation is enabled */
  enabled: boolean;
}

/**
 * Panel configuration as stored in dashboard JSONB.
 *
 * Composed from the per-type interfaces in `panel-configs.ts` — that file is
 * the source of truth for which fields belong to which panel type; this
 * intersection is the loose stored shape (every field optional, every panel's
 * fields present) so historical configs stay valid. Typed consumers narrow
 * with `panel.config as StatPanelConfig` etc.
 */
export type PanelConfig = ChartPanelConfig &
  AssocScatterPanelConfig &
  StatPanelConfig &
  DataGridPanelConfig &
  FleetTablePanelConfig &
  Model3DPanelConfig &
  EarthPanelConfig &
  SatelliteInfoPanelConfig &
  VideoPanelConfig &
  ListPanelConfig &
  GanttPanelConfig &
  AlertsPanelConfig &
  EventsPanelConfig &
  DevicesPanelConfig &
  DashboardPanelConfig &
  EventLogPanelConfig &
  StatusCardLegacyConfig;

// Data source types for panels
export type DataSourceType = "realtime" | "connection";

/**
 * Real-time data source - live data pushed to the gateway /ingest endpoint
 * For sensors, devices, streaming APIs - anything pushing data in real-time
 * Uses panel.metrics for device:metric selection
 */
export interface RealtimeDataSource {
  type: "realtime";
}

/**
 * A relationship join applied to a connection data source by the visual
 * builder. Lets a table that lacks a time column borrow one from a related
 * table (e.g. plot `association_verification` against `satellite_base.time`,
 * joined on `orbit_id`) without the user writing SQL.
 */
export interface JoinSpec {
  /** The related table to join in (provides the time column). */
  table: string;
  /** Column on the base (selected) table used for the join. */
  localColumn: string;
  /** Column on the joined table used for the join. */
  foreignColumn: string;
}

/** Fixed time bucket for the simple builder ("auto" = size from time range). */
export type BuilderTimeBucket = "auto" | "hour" | "day" | "week" | "month";

/**
 * Declarative spec the simple (quick-chart) editor writes. NEVER executed
 * directly — `ConnectionDataSource.query` is always materialized from it at
 * save time and remains the executable source of truth everywhere (renderers,
 * shared/public views, exports). Absent on panels built before this feature
 * or with hand-written SQL.
 *
 * Editor drift rule: the simple form is shown iff `builder` exists,
 * `customQuery !== true`, and `builder.generatedQuery === query`; any
 * mismatch (e.g. SQL edited out-of-band) falls back to the SQL view.
 */
export interface PanelBuilderSpec {
  /** Spec version (for the spec itself — NOT a dashboard schema version). */
  version: 1;
  /** Base table. */
  table: string;
  /** Time column for the X axis (auto-detected when omitted). */
  timeColumn?: string;
  /** What to plot: count of rows, an aggregate of a column, or raw values. */
  aggregate: {
    fn: "count" | "avg" | "sum" | "min" | "max" | "raw";
    column?: string;
    /** Raw mode only: explicit measure list (multi-measure panels).
     *  Undefined = all available measures (the legacy visual-builder default). */
    columns?: string[];
  };
  /** Split into one series per distinct value (→ seriesColumn). */
  groupBy?: string;
  /** Time bucket ("auto" sizes from the dashboard time range). */
  bucket?: BuilderTimeBucket;
  /** Joins to related tables (same shape the visual builder stores). */
  joins?: JoinSpec[];
  /** SQL that was generated from this spec at save time. If it differs from
   *  `dataSource.query`, someone edited SQL out-of-band → editor opens in
   *  SQL mode instead of showing a lying form. */
  generatedQuery: string;
}

/**
 * Connection data source - query external database directly
 * For PostgreSQL, ClickHouse, and other external connections
 */
export interface ConnectionDataSource {
  type: "connection";
  sourceId: string;
  query: string;
  selectedColumns?: string[]; // Columns selected via UI (for display purposes)
  timeColumn?: string;
  valueColumn?: string;
  refreshInterval?: number; // Auto-refresh in ms (0 = manual only)
  /** True if user has manually edited the query (stops auto-regeneration) */
  customQuery?: boolean;
  /** Visual-builder joins to related tables (for time/value columns). */
  joins?: JoinSpec[];
  /**
   * Optional breakdown/pivot column: split the chart into one series per
   * distinct value of this column (e.g. one line per `assoc_type`).
   */
  seriesColumn?: string;
  /**
   * Build-time hint: maps each measure/`count` series key → its owning table,
   * so per-table colors can resolve without re-deriving the schema at render.
   */
  seriesTableMap?: Record<string, string>;
  /** Build-time hint: the table owning `seriesColumn` (all breakdown values). */
  breakdownTable?: string;
  /** Simple-editor intent spec (build-time only, never executed) — see
   *  `PanelBuilderSpec`. Additive: older clients/readers ignore it. */
  builder?: PanelBuilderSpec;
}

export type DataSource = RealtimeDataSource | ConnectionDataSource;

// Type guards for data sources
export function isRealtimeSource(
  source: DataSource | undefined,
): source is RealtimeDataSource {
  return source?.type === "realtime";
}

export function isConnectionSource(
  source: DataSource | undefined,
): source is ConnectionDataSource {
  return source?.type === "connection";
}

// Panel layout (react-grid-layout format)
export interface PanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

// Individual panel definition
export interface Panel {
  id: string;
  type: PanelType;
  title: string;
  metrics: string[];
  /** Source IDs this panel pulls data from (supports multiple sources per panel) */
  sources?: string[];
  dataSource?: DataSource;
  config: PanelConfig;
  layout: PanelLayout;
}

// ─── Dashboard Variables ─────────────────

export type DashboardVariableType = "text" | "query" | "custom";

export interface DashboardVariable {
  /** Unique name used in $name references (alphanumeric + underscore) */
  name: string;
  /** Human-readable label for the toolbar dropdown */
  label: string;
  /** Variable type */
  type: DashboardVariableType;
  /** Currently selected value */
  current: string;
  /** Default value (used on first load) */
  defaultValue?: string;
  /** For "query" type: source ID to run the query against */
  querySourceId?: string;
  /** For "query" type: SQL query that returns options (first column used) */
  queryString?: string;
  /** For "custom" type: comma-separated list of values */
  customValues?: string;
  /** Allow multiple selection */
  multi?: boolean;
  /** Include an "All" option */
  includeAll?: boolean;
  /** Sort order for options */
  sort?: "none" | "alpha-asc" | "alpha-desc";
}

// ─── Dashboard Display Settings ─────────────────────────────────────────────

export interface DashboardDisplaySettings {
  /** Hide the toolbar row (time range, filters, variables) */
  hideToolbar?: boolean;
  /** Lock editing — dashboard acts as a read-only UI page */
  lockEditing?: boolean;
  /** Hide panel titles for a cleaner look */
  hidePanelTitles?: boolean;
  /** Dashboard background color override */
  backgroundColor?: string;
  /** Auto-refresh interval in seconds (0 = off) */
  autoRefresh?: number;
  /** Show synced crosshair/tooltip on all panels when hovering one */
  syncTooltips?: boolean;
  /** Show the mini time scrubber strip below the toolbar (default true) */
  showScrubber?: boolean;
}

// Dashboard configuration stored in JSONB
export interface DashboardConfig {
  panels: Panel[];
  timeRange: TimeRange;
  /** Auto-refresh interval in ms (0 = off). "Live" is just refresh every 5s. */
  refreshInterval?: number;
  /** Dashboard-level filters applied to all panels */
  filters?: DataFilter[];
  /** Dashboard-level template variables */
  variables?: DashboardVariable[];
  /** Display and presentation settings */
  displaySettings?: DashboardDisplaySettings;
}

// Full dashboard record from database
export interface Dashboard {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  icon_url: string | null;
  config: DashboardConfig;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

// Dashboard list item (lighter for list view)
export interface DashboardListItem {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  icon_url: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  panel_count: number;
}

// Create dashboard request
export interface CreateDashboardRequest {
  name: string;
  description?: string;
  icon?: string;
  parent_id?: string;
}

// Update dashboard request
export interface UpdateDashboardRequest {
  name?: string;
  description?: string;
  icon?: string;
  icon_url?: string | null;
  config?: DashboardConfig;
}

// Available metric info (from telemetry)
export interface AvailableMetric {
  name: string;
  count: number;
  last_seen: string;
  sources: string[];
}

/**
 * Flexible value type - supports all JSON-serializable values
 * Enables "solve for all" hardware teams
 */
export type FlexValue =
  | number
  | string
  | boolean
  | Record<string, unknown>
  | unknown[];

/**
 * Value type discriminator for filtering and display
 */
export type ValueType = "number" | "string" | "boolean" | "object" | "array";

// Telemetry data point for charts (flexible values)
export interface TelemetryPoint {
  timestamp: string;
  value: FlexValue;
  value_type?: ValueType;
}

// Telemetry query result
export interface TelemetryQueryResult {
  metric: string;
  data: TelemetryPoint[];
}

// Default configurations
export const DEFAULT_TIME_RANGE: TimeRange = {
  type: "relative",
  value: "15m",
};

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  panels: [],
  timeRange: DEFAULT_TIME_RANGE,
};

export const DEFAULT_PANEL_CONFIG: PanelConfig = {
  colors: ["#3b82f6"],
  aggregation: "last",
  decimals: 2,
  showLegend: true,
  showGrid: true,
};

// Panel size presets (24-col grid, 40px row height)
export const PANEL_SIZE_PRESETS = {
  small: { w: 6, h: 4, minW: 4, minH: 3 },
  medium: { w: 12, h: 6, minW: 6, minH: 4 },
  large: { w: 24, h: 8, minW: 8, minH: 5 },
} as const;

// Time range options for picker (quick ranges)
export const TIME_RANGE_OPTIONS = [
  { label: "Last 1 minute", value: "1m" },
  { label: "Last 5 minutes", value: "5m" },
  { label: "Last 15 minutes", value: "15m" },
  { label: "Last 30 minutes", value: "30m" },
  { label: "Last 1 hour", value: "1h" },
  { label: "Last 3 hours", value: "3h" },
  { label: "Last 6 hours", value: "6h" },
  { label: "Last 12 hours", value: "12h" },
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 2 days", value: "2d" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 90 days", value: "90d" },
] as const;

// Helper to parse relative time to milliseconds
export function parseRelativeTime(value: string): number {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) return 15 * 60 * 1000; // default 15 min

  const [, num, unit] = match;
  const n = parseInt(num, 10);

  switch (unit) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    case "d":
      return n * 24 * 60 * 60 * 1000;
    default:
      return 15 * 60 * 1000;
  }
}

// Helper to get time range bounds
export function getTimeRangeBounds(timeRange: TimeRange): {
  start: Date;
  end: Date;
} {
  const end = new Date();

  if (timeRange.type === "absolute") {
    const [startStr, endStr] = timeRange.value.split("/");
    return {
      start: new Date(startStr),
      end: endStr ? new Date(endStr) : end,
    };
  }

  const ms = parseRelativeTime(timeRange.value);
  return {
    start: new Date(end.getTime() - ms),
    end,
  };
}
