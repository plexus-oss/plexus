"use client";

import { useMemo, useCallback, useRef, useState } from "react";
import { GanttChart } from "@/components/ui/charts/gantt";
import { usePanelData } from "@/hooks/use-panel-data";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import { PanelFilterBar } from "@/components/dashboard/panels/panel-filter-bar";
import { useAnnotationMode } from "@/hooks/use-annotation-mode";
import {
  AnnotationToolbar,
  AnnotationModeIndicator,
} from "@/components/annotations/annotation-toolbar";
import { AnnotationPopover } from "@/components/annotations/annotation-popover";
import { AnnotationsPanel } from "@/components/annotations/annotations-panel";
import { cn } from "@/lib/utils";

interface GanttPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

interface GanttTask {
  id: string;
  name: string;
  start: Date;
  end: Date;
  status?: "planned" | "in-progress" | "completed";
  color?: string;
}

/**
 * Gantt Timeline panel for scheduling and event visualization
 * Supports realtime, table, and connection data sources
 */
export function GanttPanel({ panel, timeRange }: GanttPanelProps) {
  const { data, isLoading, error, sourceType, connectionMeta, refresh } =
    usePanelData({
      panel,
      timeRange,
    });

  const sourceId = panel.config.sourceId || panel.sources?.[0] || null;
  const ann = useAnnotationMode({ sourceId, enabled: !!sourceId });
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // "Now" reference for task status, captured once (render must stay pure).
  const [nowMs] = useState(() => Date.now());

  // Transform data → tasks AND compute time domain in one pass.
  // Previously the time domain was a second useMemo that iterated tasks again,
  // and it was declared after early returns (rules-of-hooks violation).
  const { tasks, timeDomain } = useMemo<{
    tasks: GanttTask[];
    timeDomain: { minTime: number; maxTime: number };
  }>(() => {
    const empty = { tasks: [] as GanttTask[], timeDomain: { minTime: 0, maxTime: 0 } };
    if (!data) return empty;

    const taskList: GanttTask[] = [];
    let minTime = Infinity;
    let maxTime = -Infinity;
    const track = (s: Date, e: Date) => {
      const sm = s.getTime();
      const em = e.getTime();
      if (sm < minTime) minTime = sm;
      if (em > maxTime) maxTime = em;
    };

    // For connection sources, try to parse structured data with start/end columns
    if (sourceType === "connection") {
      // Check if we have rows with start/end-like columns
      const allKeys = Object.keys(data);

      // Try to find start/end column pairs
      const startKey = allKeys.find((k) =>
        /^(start|begin|start_time|started_at)$/i.test(k),
      );
      const endKey = allKeys.find((k) =>
        /^(end|finish|end_time|ended_at|completed_at)$/i.test(k),
      );
      const nameKey = allKeys.find((k) =>
        /^(name|title|task|label|description)$/i.test(k),
      );

      if (startKey && endKey) {
        const startData = data[startKey] || [];
        const endData = data[endKey] || [];
        const nameData = nameKey ? data[nameKey] || [] : [];

        for (let i = 0; i < startData.length; i++) {
          const startPoint = startData[i];
          const endPoint = endData[i];
          if (!startPoint || !endPoint) continue;

          const startDate = new Date(
            startPoint.timestamp || String(startPoint.value),
          );
          const endDate = new Date(
            endPoint.timestamp || String(endPoint.value),
          );
          if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) continue;

          const name = nameData[i]
            ? String(nameData[i].value)
            : `Task ${i + 1}`;
          const sMs = startDate.getTime();
          const eMs = endDate.getTime();
          const isInFuture = sMs > nowMs;
          const isInProgress = sMs <= nowMs && eMs >= nowMs;

          taskList.push({
            id: `task-${i}`,
            name,
            start: startDate,
            end: endDate,
            status: isInFuture
              ? "planned"
              : isInProgress
                ? "in-progress"
                : "completed",
          });
          track(startDate, endDate);
        }

        if (taskList.length > 0)
          return { tasks: taskList, timeDomain: { minTime, maxTime } };
      }
    }

    // Fallback: interpret time-series data as active periods
    // Group continuous non-zero values as "active" periods
    const metricsToProcess = panel.metrics || Object.keys(data);

    for (const metric of metricsToProcess) {
      // For demo metrics, look for schedule data first
      const scheduleKey = `${metric}:schedule`;
      let metricData = data[scheduleKey] || data[metric] || [];
      // If not found, search data keys for a match (handles qualified keys)
      if (metricData.length === 0) {
        const matchKey = Object.keys(data).find(
          (k) =>
            (k === metric || k.endsWith(`:${metric}`)) && data[k]?.length > 0,
        );
        if (matchKey) metricData = data[matchKey];
      }
      if (metricData.length === 0) continue;
      const displayName = metric.includes(":")
        ? metric.split(":").slice(1).join(":")
        : metric;
      const metricColors = panel.config.metricColors as
        | Record<string, string>
        | undefined;
      const taskColor = metricColors?.[metric] || metricColors?.[displayName];

      let currentTask: { start: Date; end: Date } | null = null;

      for (let i = 0; i < metricData.length; i++) {
        const point = metricData[i];
        const isActive = typeof point.value === "number" && point.value > 0;
        const timestamp = new Date(point.timestamp);

        if (isActive && !currentTask) {
          currentTask = { start: timestamp, end: timestamp };
        } else if (isActive && currentTask) {
          currentTask.end = timestamp;
        } else if (!isActive && currentTask) {
          const sMs = currentTask.start.getTime();
          const eMs = currentTask.end.getTime();
          const isInFuture = sMs > nowMs;
          const isInProgress = sMs <= nowMs && eMs >= nowMs;

          taskList.push({
            id: `${metric}-${taskList.length}`,
            name: displayName,
            start: currentTask.start,
            end: currentTask.end,
            color: taskColor,
            status: isInFuture
              ? "planned"
              : isInProgress
                ? "in-progress"
                : "completed",
          });
          track(currentTask.start, currentTask.end);
          currentTask = null;
        }
      }

      if (currentTask) {
        const sMs = currentTask.start.getTime();
        const eMs = currentTask.end.getTime();
        const isInFuture = sMs > nowMs;
        const isInProgress = sMs <= nowMs && eMs >= nowMs;

        taskList.push({
          id: `${metric}-${taskList.length}`,
          name: displayName,
          start: currentTask.start,
          end: currentTask.end,
          color: taskColor,
          status: isInFuture
            ? "planned"
            : isInProgress
              ? "in-progress"
              : "completed",
        });
        track(currentTask.start, currentTask.end);
      }
    }

    return {
      tasks: taskList,
      timeDomain:
        taskList.length > 0 ? { minTime, maxTime } : { minTime: 0, maxTime: 0 },
    };
  }, [data, panel.metrics, panel.config.metricColors, sourceType, nowMs]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => t.name.toLowerCase().includes(q));
  }, [tasks, searchQuery]);

  const statusCounts = useMemo(() => {
    let active = 0;
    let planned = 0;
    let done = 0;
    for (const t of filteredTasks) {
      if (t.status === "in-progress") active++;
      else if (t.status === "planned") planned++;
      else done++;
    }
    return { active, planned, done };
  }, [filteredTasks]);

  const handleChartClick = useCallback(
    (e: React.MouseEvent) => {
      if (ann.mode === "off" || !chartContainerRef.current) return;
      if (timeDomain.minTime === 0 && timeDomain.maxTime === 0) return;

      const rect = chartContainerRef.current.getBoundingClientRect();
      const leftPanel = 120;
      const innerWidth = rect.width - leftPanel;
      const chartX = e.clientX - rect.left - leftPanel;
      if (chartX < 0 || chartX > innerWidth) return;

      const fraction = chartX / innerWidth;
      const timestamp = new Date(
        timeDomain.minTime +
          fraction * (timeDomain.maxTime - timeDomain.minTime),
      ).toISOString();

      ann.openPopover(e.clientX, e.clientY, timestamp);
    },
    [ann, timeDomain],
  );

  if (isLoading && tasks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <PanelEmptyState
        reason="query_error"
        debugInfo={{
          sourceType,
          errorMessage: error instanceof Error ? error.message : String(error),
        }}
        onRetry={refresh}
      />
    );
  }

  if (tasks.length === 0) {
    return (
      <PanelEmptyState
        reason="no_data"
        debugInfo={{
          sourceType,
          rowCount: connectionMeta?.rowCount || 0,
          columns: connectionMeta?.columns?.map((c) => c.name),
        }}
        onRetry={refresh}
      />
    );
  }

  return (
    <>
      <div className="h-full w-full flex flex-col overflow-hidden bg-background">
        <PanelFilterBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Filter tasks"
          count={filteredTasks.length}
          total={tasks.length}
        />
        <div
          ref={chartContainerRef}
          className={cn(
            "flex-1 min-h-0 relative",
            ann.mode === "on" ? "cursor-cell" : "",
          )}
          onClick={handleChartClick}
        >
          <GanttChart
            tasks={filteredTasks}
            timeWindowHours={panel.config.timeWindowHours || 12}
            timezone={panel.config.timezone as string | undefined}
            leftPanelHeader={
              (panel.config.leftPanelHeader as string) || undefined
            }
            variant="compact"
            rowHeight={28}
          />
          <AnnotationModeIndicator
            mode={ann.mode}
            onClose={() => ann.setMode("off")}
          />
        </div>
        <div className="shrink-0 flex items-center justify-between px-2.5 h-9 border-t border-border/40">
          <AnnotationToolbar
            mode={ann.mode}
            setMode={ann.setMode}
            annotationCount={ann.annotations.length}
            onShowPanel={() => ann.setShowPanel(true)}
          />
          <div className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground/70">
            <span className="inline-flex items-center gap-1">
              <span className="h-1 w-1 rounded-full bg-emerald-500/80" />
              <span className="text-foreground/80">{statusCounts.active}</span>
              <span className="text-muted-foreground/50">active</span>
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1 w-1 rounded-full bg-amber-500/80" />
              <span className="text-foreground/80">{statusCounts.planned}</span>
              <span className="text-muted-foreground/50">planned</span>
            </span>
            <span className="text-muted-foreground/30">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
              <span className="text-foreground/80">{statusCounts.done}</span>
              <span className="text-muted-foreground/50">done</span>
            </span>
          </div>
        </div>
      </div>

      {ann.popover && (
        <AnnotationPopover
          x={ann.popover.x}
          y={ann.popover.y}
          initialLabel={ann.popover.initialLabel}
          initialColor={ann.popover.initialColor}
          initialNotes={ann.popover.initialNotes}
          timestamp={ann.popover.timestamp}
          timestampEnd={ann.popover.timestampEnd}
          showDelete={!!ann.popover.editingId}
          onSave={ann.handleSave}
          onDelete={ann.handleDelete}
          onDismiss={ann.closePopover}
        />
      )}

      <AnnotationsPanel
        open={ann.showPanel}
        onOpenChange={ann.setShowPanel}
        annotations={ann.annotations}
        onEdit={ann.handlePanelEdit}
        onDelete={(id) => ann.deleteAnnotation(id)}
      />
    </>
  );
}
