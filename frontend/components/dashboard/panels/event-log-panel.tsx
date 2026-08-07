"use client";

/**
 * Device Events Panel (`event_log`) — raw event stream emitted by a device,
 * read from ClickHouse. Virtualized compact feed built on the shared LogRow +
 * LogPanelHeader primitives so it matches Logs / Activity / Alerts exactly.
 *
 * Source scope: the panel's own data source wins; otherwise it inherits the
 * dashboard-level source filter / variable (see resolveScopeSourceId).
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { ScrollText } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import { LogRow } from "@/components/dashboard/panels/log-row";
import { LogPanelHeader } from "@/components/dashboard/panels/log-panel-header";
import { useEventLog } from "@/hooks/use-event-log";
import {
  useDashboardFilters,
  useDashboardVariables,
} from "@/components/dashboard/dashboard-state-context";
import { resolveScopeSourceId } from "@/lib/dashboard/resolve-source-scope";
import { getPanelDataSource } from "@/lib/panels/data-source";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import type { EventLogPanelConfig } from "@/lib/types/panel-configs";
import type { LogRowChip } from "@/components/dashboard/panels/log-row";

const ROW_HEIGHT = 34;

function parseBody(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (typeof parsed === "object" && parsed !== null) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.length === 0) return "";
      return entries
        .slice(0, 3)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ");
    }
    return String(parsed);
  } catch {
    return raw;
  }
}

export function EventLogPanel({
  panel,
  timeRange: dashboardTimeRange,
}: {
  panel: Panel;
  timeRange: TimeRange;
}) {
  const config = (panel.config ?? {}) as EventLogPanelConfig;
  const { timeRange: configTimeRange, name, limit = 500, showTags = true, showBody = true } =
    config;

  // Dashboard time range takes precedence; config.timeRange is a fallback
  // for when the panel is rendered outside a dashboard context.
  const timeRange = dashboardTimeRange?.value ?? configTimeRange ?? "1h";

  // Source scope: panel's own source, else the dashboard-level source filter.
  const { filters } = useDashboardFilters();
  const { values: variableValues } = useDashboardVariables();
  const panelSourceId = getPanelDataSource(panel).sourceId ?? undefined;
  const sourceId = resolveScopeSourceId({
    panelSourceId,
    filters,
    variableValues,
  });

  const { events, isLoading, error, refresh } = useEventLog({
    timeRange,
    sourceId,
    name,
    limit,
  });

  const [search, setSearch] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  // Container height drives the virtualization window. It's needed for render,
  // so it lives in state (kept in sync via ResizeObserver + scroll) rather than
  // being read from the ref during render.
  const [containerHeight, setContainerHeight] = useState(600);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
    setContainerHeight(e.currentTarget.clientHeight);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      setContainerHeight(node.clientHeight);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return events;
    const q = search.toLowerCase();
    return events.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.body.toLowerCase().includes(q) ||
        Object.values(e.tags ?? {}).some((v) => v.toLowerCase().includes(q)),
    );
  }, [events, search]);

  if (isLoading && events.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  if (error) {
    return (
      <PanelEmptyState
        reason="query_error"
        debugInfo={{ errorMessage: error.message }}
        onRetry={refresh}
      />
    );
  }

  if (events.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center p-4">
        <ScrollText className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">No events</p>
        <p className="text-xs text-muted-foreground/70">
          No events found for this source in the selected time range
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <LogPanelHeader
        search={search}
        onSearchChange={setSearch}
        count={filtered.length}
        total={events.length}
      />

      {/* Virtualized list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto min-h-0 relative"
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
            No matches for &ldquo;{search}&rdquo;
          </div>
        ) : (
          <div style={{ height: filtered.length * ROW_HEIGHT, position: "relative" }}>
            {(() => {
              const startIdx = Math.floor(scrollTop / ROW_HEIGHT);
              const endIdx = Math.min(
                filtered.length,
                startIdx + Math.ceil(containerHeight / ROW_HEIGHT) + 2,
              );

              return filtered.slice(startIdx, endIdx).map((event, i) => {
                const actualIdx = startIdx + i;
                const bodyText = showBody ? parseBody(event.body) : "";
                const chips: LogRowChip[] = showTags
                  ? Object.entries(event.tags ?? {})
                      .slice(0, 2)
                      .map(([k, v]) => ({ key: k, value: v }))
                  : [];

                return (
                  <LogRow
                    key={`${event.source_id}-${event.timestamp}-${event.name}`}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: actualIdx * ROW_HEIGHT,
                      height: ROW_HEIGHT,
                    }}
                    dotClassName="bg-muted-foreground/30"
                    title={event.name}
                    titleMono
                    description={bodyText || undefined}
                    chips={chips}
                    timestamp={event.timestamp}
                    hoverTitle={event.body}
                  />
                );
              });
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
