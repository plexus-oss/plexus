"use client";

/**
 * Configurator dispatcher.
 *
 * Maps panel type → the right-pane component shown in the Add Panel
 * modal. Mirrors the pattern used by `panel-renderer.tsx` and
 * `config-sections/index.tsx`.
 *
 * The generic data-driven family shares DataConfigurator — the same
 * SourcePicker + ConnectionDataEditor pair as the edit sidebar's Data
 * section (one grammar). Shape-aware configurators (named metric slots,
 * uploads, camera pickers) stay specialized.
 */

import type { ComponentType } from "react";
import type { KnownPanelType } from "@/lib/panels/registry";
import type { TimeRange } from "@/lib/types/dashboard";
import { DataConfigurator } from "./data-configurator";
import { SchematicConfigurator } from "./schematic-configurator";
import { Model3DConfigurator } from "./model3d-configurator";
import { ImageConfigurator } from "./image-configurator";
import { TextConfigurator } from "./text-configurator";
import { VideoConfigurator } from "./video-configurator";
import { PassthroughConfigurator } from "./passthrough-configurator";
import { DashboardConfigurator } from "./dashboard-configurator";
import { HeatmapConfigurator } from "./heatmap-configurator";
import { RadarConfigurator } from "./radar-configurator";
import { AttitudeConfigurator } from "./attitude-configurator";
import { FleetConfigurator } from "./fleet-configurator";
import { MapConfigurator } from "./map-configurator";
import { EventLogConfigurator } from "./event-log-configurator";
import type { ConfiguratorProps } from "./types";

// `satisfies` forces an entry for every registered panel type; the declared
// Record<string, …> keeps lookup by draft.type (a plain string) legal.
const CONFIGURATORS: Record<string, ComponentType<ConfiguratorProps>> = {
  // Generic data family — realtime metrics or a connection, same as the
  // sidebar's Data section (datagrid/assoc-scatter bind raw tables).
  stat: DataConfigurator,
  line: DataConfigurator,
  area: DataConfigurator,
  bar: DataConfigurator,
  scatter: DataConfigurator,
  gantt: DataConfigurator,
  calendar: DataConfigurator,
  list: DataConfigurator,
  datagrid: DataConfigurator,
  "assoc-scatter": DataConfigurator,

  // Named slots / single-source multi-metric
  heatmap: HeatmapConfigurator,
  radar: RadarConfigurator,
  attitude: AttitudeConfigurator,

  // Fleet-scoped (device list is the primary binding)
  "fleet-grid": FleetConfigurator,
  "fleet-table": FleetConfigurator,
  map: MapConfigurator,

  // Media
  schematic: SchematicConfigurator,
  model3d: Model3DConfigurator,
  image: ImageConfigurator,
  text: TextConfigurator,
  video: VideoConfigurator,
  "video-telemetry": VideoConfigurator,

  // Nested
  dashboard: DashboardConfigurator,

  // Device event log
  event_log: EventLogConfigurator,

  // Views & special (passthrough — sidebar handles further config)
  alerts: PassthroughConfigurator,
  events: PassthroughConfigurator,
  devices: PassthroughConfigurator,
  earth: PassthroughConfigurator,
  "satellite-info": PassthroughConfigurator,
} satisfies Record<KnownPanelType, ComponentType<ConfiguratorProps>>;

export function PanelConfigurator(
  props: ConfiguratorProps & { timeRange?: TimeRange },
) {
  const Component = CONFIGURATORS[props.draft.type] ?? PassthroughConfigurator;
  return <Component {...props} />;
}

export type { ConfiguratorProps, PanelDraft } from "./types";
