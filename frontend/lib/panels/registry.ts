/**
 * Panel Registry
 *
 * Single source of truth for all panel type metadata. Adding a new panel =
 * one entry here + the panel component file + one line in panel-renderer's
 * COMPONENT_MAP. Replaces the duplicated PANEL_CATEGORIES in add-panel-modal.
 */

import type { LucideIcon } from "lucide-react";
import {
  LineChart,
  AreaChart,
  BarChart3,
  ScatterChart,
  Crosshair,
  Hash,
  Grid3X3,
  Radar,
  GanttChart,
  Table,
  Compass,
  Box,
  Layers,
  PenIcon,
  MapIcon,
  VideoIcon,
  CalendarIcon,
  ListIcon,
  Globe,
  AlertTriangle,
  Clapperboard,
  Server,
  Activity,
  ScrollText,
  Workflow,
  ImageIcon as ImagePanelIcon,
} from "lucide-react";
import type { PanelConfig } from "@/lib/types/dashboard";

// =============================================================================
// Types
// =============================================================================

export type PanelCategory = "charts" | "stats" | "instruments" | "3d" | "other";

/**
 * Every built-in panel type. The single source of truth the compiler enforces
 * across the registry, panel-renderer's COMPONENT_MAP, and the configurator /
 * config-section dispatch maps (via `satisfies Record<KnownPanelType, …>`).
 * Stored panel JSON keeps the loose `PanelType = string` — customer configs
 * may contain types we no longer (or don't yet) know.
 */
export const PANEL_TYPES = [
  "line",
  "area",
  "bar",
  "scatter",
  "assoc-scatter",
  "heatmap",
  "stat",
  "datagrid",
  "fleet-grid",
  "fleet-table",
  "radar",
  "attitude",
  "schematic",
  "video-telemetry",
  "model3d",
  "earth",
  "satellite-info",
  "text",
  "image",
  "video",
  "map",
  "calendar",
  "list",
  "gantt",
  "alerts",
  "events",
  "event_log",
  "devices",
  "dashboard",
] as const;

export type KnownPanelType = (typeof PANEL_TYPES)[number];

/**
 * What a panel needs. Drives the editor UX:
 * - "data"    — user picks device metrics or a SQL query, always their choice.
 * - "view"    — embedded filtered view of an existing page (alerts, nested
 *               dashboards, etc.). No source picker; uses page-specific filters.
 * - "none"    — static config only (text content, video camera, model URL).
 * - "orbital" — domain-specific (TLE, flight dynamics).
 */
export type PanelSource = "data" | "view" | "none" | "orbital";

export interface PanelDefinition {
  type: KnownPanelType;
  label: string;
  /** Short description of what the panel is best for */
  description: string;
  icon: LucideIcon;
  category: PanelCategory;
  /** What data the panel needs — drives the editor source picker. */
  source: PanelSource;
  /** Whether this panel uses next/dynamic lazy loading */
  lazy?: boolean;
  /** Whether to enable SSR for lazy panels (default true) */
  ssr?: boolean;
  defaultSize: "small" | "medium" | "large";
  defaultConfig?: Partial<PanelConfig>;
  /** Extra props to pass to the component (e.g. chartType for ChartPanel) */
  defaultProps?: Record<string, unknown>;
  /** Data requirements hint shown when panel type is selected */
  dataHint?: string;
}

// =============================================================================
// Registry
// =============================================================================

const PANEL_REGISTRY = new Map<string, PanelDefinition>();

export function registerPanel(def: PanelDefinition) {
  PANEL_REGISTRY.set(def.type, def);
}

export function getPanelDefinition(type: string): PanelDefinition | undefined {
  return PANEL_REGISTRY.get(type);
}

export function getAllPanelTypes(): string[] {
  return Array.from(PANEL_REGISTRY.keys());
}

/**
 * Picker curation — the single source of truth for how the add-panel picker
 * presents types. Every registered type stays available; this only decides
 * placement. Renderers never consult it.
 * - "core"       — the default picker set (what most charts actually use)
 * - "advanced"   — shown under the collapsed "More" group; searchable as always
 * - "pack:space" — offered when the org has orbital sources (auto-detected)
 */
export type PanelVisibility = "core" | "advanced" | "pack:space";

const PANEL_VISIBILITY: Record<KnownPanelType, PanelVisibility> = {
  line: "core",
  area: "core",
  bar: "core",
  scatter: "core",
  stat: "core",
  datagrid: "core",
  list: "core",
  map: "core",
  alerts: "core",
  dashboard: "core",
  text: "advanced",
  image: "advanced",
  video: "advanced",
  "video-telemetry": "advanced",
  model3d: "advanced",
  schematic: "advanced",
  "fleet-table": "advanced",
  "fleet-grid": "advanced",
  devices: "advanced",
  events: "advanced",
  event_log: "advanced",
  heatmap: "advanced",
  radar: "advanced",
  gantt: "advanced",
  calendar: "advanced",
  "assoc-scatter": "advanced",
  earth: "pack:space",
  "satellite-info": "pack:space",
  attitude: "pack:space",
};

export function getPanelVisibility(type: string): PanelVisibility {
  return PANEL_VISIBILITY[type as KnownPanelType] ?? "advanced";
}

export interface PanelCategoryGroup {
  name: string;
  category: PanelCategory;
  types: Array<{
    value: string;
    label: string;
    description: string;
    icon: LucideIcon;
    visibility: PanelVisibility;
  }>;
}

const CATEGORY_LABELS: Record<PanelCategory, string> = {
  charts: "Charts",
  stats: "Stats & Data",
  instruments: "Instruments",
  "3d": "3D",
  other: "Other",
};

const CATEGORY_ORDER: PanelCategory[] = [
  "charts",
  "stats",
  "instruments",
  "3d",
  "other",
];

export function getPanelsByCategory(opts?: {
  /** Include pack:space types (org has orbital sources). */
  space?: boolean;
}): PanelCategoryGroup[] {
  const groups = new Map<PanelCategory, PanelCategoryGroup>();

  for (const cat of CATEGORY_ORDER) {
    groups.set(cat, {
      name: CATEGORY_LABELS[cat],
      category: cat,
      types: [],
    });
  }

  for (const def of PANEL_REGISTRY.values()) {
    const visibility = getPanelVisibility(def.type);
    if (visibility === "pack:space" && !opts?.space) continue;
    let group = groups.get(def.category);
    if (!group) {
      group = {
        name: CATEGORY_LABELS[def.category] || def.category,
        category: def.category,
        types: [],
      };
      groups.set(def.category, group);
    }
    group.types.push({
      value: def.type,
      label: def.label,
      description: def.description,
      icon: def.icon,
      visibility,
    });
  }

  return Array.from(groups.values()).filter((g) => g.types.length > 0);
}

// =============================================================================
// Register All Built-in Panels
// =============================================================================

// --- Charts ---
registerPanel({
  type: "line",
  label: "Line",
  description: "Compare metrics over time",
  icon: LineChart,
  category: "charts",
  source: "data",
  defaultSize: "medium",
  defaultProps: { chartType: "line" },
  dataHint: "X: Time (default) or any metric\nY: One or more numeric metrics",
});
registerPanel({
  type: "area",
  label: "Area",
  description: "Time series with filled regions",
  icon: AreaChart,
  category: "charts",
  source: "data",
  defaultSize: "medium",
  defaultProps: { chartType: "area" },
  dataHint: "X: Time (default) or any metric\nY: One or more numeric metrics",
});
registerPanel({
  type: "bar",
  label: "Bar",
  description: "Compare values across categories",
  icon: BarChart3,
  category: "charts",
  source: "data",
  defaultSize: "medium",
  defaultProps: { chartType: "bar" },
  dataHint: "X: Time or category\nY: Numeric values to compare",
});
registerPanel({
  type: "scatter",
  label: "Scatter",
  description: "Plot X vs Y relationships",
  icon: ScatterChart,
  category: "charts",
  source: "data",
  defaultSize: "medium",
  defaultProps: { chartType: "scatter" },
  dataHint: "X: First metric\nY: Second metric\nSelect 2+ metrics",
});
registerPanel({
  type: "assoc-scatter",
  label: "Association Scatter",
  description: "Categorical points per lane, colored & shaped by status",
  icon: Crosshair,
  category: "charts",
  source: "data",
  lazy: true,
  defaultSize: "large",
  dataHint:
    "SQL query with 3 columns:\nX (index), Y (lane/id), and a category/status column",
});
registerPanel({
  type: "heatmap",
  label: "Heatmap",
  description: "Density across two dimensions",
  icon: Grid3X3,
  category: "charts",
  source: "data",
  lazy: true,
  defaultSize: "medium",
  dataHint: "One or more numeric metrics\nValues binned by time and magnitude",
});
// --- Stats & Data ---
registerPanel({
  type: "stat",
  label: "Stat",
  description: "Single value at a glance",
  icon: Hash,
  category: "stats",
  source: "data",
  defaultSize: "small",
  dataHint: "One metric — shows latest, avg, min, or max",
});
registerPanel({
  type: "datagrid",
  label: "Table",
  description: "Raw data in rows and columns",
  icon: Table,
  category: "stats",
  source: "data",
  defaultSize: "large",
  dataHint: "Any metrics or SQL query results\nDisplays as a sortable table",
});
registerPanel({
  type: "fleet-grid",
  label: "Fleet Grid",
  description: "Linear-style cards, one per row",
  icon: Grid3X3,
  category: "stats",
  source: "data",
  defaultSize: "large",
  dataHint:
    "Connection query with one row per entity. Auto-detected columns:\n  title: name | slug | id\n  subtitle: farm | site | region | location\n  state: state | status\n  metric: soc | battery | progress (0-100)\n  severity: severity | alert_severity\n  timestamp: last_seen | updated_at\n\nOverride with panel config keys (titleColumn, subtitleColumn, …).",
});
registerPanel({
  type: "fleet-table",
  label: "Fleet Table",
  description: "One row per device, live metric columns, drill-in on click",
  icon: Table,
  category: "stats",
  source: "data",
  defaultSize: "large",
  dataHint:
    "Pure realtime (no SQL). panel.sources = device slugs (rows). panel.config.columns = metric columns with optional warnAbove / critAbove / warnBelow / critBelow thresholds. Row order: worst severity first.",
});
// --- Instruments ---
registerPanel({
  type: "radar",
  label: "Radar",
  description: "Multi-axis comparison",
  icon: Radar,
  category: "instruments",
  source: "data",
  lazy: true,
  defaultSize: "medium",
  dataHint: "3+ metrics plotted on radial axes",
});
registerPanel({
  type: "attitude",
  label: "Attitude",
  description: "Roll, pitch, yaw orientation",
  icon: Compass,
  category: "instruments",
  source: "data",
  defaultSize: "medium",
  dataHint: "Metrics: roll, pitch, yaw (degrees)\nOr quaternion (x, y, z, w)",
});
registerPanel({
  type: "schematic",
  label: "Schematic",
  description: "Live values pinned to a 2D SVG schematic",
  icon: Workflow,
  category: "instruments",
  source: "data",
  lazy: true,
  ssr: false,
  defaultSize: "large",
  defaultConfig: {
    schematicShowLabels: true,
    schematicShowConnectors: true,
    schematicBackgroundOpacity: 1,
  },
  dataHint:
    "Upload an SVG (P&ID, electrical, block diagram). Drop pins on the schematic and bind each to a metric. Auto-detect tries to match SVG <text> labels to your device metrics.",
});
registerPanel({
  type: "video-telemetry",
  label: "Video + Telemetry",
  description: "Live camera feed with metric overlay",
  icon: Clapperboard,
  category: "instruments",
  source: "data",
  lazy: true,
  defaultSize: "large",
  dataHint:
    "Select a camera + metrics to overlay\nMetrics display as a HUD on the video",
});

// --- 3D ---
registerPanel({
  type: "model3d",
  label: "3D Model",
  description: "Render GLTF/STL models",
  icon: Box,
  category: "3d",
  source: "none",
  lazy: true,
  ssr: false,
  defaultSize: "large",
  dataHint: "Model URL (GLTF, GLB, or STL)\nBind metrics to model parts",
});
registerPanel({
  type: "earth",
  label: "Earth",
  description: "Satellites and ground stations on a 3D globe",
  icon: Globe,
  category: "3d",
  source: "orbital",
  lazy: true,
  ssr: false,
  defaultSize: "large",
  dataHint:
    "Satellites: TLE line 1 + line 2 columns\nGround markers: latitude + longitude columns\nOptional: name, color, NORAD ID",
});

registerPanel({
  type: "satellite-info",
  label: "Satellite Info",
  description: "SatCat-style orbital elements, ground track, and current state",
  icon: Globe,
  category: "3d",
  source: "orbital",
  lazy: true,
  ssr: false,
  defaultSize: "large",
  dataHint: "Shows orbital elements, ground track, predictions from TLE data",
});

// --- Other ---
registerPanel({
  type: "text",
  label: "Text",
  description: "Markdown notes and documentation",
  icon: PenIcon,
  category: "other",
  source: "none",
  defaultSize: "small",
});
registerPanel({
  type: "image",
  label: "Image",
  description: "Static image — logo, photo, screenshot",
  icon: ImagePanelIcon,
  category: "other",
  source: "none",
  defaultSize: "medium",
  defaultConfig: { imageFit: "contain" },
  dataHint: "Upload PNG / JPG / WebP or paste a URL.",
});
registerPanel({
  type: "video",
  label: "Video",
  description: "Live camera feeds",
  icon: VideoIcon,
  category: "other",
  source: "none",
  lazy: true,
  defaultSize: "medium",
  dataHint: "Select a camera from a connected device",
});
registerPanel({
  type: "map",
  label: "Map",
  description: "Geographic positions on a 2D map",
  icon: MapIcon,
  category: "other",
  source: "data",
  lazy: true,
  ssr: false,
  defaultSize: "medium",
  dataHint:
    "Latitude + longitude metrics or columns\nOptional: speed, heading, altitude",
});
registerPanel({
  type: "calendar",
  label: "Calendar",
  description: "Events on a timeline",
  icon: CalendarIcon,
  category: "other",
  source: "data",
  lazy: true,
  defaultSize: "medium",
});
registerPanel({
  type: "list",
  label: "Logs",
  description: "Scrolling log lines from metrics or SQL",
  icon: ListIcon,
  category: "other",
  source: "data",
  defaultSize: "medium",
  dataHint: "Text or structured log metrics",
});
registerPanel({
  type: "gantt",
  label: "Gantt",
  description: "Task timelines and dependencies",
  icon: GanttChart,
  category: "other",
  source: "data",
  lazy: true,
  defaultSize: "large",
  dataHint: "Tasks with start time, end time, and name",
});
registerPanel({
  type: "alerts",
  label: "Alerts",
  description: "Active alert feed",
  icon: AlertTriangle,
  category: "other",
  source: "view",
  defaultSize: "medium",
});
registerPanel({
  type: "events",
  label: "Activity",
  description: "Platform activity — devices, alerts, auth, webhooks",
  icon: Activity,
  category: "other",
  source: "view",
  defaultSize: "medium",
  dataHint:
    "Audit feed of platform events (device, alert, dashboard, webhook, auth) — grouped by burst. For raw device-emitted events use Device Events.",
});
registerPanel({
  type: "event_log",
  label: "Device Events",
  description: "Raw event stream emitted by a device",
  icon: ScrollText,
  category: "other",
  source: "data",
  defaultSize: "medium",
  dataHint: "Streams events emitted by a device (class: event), e.g. faults. Select a source and optional event name filter.",
});
registerPanel({
  type: "devices",
  label: "Devices",
  description: "Filtered view of your device fleet",
  icon: Server,
  category: "other",
  source: "view",
  defaultSize: "medium",
  dataHint:
    "Shows devices from your fleet. Filter by status, device type, or search.",
});
registerPanel({
  type: "dashboard",
  label: "Dashboard",
  description: "Nested dashboard card",
  icon: Layers,
  category: "other",
  source: "view",
  defaultSize: "medium",
});
