"use client";

import { useCallback, useMemo, useState, useEffect, useRef, memo } from "react";
import GridLayout, { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Panel, DashboardConfig, TimeRange } from "@/lib/types/dashboard";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { PanelRenderer } from "@/components/dashboard/panel-renderer";
import { PanelErrorBoundary } from "@/components/dashboard/panel-error-boundary";
import { ResizeIndicator } from "@/components/dashboard/resize-indicator";

interface DashboardGridProps {
  config: DashboardConfig;
  onConfigChange: (config: DashboardConfig) => void;
  isEditing?: boolean;
  onPanelSelect?: (panelId: string) => void;
  selectedPanelId?: string | null;
  /** Called when user clicks empty grid background (for quick panel picker) */
  onEmptyClick?: (position: { x: number; y: number }) => void;
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
}: DashboardGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirstLayoutRef = useRef(true);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [resizeSize, setResizeSize] = useState<{ w: number; h: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

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
    <div ref={containerRef} className="w-full" onClick={handleBackgroundClick}>
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
            className={`relative transition-shadow ${draggingId === panel.id ? "shadow-lg z-10" : ""}`}
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
      <ResizeIndicator
        visible={!!resizeSize}
        width={resizeSize?.w ?? 0}
        height={resizeSize?.h ?? 0}
      />
    </div>
  );
}
