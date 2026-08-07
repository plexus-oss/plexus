"use client";

import type { ComponentType } from "react";
import type { PanelType } from "@/lib/types/dashboard";
import type { KnownPanelType } from "@/lib/panels/registry";

// Per-type config components
import { LineConfig } from "./line-config";
import { BarConfig } from "./bar-config";
import { ScatterConfig } from "./scatter-config";
import { AssocScatterConfig } from "./assoc-scatter-config";
import { StatConfig } from "./stat-config";
import { HeatmapConfig } from "./heatmap-config";
import { RadarConfig } from "./radar-config";
import { GanttConfig } from "./gantt-config";
import { TextConfig } from "./text-config";
import { VideoConfig } from "./video-config";
import { VideoTelemetryConfig } from "./video-telemetry-config";
import { MapConfig } from "./map-config";
import { CalendarConfig } from "./calendar-config";
import { ListConfig } from "./list-config";
import { DashboardPanelConfig } from "./dashboard-panel-config";
import { EarthConfig } from "./earth-config";
import { SatelliteInfoConfig } from "./satellite-info-config";
import { Model3DConfig } from "./model3d-config";
import { AlertsConfig } from "./alerts-config";
import { EventsConfig } from "./events-config";
import { SchematicConfig } from "./schematic-config";
import { ImageConfig } from "./image-config";

interface ConfigSectionProps {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

/**
 * Maps panel type → config component.
 * Every panel type with configurable options is listed here.
 * Types not listed (e.g. attitude, datagrid) auto-configure from metrics.
 */
// Legitimately partial — types not listed have no type-specific config.
// `satisfies` still kills typo'd keys.
const CONFIG_COMPONENTS: Partial<
  Record<string, ComponentType<ConfigSectionProps>>
> = {
  line: LineConfig,
  area: LineConfig,
  bar: BarConfig,
  scatter: ScatterConfig,
  "assoc-scatter": AssocScatterConfig,
  stat: StatConfig,
  heatmap: HeatmapConfig,
  radar: RadarConfig,
  gantt: GanttConfig,
  text: TextConfig,
  video: VideoConfig,
  "video-telemetry": VideoTelemetryConfig,
  map: MapConfig,
  calendar: CalendarConfig,
  list: ListConfig,
  alerts: AlertsConfig,
  events: EventsConfig,
  dashboard: DashboardPanelConfig,
  earth: EarthConfig,
  "satellite-info": SatelliteInfoConfig,
  model3d: Model3DConfig,
  schematic: SchematicConfig,
  image: ImageConfig,
} satisfies Partial<Record<KnownPanelType, ComponentType<ConfigSectionProps>>>;

interface PanelConfigSectionProps {
  type: PanelType;
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

/**
 * Dispatches to the per-type config section component.
 * Returns null for panel types with no type-specific config.
 */
export function PanelConfigSection({
  type,
  config,
  onChange,
  metrics,
}: PanelConfigSectionProps) {
  const Component = CONFIG_COMPONENTS[type];
  if (!Component) return null;
  return <Component config={config} onChange={onChange} metrics={metrics} />;
}
