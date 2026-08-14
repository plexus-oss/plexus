"use client";

import {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  memo,
} from "react";
import GridLayout, { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Panel, DashboardConfig, TimeRange } from "@/lib/types/dashboard";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { PanelRenderer } from "@/components/dashboard/panel-renderer";
import { PanelErrorBoundary } from "@/components/dashboard/panel-error-boundary";
import { ResizeIndicator } from "@/components/dashboard/resize-indicator";
import {
  METRIC_DRAG_MIME,
  canAcceptMetric,
  isMetricDrag,
} from "@/lib/dashboard/metric-dnd";

interface DashboardGridProps {
  config: DashboardConfig;
  onConfigChange: (config: DashboardConfig) => void;
  isEditing?: boolean;
  onPanelSelect?: (panelId: string) => void;
  selectedPanelId?: string | null;
  /** Called when user clicks empty grid background (for quick panel picker) */
  onEmptyClick?: (position: { x: number; y: number }) => void;
  /** Signal-rail drop: append a qualified metric to a chart-family panel. */
  onMetricDrop?: (panelId: string, qualifiedMetric: string) => void;
}

const COLS = 24;
const ROW_HEIGHT = 40;

/**
 * Memoized wrapper for a single grid cell.
 * Prevents re-rendering panels whose props haven't changed.
 */
const GridCell = memo(function GridCell({
  panel,
  timeRange,
  isEditing,
  isSelected,
  onPanelSelect,
  onPanelConfigChange,
  onPanelRemove,
  hidePanelTitles,
}: {
  panel: Panel;
  timeRange: TimeRange;
  isEditing: boolean;
  isSelected: boolean;
  onPanelSelect?: (panelId: string) => void;
  onPanelConfigChange?: (
    panelId: string,
    updates: Record<string, unknown>,
  ) => void;
  onPanelRemove?: (panelId: string) => void;
  hidePanelTitles?: boolean;
}) {
  const handleEditClick = useCallback(() => {
    onPanelSelect?.(panel.id);
  }, [onPanelSelect, panel.id]);

  const handleRemove = useCallback(() => {
    onPanelRemove?.(panel.id);
  }, [onPanelRemove, panel.id]);

  const handleConfigChange = useCallback(
    (updates: Record<string, unknown>) => {
      onPanelConfigChange?.(panel.id, updates);
    },
    [onPanelConfigChange, panel.id],
  );

  return (
    <DashboardPanel
      panel={panel}
      isEditing={isEditing}
      isSelected={isSelected}
      onEditClick={handleEditClick}
      onRemove={handleRemove}
      hidePanelTitle={hidePanelTitles}
    >
      <PanelErrorBoundary panelId={panel.id} panelType={panel.type}>
        <PanelRenderer
          panel={panel}
          timeRange={timeRange}
          isEditing={isEditing}
          onConfigChange={handleConfigChange}
        />
      </PanelErrorBoundary>
    </DashboardPanel>
  );
});

export function DashboardGrid({
  config,
  onConfigChange,
  isEditing = false,
  onPanelSelect,
  selectedPanelId,
  onEmptyClick,
  onMetricDrop,
}: DashboardGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirstLayoutRef = useRef(true);
  // null until measured — RGL positions items in absolute pixels from this
  // width, so laying out at a guessed 1200 inside a narrower container spills
  // panels past the right edge on first paint. Measure before painting.
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  // Synchronous first measure, before the browser paints the grid.
  useLayoutEffect(() => {
    if (containerRef.current) {
      setContainerWidth(Math.round(containerRef.current.clientWidth));
    }
  }, []);
  const [resizeSize, setResizeSize] = useState<{ w: number; h: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Panel currently hovered by a signal-rail metric drag (drop highlight).
  const [metricDropTargetId, setMetricDropTargetId] = useState<string | null>(
    null,
  );

  // Track container width for responsive layout
  useEffect(() => {
    if (!containerRef.current) return;

    let rafId: number;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const w = Math.round(entry.contentRect.width);
          setContainerWidth((prev) => (prev === w ? prev : w));
        });
      }
    });

    observer.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);
  // Convert panels to react-grid-layout format
  const layout: Layout[] = useMemo(
    () =>
      config.panels.map((panel) => ({
        i: panel.id,
        x: panel.layout.x,
        y: panel.layout.y,
        w: panel.layout.w,
        h: panel.layout.h,
        minW: panel.layout.minW || 2,
        minH: panel.layout.minH || 2,
      })),
    [config.panels],
  );

  // Handle layout changes from drag/resize
  const handleLayoutChange = useCallback(
    (newLayout: Layout[]) => {
      // react-grid-layout fires onLayoutChange on mount for layout compaction — skip it
      if (isFirstLayoutRef.current) {
        isFirstLayoutRef.current = false;
        return;
      }
      if (!isEditing) return;

      let hasChanges = false;
      const updatedPanels = config.panels.map((panel) => {
        const layoutItem = newLayout.find((l) => l.i === panel.id);
        if (layoutItem) {
          const { x, y, w, h } = panel.layout;
          if (
            x === layoutItem.x &&
            y === layoutItem.y &&
            w === layoutItem.w &&
            h === layoutItem.h
          ) {
            return panel;
          }
          hasChanges = true;
          return {
            ...panel,
            layout: {
              x: layoutItem.x,
              y: layoutItem.y,
              w: layoutItem.w,
              h: layoutItem.h,
              minW: layoutItem.minW,
              minH: layoutItem.minH,
            },
          };
        }
        return panel;
      });

      if (!hasChanges) return;
      onConfigChange({ ...config, panels: updatedPanels });
    },
    [config, onConfigChange, isEditing],
  );

  // Stable margin/padding arrays so GridLayout doesn't see new refs each render
  const margin = useMemo<[number, number]>(() => [6, 6], []);
  const containerPadding = useMemo<[number, number]>(() => [0, 0], []);

  const handleResize = useCallback(
    (_layout: Layout[], _oldItem: Layout, newItem: Layout) => {
      setResizeSize({ w: newItem.w, h: newItem.h });
    },
    [],
  );

  const handleResizeStop = useCallback(() => {
    setResizeSize(null);
  }, []);

  const handleDragStart = useCallback(
    (_layout: Layout[], _oldItem: Layout, newItem: Layout) => {
      setDraggingId(newItem.i);
    },
    [],
  );

  const handleDragStop = useCallback(() => {
    setDraggingId(null);
  }, []);

  const handlePanelConfigChange = useCallback(
    (panelId: string, updates: Record<string, unknown>) => {
      const updatedPanels = config.panels.map((p) =>
        p.id === panelId ? { ...p, config: { ...p.config, ...updates } } : p,
      );
      onConfigChange({ ...config, panels: updatedPanels });
    },
    [config, onConfigChange],
  );

  const handlePanelRemove = useCallback(
    (panelId: string) => {
      onConfigChange({
        ...config,
        panels: config.panels.filter((p) => p.id !== panelId),
      });
    },
    [config, onConfigChange],
  );

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only fire if clicking directly on the grid container, not a panel
      if (e.target === e.currentTarget && isEditing && onEmptyClick) {
        onEmptyClick({ x: e.clientX, y: e.clientY });
      }
    },
    [isEditing, onEmptyClick],
  );

  if (config.panels.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="w-full overflow-x-hidden"
      onClick={handleBackgroundClick}
    >
      {containerWidth === null ? null : (
      <GridLayout
        className="layout"
        layout={layout}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        width={containerWidth}
        isDraggable={isEditing}
        isResizable={isEditing}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".panel-drag-handle"
        margin={margin}
        containerPadding={containerPadding}
        compactType="vertical"
        onResize={handleResize}
        onResizeStop={handleResizeStop}
        onDragStart={handleDragStart}
        onDragStop={handleDragStop}
      >
        {config.panels.map((panel) => (
          <div
            key={panel.id}
            className={`relative transition-shadow ${draggingId === panel.id ? "shadow-lg z-10" : ""} ${metricDropTargetId === panel.id ? "rounded-md ring-2 ring-inset ring-primary/60" : ""}`}
            // Signal-rail metric drop target. Native HTML5 DnD only — the
            // grid's own panel rearrange is mouse-event based (react-grid-
            // layout via .panel-drag-handle) and never emits drag events, so
            // these handlers cannot interfere with it. stopPropagation keeps
            // the page-level empty-space drop zone from lighting up while a
            // panel is hovered.
            onDragOver={
              onMetricDrop
                ? (e) => {
                    if (!isMetricDrag(e.dataTransfer)) return;
                    e.stopPropagation();
                    if (!canAcceptMetric(panel)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setMetricDropTargetId((prev) =>
                      prev === panel.id ? prev : panel.id,
                    );
                  }
                : undefined
            }
            onDragLeave={
              onMetricDrop
                ? (e) => {
                    // Ignore moves between the cell's own children.
                    if (
                      e.relatedTarget instanceof Node &&
                      e.currentTarget.contains(e.relatedTarget)
                    )
                      return;
                    setMetricDropTargetId((prev) =>
                      prev === panel.id ? null : prev,
                    );
                  }
                : undefined
            }
            onDrop={
              onMetricDrop
                ? (e) => {
                    if (!isMetricDrag(e.dataTransfer)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setMetricDropTargetId(null);
                    const metric = e.dataTransfer.getData(METRIC_DRAG_MIME);
                    if (metric && canAcceptMetric(panel)) {
                      onMetricDrop(panel.id, metric);
                    }
                  }
                : undefined
            }
          >
            <GridCell
              panel={panel}
              timeRange={config.timeRange}
              isEditing={isEditing}
              isSelected={selectedPanelId === panel.id}
              onPanelSelect={onPanelSelect}
              onPanelConfigChange={handlePanelConfigChange}
              onPanelRemove={handlePanelRemove}
              hidePanelTitles={config.displaySettings?.hidePanelTitles}
            />
          </div>
        ))}
      </GridLayout>
      )}
      <ResizeIndicator
        visible={!!resizeSize}
        width={resizeSize?.w ?? 0}
        height={resizeSize?.h ?? 0}
      />
    </div>
  );
}
