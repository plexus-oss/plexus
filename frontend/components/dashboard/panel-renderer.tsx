"use client";

import { memo, type ComponentType } from "react";
import dynamic from "next/dynamic";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { getPanelDefinition, type KnownPanelType } from "@/lib/panels/registry";
import { Spinner } from "@/components/ui/spinner";
import { usePanelRestricted } from "@/hooks/use-panel-restricted";
import { PanelRestrictedState } from "./panels/restricted-state";

// Loading placeholder for lazy-loaded panels
const PanelLoader = () => (
  <div className="h-full flex items-center justify-center">
    <Spinner className="h-5 w-5" />
  </div>
);

// =============================================================================
// Component Map
//
// Maps panel type -> React component. Eager-loaded panels are imported directly;
// heavy panels use next/dynamic for code splitting. Adding a new panel =
// one entry here + one in lib/panels/registry.ts.
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPanelComponent = ComponentType<any>;

// Lightweight panels - import directly
import { ChartPanel } from "./panels/chart-panel";
import { StatPanel } from "./panels/stat-panel";
import { ListPanel } from "./panels/list-panel";
import { AlertsPanel } from "./panels/alerts-panel";
import { EventsPanel } from "./panels/events-panel";
import { EventLogPanel } from "./panels/event-log-panel";
import { DevicesPanel } from "./panels/devices-panel";
import { FleetTablePanel } from "./panels/fleet-table-panel";

// Medium-weight panels - lazy loaded
const DashboardPanel = dynamic(
  () =>
    import("./panels/dashboard-panel").then((m) => ({
      default: m.DashboardPanel,
    })),
  { loading: PanelLoader },
);
const DataGridPanel = dynamic(
  () =>
    import("./panels/datagrid-panel").then((m) => ({
      default: m.DataGridPanel,
    })),
  { loading: PanelLoader },
);

// Heavy panels - lazy loaded
const EarthPanel = dynamic(
  () => import("./panels/earth-panel").then((m) => ({ default: m.EarthPanel })),
  { loading: PanelLoader, ssr: false },
);
const SatelliteInfoPanel = dynamic(
  () =>
    import("./panels/satellite-info-panel").then((m) => ({
      default: m.SatelliteInfoPanel,
    })),
  { loading: PanelLoader, ssr: false },
);
const Model3DPanel = dynamic(
  () =>
    import("./panels/model3d-panel").then((m) => ({ default: m.Model3DPanel })),
  { loading: PanelLoader, ssr: false },
);
const VideoPanel = dynamic(
  () => import("./panels/video-panel").then((m) => ({ default: m.VideoPanel })),
  { loading: PanelLoader },
);
const GanttPanel = dynamic(
  () => import("./panels/gantt-panel").then((m) => ({ default: m.GanttPanel })),
  { loading: PanelLoader },
);
const AssocScatterPanel = dynamic(
  () =>
    import("./panels/assoc-scatter-panel").then((m) => ({
      default: m.AssocScatterPanel,
    })),
  { loading: PanelLoader },
);
// Component map — each panel has slightly different props (e.g. ChartPanel takes
// chartType, DashboardPanel omits timeRange). Using `any` here is intentional;
// the actual type safety comes from each panel component's own props interface.
// `satisfies` forces an entry for every registered panel type; the declared
// Record<string, …> keeps lookup by stored panel.type (a plain string) legal.
const COMPONENT_MAP: Record<string, AnyPanelComponent> = {
  line: ChartPanel,
  area: ChartPanel,
  bar: ChartPanel,
  scatter: ChartPanel,
  "assoc-scatter": AssocScatterPanel,
  stat: StatPanel,
  gantt: GanttPanel,
  datagrid: DataGridPanel,
  "fleet-table": FleetTablePanel,
  model3d: Model3DPanel,
  earth: EarthPanel,
  "satellite-info": SatelliteInfoPanel,
  list: ListPanel,
  alerts: AlertsPanel,
  events: EventsPanel,
  event_log: EventLogPanel,
  devices: DevicesPanel,
  dashboard: DashboardPanel,
  video: VideoPanel,
} satisfies Record<KnownPanelType, AnyPanelComponent>;

// =============================================================================
// Renderer
// =============================================================================

interface PanelRendererProps {
  panel: Panel;
  timeRange: TimeRange;
  /** True when the dashboard is in edit mode. Panels can use this to enable
   *  in-canvas authoring affordances (click-to-add pins, click-to-bind meshes). */
  isEditing?: boolean;
  /** Patches the panel's `config` JSON. Currently used only by interactive
   *  panels (Schematic, Model 3D). Other panels ignore it. */
  onConfigChange?: (updates: Record<string, unknown>) => void;
}

/**
 * Renders a dashboard panel based on its type.
 * Uses the panel registry for metadata and the component map for rendering.
 */
export const PanelRenderer = memo(function PanelRenderer({
  panel,
  timeRange,
  isEditing,
  onConfigChange,
}: PanelRendererProps) {
  const Component = COMPONENT_MAP[panel.type];
  // Scoped members get a labeled state instead of an empty/failed panel when
  // everything the panel references is outside their scope.
  const restricted = usePanelRestricted(panel);

  if (restricted) {
    return <PanelRestrictedState />;
  }

  if (!Component) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Unknown panel type: {panel.type}
      </div>
    );
  }

  // Get default props from registry (e.g. chartType for chart panels)
  const def = getPanelDefinition(panel.type);
  const extraProps = def?.defaultProps ?? {};

  return (
    <Component
      panel={panel}
      timeRange={timeRange}
      isEditing={isEditing}
      onConfigChange={onConfigChange}
      {...extraProps}
    />
  );
});
