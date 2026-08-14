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

// ── First-drop teaching hint ──
// The signal rail shows a one-line drag hint until the user's first
// successful metric drop, then never again. A miniature localStorage-backed
// external store (same pattern as the rail's open state) so the rail can
// read it via useSyncExternalStore and hide the hint live when a drop lands.
const METRIC_DROPPED_KEY = "plexus.signal-rail.metric-dropped";
const dropListeners = new Set<() => void>();

/** True once any signal-rail drag has successfully landed (per browser). */
export function hasDroppedMetric(): boolean {
  try {
    return localStorage.getItem(METRIC_DROPPED_KEY) === "1";
  } catch {
    // No storage → treat as seen so the hint never nags persistently.
    return true;
  }
}

/** Called by the drop handlers on a successful drop — hides the hint forever. */
export function markMetricDropped(): void {
  try {
    localStorage.setItem(METRIC_DROPPED_KEY, "1");
  } catch {
    // best-effort persistence
  }
  for (const l of dropListeners) l();
}

export function subscribeMetricDropped(cb: () => void): () => void {
  dropListeners.add(cb);
  return () => {
    dropListeners.delete(cb);
  };
}
