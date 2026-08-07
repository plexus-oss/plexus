/**
 * Per-panel typed configuration interfaces
 *
 * Each panel type has its own config interface extending BasePanelConfig.
 * Panel components cast `panel.config as FooPanelConfig` for type safety.
 * Config section components in config-sections/ use these for per-type forms.
 */

import type { Transform } from "@/lib/transforms";
import type { ColorScaleName } from "@/components/ui/lib/color-scales";
import type { KnownPanelType } from "@/lib/panels/registry";
import type {
  DataFilter,
  DataAggregation,
  Aggregation,
  Model3DPartBinding,
  TelemetryBinding,
  AssocCategory,
} from "./dashboard";

// =============================================================================
// Base Config (truly shared by all panels)
// =============================================================================

export interface BasePanelConfig {
  colors?: string[];
  metricColors?: Record<string, string>;
  /** Per-table default color for connection-backed panels (table name -> color) */
  tableColors?: Record<string, string>;
  unit?: string;
  decimals?: number;
  /** Value display notation; "scientific" renders toExponential(decimals) */
  notation?: "standard" | "scientific";
  sourceId?: string;
  filters?: DataFilter[];
  excludedDashboardFilters?: string[];
  dataAggregation?: DataAggregation;
  transforms?: Transform[];
}

// =============================================================================
// Chart Panels (line, area, bar, scatter)
// =============================================================================

export interface ChartPanelConfig extends BasePanelConfig {
  showLegend?: boolean;
  showGrid?: boolean;
  showXAxis?: boolean;
  showYAxis?: boolean;
  showLimits?: boolean;
  smoothLines?: boolean;
  showDataPoints?: boolean;
  /** Show persisted annotation markers on charts */
  showAnnotations?: boolean;
  /** Dash lines for data beyond "now" */
  showFutureDashing?: boolean;
  /** Show cross-panel synced cursor line + tooltip */
  showCrosshair?: boolean;
  /** Show alert time bands on charts (default: true) */
  showAlerts?: boolean;
  limits?: Record<string, { min?: number; max?: number }>;
  /** Manual Y-axis bounds; unset ends auto-scale from the visible data */
  yMin?: number;
  yMax?: number;
  xAxisField?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  stacked?: boolean;
  barWidth?: number;
  orientation?: "vertical" | "horizontal";
  showTable?: boolean;
  aggregation?: Aggregation;
}

// =============================================================================
// Association Scatter Panel (categorical lane-based scatter)
// =============================================================================

export interface AssocScatterPanelConfig extends BasePanelConfig {
  /** SQL column for the X axis time (epoch/ISO/timestamp). */
  timeColumn?: string;
  /** SQL column for the Y lanes (categorical, e.g. "satellite_id"). */
  yColumn?: string;
  /** SQL column whose value selects the glyph (color + shape). */
  categoryColumn?: string;
  /** Legend: maps a category value → its label, color, and marker glyph. */
  assocCategories?: AssocCategory[];
  xAxisLabel?: string;
  yAxisLabel?: string;
  showLegend?: boolean;
  showGrid?: boolean;
}

// =============================================================================
// Stat Panel
// =============================================================================

export interface StatPanelConfig extends BasePanelConfig {
  aggregation?: Aggregation;
  unit?: string;
  decimals?: number;
  /** Show sparkline chart (default true) */
  showSparkline?: boolean;
  /** Show trend percentage (default true) */
  showTrend?: boolean;
  /** Number of recent data points used for trend calculation (default 20) */
  trendWindow?: number;
}

// =============================================================================
// Heatmap Panel
// =============================================================================

export interface HeatmapPanelConfig extends BasePanelConfig {
  colorScale?: string;
  /** Minimum number of time buckets (default 6) */
  minTimeBuckets?: number;
  /** Maximum number of time buckets (default 20) */
  maxTimeBuckets?: number;
  /** Minimum number of value buckets (default 5) */
  minValueBuckets?: number;
  /** Maximum number of value buckets (default 15) */
  maxValueBuckets?: number;
  /** Named-slot bindings set by HeatmapConfigurator (x/y/value metric keys). */
  heatmap?: { x?: string; y?: string; value?: string };
}

// =============================================================================
// Map Panel
// =============================================================================

export interface MapPanelConfig extends BasePanelConfig {
  centerLat?: number;
  centerLng?: number;
  zoom?: number;
  latMetric?: string;
  lngMetric?: string;
  showPath?: boolean;
  pathColor?: string;
  markerColor?: string;
  coordinateFormat?: "decimal" | "dms";
  /** Maximum trail points to render (default 200) */
  maxTrailPoints?: number;
  /** Selected device source IDs (shared with fleet-grid / fleet-table). */
  fleetSources?: string[];
}

// =============================================================================
// Radar Panel
// =============================================================================

export interface RadarPanelConfig extends BasePanelConfig {
  showSweep?: boolean;
  maxPoints?: number;
  maxRange?: number;
}

// =============================================================================
// Earth Panel
// =============================================================================

export interface EarthPanelConfig extends BasePanelConfig {
  enableRotation?: boolean;
  timeScale?: number;
  brightness?: number;
  showAtmosphere?: boolean;
  showClouds?: boolean;
  dayMapUrl?: string;
  nightMapUrl?: string;
  cloudsMapUrl?: string;
  normalMapUrl?: string;
  specularMapUrl?: string;
  satellites?: Array<{
    sourceId: string;
    name: string;
    color: string;
    orbitalPeriod: number;
    inclination: number;
    raan: number;
    initialPhase: number;
    tle?: { name: string; line1: string; line2: string };
  }>;
  groundStations?: Array<{
    name: string;
    lat: number;
    lng: number;
    color: string;
  }>;
  showOrbitalPaths?: boolean;
  showGroundTracks?: boolean;
  deviceIds?: string[];
  deviceGroups?: string[];
  /** Max satellites before switching to GPU points rendering (default 30) */
  pointsThreshold?: number;
  /** Max satellites for which orbital paths are computed (default 100) */
  maxOrbitalPaths?: number;
  /** Enable directional sun lighting for day/night shading */
  showSunLighting?: boolean;
}

// =============================================================================
// Gantt Panel
// =============================================================================

export interface GanttPanelConfig extends BasePanelConfig {
  timeWindowHours?: number;
  timezone?: string;
  leftPanelHeader?: string;
}

// =============================================================================
// Text Panel
// =============================================================================

export interface TextPanelConfig extends BasePanelConfig {
  content?: string;
  fontSize?: "sm" | "base" | "lg" | "xl" | "2xl";
  align?: "left" | "center" | "right";
  verticalCenter?: boolean;
}

// =============================================================================
// Video Panel
// =============================================================================

export interface VideoPanelConfig extends BasePanelConfig {
  cameraId?: string;
  frameRate?: number;
  recordingEnabled?: boolean;
  /** Static video URL — overrides the live camera. Direct MP4/WebM render in
   *  a <video>; YouTube/Vimeo/other URLs render as an <iframe> embed. */
  videoUrl?: string;
  videoPoster?: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
}

// =============================================================================
// Video Telemetry Panel
// =============================================================================

export interface VideoTelemetryPanelConfig extends BasePanelConfig {
  sourceId?: string;
  cameraId?: string;
  frameRate?: number;
}

// =============================================================================
// Dashboard Panel
// =============================================================================

export interface DashboardPanelConfig extends BasePanelConfig {
  dashboardId?: string;
  showDescription?: boolean;
  showPanelCount?: boolean;
  showLastUpdated?: boolean;
  previewMetrics?: string[];
  statusMetric?: string;
  // Shared-mode card fields: on a public /shared page the authed dashboard
  // fetch 401s, so a dashboard card renders from these and links to the shared
  // child dashboard (sharedToken) instead of the authed /dashboards/:id route.
  sharedToken?: string;
  cardName?: string;
  cardSubtitle?: string;
  cardIcon?: string;
  cardIconUrl?: string;
  // Rich card metrics with per-metric thresholds → drive the card's health
  // (status pill + accent color) and the big value + sparkline blocks.
  cardMetrics?: Array<{
    metric: string;
    label?: string;
    unit?: string;
    decimals?: number;
    warnAbove?: number;
    critAbove?: number;
    warnBelow?: number;
    critBelow?: number;
  }>;
  // Heat-strip micro bar-chart on a dashboard card (e.g. per-GPU temps): one
  // bar per metric, scaled min→max, colored by warn/crit, with a threshold line.
  cardStrip?: {
    metrics: string[];
    label?: string;
    itemLabel?: string;
    unit?: string;
    min?: number;
    max?: number;
    warnAbove?: number;
    critAbove?: number;
  };
}

// =============================================================================
// List Panel
// =============================================================================

export interface ListPanelConfig extends BasePanelConfig {
  items?: Array<{
    id: string;
    title: string;
    description?: string;
    timestamp?: string;
    status?: "pending" | "active" | "completed" | "error";
    href?: string;
  }>;
  showTimestamp?: boolean;
  showStatus?: boolean;
  maxItems?: number;
  timestampFormat?: "relative" | "absolute";
  titleMetric?: string;
  descriptionMetric?: string;
}

// =============================================================================
// Calendar Panel
// =============================================================================

export interface CalendarPanelConfig extends BasePanelConfig {
  events?: Array<{
    id: string;
    title: string;
    date: string;
    color?: string;
  }>;
  eventMetric?: string;
  dateMetric?: string;
  showEventCount?: boolean;
  highlightColor?: string;
}

// =============================================================================
// Satellite Info Panel
// =============================================================================

export interface SatelliteInfoPanelConfig extends BasePanelConfig {
  sourceId?: string;
  connectionId?: string;
  tleQuery?: string;
}

// =============================================================================
// Model 3D Panel
// =============================================================================

export interface Model3DPanelConfig extends BasePanelConfig {
  modelUrl?: string;
  modelType?: "stl" | "obj" | "gltf" | "glb";
  wireframe?: boolean;
  autoRotate?: boolean;
  pitchMetric?: string;
  rollMetric?: string;
  yawMetric?: string;
  model3dPartBindings?: Model3DPartBinding[];
  model3dColorScale?: ColorScaleName;
  model3dAutoRange?: boolean;
  model3dMinValue?: number;
  model3dMaxValue?: number;
  /** Phase 2: unified bindings (read-preferred over model3dPartBindings) */
  bindings?: TelemetryBinding[];
  /** Per-group visibility map keyed by Object3D name */
  modelLayerVisibility?: Record<string, boolean>;
  /** Show floating value callouts anchored to bound mesh parts */
  showCallouts?: boolean;
  /** Show hairline leader lines from callout to mesh */
  showLeaderLines?: boolean;
  // CAD-style rendering & motion
  cadStyle?: boolean;
  backgroundColor?: string;
  modelRotationOffset?: [number, number, number];
  partScales?: Record<string, number>;
  partSpins?: Record<string, { axis: "x" | "y" | "z"; speed: number }>;
  fixedParts?: string[];
  positionXMetric?: string;
  positionYMetric?: string;
  positionZMetric?: string;
  positionScale?: number;
}

// =============================================================================
// Image Panel
// =============================================================================

export interface ImagePanelConfig extends BasePanelConfig {
  imageUrl?: string;
  imageCaption?: string;
  imageFit?: "contain" | "cover";
}

// =============================================================================
// Schematic Panel
// =============================================================================

export interface SchematicPanelConfig extends BasePanelConfig {
  /** Public URL to the uploaded SVG (Supabase Storage). */
  schematicSvgUrl?: string;
  /** Cached viewBox string ("minX minY width height") captured at upload. */
  schematicViewBox?: string;
  /** Pins/anchors bound to live telemetry. */
  schematicBindings?: TelemetryBinding[];
  /** Render label chips above values (default true). */
  schematicShowLabels?: boolean;
  /** Render hairline connectors from pin to callout (default true). */
  schematicShowConnectors?: boolean;
  /** Opacity of the underlying schematic SVG (default 1). */
  schematicBackgroundOpacity?: number;
}

// =============================================================================
// Attitude Panel
// =============================================================================

export interface AttitudePanelConfig extends BasePanelConfig {
  /** Named-slot bindings set by AttitudeConfigurator (roll/pitch/yaw metric keys). */
  attitude?: { roll?: string; pitch?: string; yaw?: string };
  /** Optional background image URL — rendered behind the instrument. */
  backgroundImage?: string;
  backgroundImageOpacity?: number; // 0..1, default 0.5
}

// =============================================================================
// Alerts Panel
// =============================================================================

export interface AlertsPanelConfig extends BasePanelConfig {
  maxItems?: number;
  showResolved?: boolean;
  showSourceName?: boolean;
}

// =============================================================================
// DataGrid Panel
// =============================================================================

export interface DataGridPanelConfig extends BasePanelConfig {
  showTable?: boolean;
  aggregation?: Aggregation;
}

// =============================================================================
// Fleet Grid Panel
// =============================================================================

export interface FleetGridPanelConfig extends BasePanelConfig {
  /** Selected device source IDs. */
  fleetSources?: string[];
  // Column-role overrides (auto-detected from the query result when unset —
  // see fleet-grid-panel.tsx header for the detection defaults).
  titleColumn?: string;
  subtitleColumn?: string;
  stateColumn?: string;
  metricColumn?: string;
  metricLabel?: string;
  metricUnit?: string;
  severityColumn?: string;
  timestampColumn?: string;
}

// =============================================================================
// Fleet Table Panel
// =============================================================================

export interface FleetTablePanelConfig extends BasePanelConfig {
  /** Selected device source IDs (rows). */
  fleetSources?: string[];
  /** Metric columns with optional thresholds. Row order: worst severity first. */
  columns?: Array<{
    label: string;
    metric: string;
    unit?: string;
    decimals?: number;
    warnAbove?: number;
    critAbove?: number;
    warnBelow?: number;
    critBelow?: number;
  }>;
}

// =============================================================================
// Events (Activity) Panel
// =============================================================================

export interface EventsPanelConfig extends BasePanelConfig {
  severity?: string;
  category?: string;
  eventType?: string;
  maxItems?: number;
  grouped?: boolean;
  showJumpLink?: boolean;
}

// =============================================================================
// Devices Panel
// =============================================================================

export interface DevicesPanelConfig extends BasePanelConfig {
  statusFilter?: string[];
  deviceType?: string;
  search?: string;
  limit?: number;
}

// =============================================================================
// Status Card (legacy)
// =============================================================================

/**
 * Legacy status-card fields that exist in stored customer configs but have no
 * current UI or renderer consuming them. Kept so the stored `PanelConfig`
 * shape remains fully typed; do not extend.
 */
export interface StatusCardLegacyConfig {
  statusCardName?: string;
  name?: string;
  protocol?: string;
  miniViz?: "globe" | "map" | "none";
  subsystems?: Array<{
    label: string;
    metric: string;
    icon?: string;
    warningMin?: number;
    warningMax?: number;
    criticalMin?: number;
    criticalMax?: number;
  }>;
  cardStats?: Array<{
    label: string;
    metric: string;
    unit?: string;
    decimals?: number;
  }>;
  stats?: Array<{
    label: string;
    metric: string;
    unit?: string;
    decimals?: number;
  }>;
  showSuccessRate?: boolean;
  successRateMetric?: string;
  showTasks?: boolean;
  tasks?: Array<{
    id: string;
    label: string;
    type: string;
    priority: string;
  }>;
  contactTasks?: Array<{
    id: string;
    label: string;
    type: string;
  }>;
}

// =============================================================================
// Event Log Panel
// =============================================================================

export interface EventLogPanelConfig extends BasePanelConfig {
  timeRange?: string;
  name?: string;
  limit?: number;
  showTags?: boolean;
  showBody?: boolean;
}

// =============================================================================
// Config type map — maps panel type string to its config interface
// =============================================================================

export interface PanelConfigMap {
  line: ChartPanelConfig;
  area: ChartPanelConfig;
  bar: ChartPanelConfig;
  scatter: ChartPanelConfig;
  "assoc-scatter": AssocScatterPanelConfig;
  stat: StatPanelConfig;
  heatmap: HeatmapPanelConfig;
  datagrid: DataGridPanelConfig;
  "fleet-grid": FleetGridPanelConfig;
  "fleet-table": FleetTablePanelConfig;
  radar: RadarPanelConfig;
  attitude: AttitudePanelConfig;
  model3d: Model3DPanelConfig;
  earth: EarthPanelConfig;
  "satellite-info": SatelliteInfoPanelConfig;
  text: TextPanelConfig;
  video: VideoPanelConfig;
  "video-telemetry": VideoTelemetryPanelConfig;
  map: MapPanelConfig;
  calendar: CalendarPanelConfig;
  list: ListPanelConfig;
  gantt: GanttPanelConfig;
  alerts: AlertsPanelConfig;
  events: EventsPanelConfig;
  devices: DevicesPanelConfig;
  dashboard: DashboardPanelConfig;
  schematic: SchematicPanelConfig;
  image: ImagePanelConfig;
  event_log: EventLogPanelConfig;
}

// Compile-time completeness: every registered panel type has a config entry.
// Errors here mean PANEL_TYPES (lib/panels/registry.ts) and PanelConfigMap
// have drifted — add the missing key to whichever side is behind.
type UnmappedPanelTypes = Exclude<KnownPanelType, keyof PanelConfigMap>;
type AssertAllPanelTypesMapped<T extends never = UnmappedPanelTypes> = T;
export type _PanelConfigMapComplete = AssertAllPanelTypesMapped;

/** Get the typed config for a specific panel type */
export type PanelConfigFor<T extends keyof PanelConfigMap> = PanelConfigMap[T];

// =============================================================================
// Config section component props — used by config-sections/ components
// =============================================================================

export interface ConfigSectionProps {
  config: BasePanelConfig & Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}
