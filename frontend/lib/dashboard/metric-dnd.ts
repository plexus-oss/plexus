import type { Panel } from "@/lib/types/dashboard";

/**
 * Shared contract for dragging a metric out of the signal rail onto the
 * dashboard. HTML5 drag-and-drop is deliberate here: the grid's panel
 * rearrange (react-grid-layout) is mouse-event based and only starts from
 * `.panel-drag-handle`, so a native drag can never trigger it — and the
 * browser suppresses mouse events during a native drag, so the two systems
 * cannot collide.
 */
export const METRIC_DRAG_MIME = "application/x-plexus-metric";

/** Panel types whose metrics list feeds the chart-family renderer. */
export const CHART_FAMILY_TYPES = new Set(["line", "area", "bar", "scatter"]);

/** True while the dragged payload is a signal-rail metric. */
export function isMetricDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(METRIC_DRAG_MIME);
}

/**
 * True when dropping a qualified realtime metric onto this panel is
 * meaningful: chart-family panels driven by `panel.metrics`. Connection-query
 * panels chart SQL results — a realtime metric has nowhere to go there.
 */
export function canAcceptMetric(panel: Panel): boolean {
  return (
    CHART_FAMILY_TYPES.has(panel.type) &&
    panel.dataSource?.type !== "connection"
  );
}
