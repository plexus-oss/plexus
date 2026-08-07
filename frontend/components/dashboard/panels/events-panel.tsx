"use client";

/**
 * Activity Panel (`events`) — platform activity feed backed by SystemEvent
 * (devices coming online, alerts, dashboard edits, auth, webhooks).
 *
 * Built on the shared LogRow + LogPanelHeader primitives so it shares the exact
 * compact rhythm of Logs / Device Events / Alerts. Bursts from the same source
 * are grouped (groupEvents) into an expandable row. The full-page /events view
 * keeps its own roomier EventGroupCard layout — only the dashboard panel uses
 * this dense feed.
 *
 * Scope: inherits the dashboard-level source filter / variable unless the panel
 * sets its own sourceId. (Like Alerts, this is a latest-N activity feed, so it
 * is scoped by source rather than time-windowed.)
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, ChevronDown } from "lucide-react";
import { useSystemEvents } from "@/hooks/use-system-events";
import { groupEvents, type EventGroup } from "@/lib/events/group-events";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import { LogRow } from "@/components/dashboard/panels/log-row";
import { LogPanelHeader } from "@/components/dashboard/panels/log-panel-header";
import {
  useDashboardFilters,
  useDashboardVariables,
} from "@/components/dashboard/dashboard-state-context";
import { resolveScopeSourceId } from "@/lib/dashboard/resolve-source-scope";
import { cn } from "@/lib/utils";
import type { Panel } from "@/lib/types/dashboard";
import type { SystemEvent } from "@/lib/db/types";

interface EventsPanelProps {
  panel: Panel;
}

interface EventsPanelConfig {
  sourceId?: string;
  severity?: "critical" | "warning" | "success" | "info";
  category?: string;
  eventType?: string;
  search?: string;
  maxItems?: number;
  grouped?: boolean;
  showSourceName?: boolean;
  showJumpLink?: boolean;
}

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  success: "bg-emerald-500",
  info: "bg-muted-foreground/40",
};

function dotFor(severity: string): string {
  return SEVERITY_DOT[severity] ?? "bg-muted-foreground/40";
}

function sourceLabel(e: Pick<SystemEvent, "source_name" | "source_slug">) {
  return e.source_name ?? e.source_slug ?? null;
}

/** A single event renders as one LogRow; a burst renders as an expandable row. */
function GroupRow({ group }: { group: EventGroup }) {
  const [expanded, setExpanded] = useState(false);
  const first = group.events[0];

  if (group.events.length === 1) {
    const label = sourceLabel(first);
    return (
      <LogRow
        dotClassName={dotFor(first.severity)}
        title={first.title}
        chips={label ? [{ key: label }] : undefined}
        timestamp={first.created_at}
      />
    );
  }

  const label = group.sourceName ?? group.sourceSlug;
  return (
    <div>
      <LogRow
        dotClassName={dotFor(group.severity)}
        title={`${group.events.length} events`}
        chips={label ? [{ key: label }] : undefined}
        timestamp={group.timeRange.start}
        onClick={() => setExpanded((v) => !v)}
        trailing={
          <ChevronDown
            className={cn(
              "h-3 w-3 text-muted-foreground/60 shrink-0 transition-transform",
              expanded && "rotate-180",
            )}
          />
        }
      />
      {expanded && (
        <div className="ml-[18px] border-l border-border/60">
          {group.events.map((e) => (
            <LogRow
              key={e.id}
              dotClassName={dotFor(e.severity)}
              title={e.title}
              timestamp={e.created_at}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function EventsPanel({ panel }: EventsPanelProps) {
  const config = (panel.config || {}) as EventsPanelConfig;
  const {
    sourceId: configSourceId,
    severity,
    category,
    eventType,
    search: configSearch,
    maxItems = 50,
    grouped = true,
    showJumpLink = true,
  } = config;

  // Inherit dashboard source + time scope unless the panel sets its own.
  const { filters } = useDashboardFilters();
  const { values: variableValues } = useDashboardVariables();
  const sourceId = resolveScopeSourceId({
    panelSourceId: configSourceId,
    filters,
    variableValues,
  });

  const { events, isLoading, error, refresh } = useSystemEvents({
    sourceId,
    severity,
    category,
    type: eventType,
    search: configSearch,
    limit: maxItems,
  });

  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return events;
    const q = search.toLowerCase();
    return events.filter(
      (e) =>
        e.title?.toLowerCase().includes(q) ||
        e.event_type?.toLowerCase().includes(q) ||
        (sourceLabel(e) ?? "").toLowerCase().includes(q),
    );
  }, [events, search]);

  const groups = useMemo(
    () => (grouped ? groupEvents(filtered) : null),
    [filtered, grouped],
  );

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (sourceId) params.set("sourceId", sourceId);
    if (severity) params.set("severity", severity);
    if (category) params.set("category", category);
    if (eventType) params.set("type", eventType);
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [sourceId, severity, category, eventType]);

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
        debugInfo={{
          errorMessage: error instanceof Error ? error.message : String(error),
        }}
        onRetry={refresh}
      />
    );
  }

  if (events.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-4 gap-2">
        <Activity className="h-8 w-8 text-muted-foreground/40" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">No events</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            {sourceId ? "No recent activity for this source" : "Quiet across the fleet"}
          </p>
        </div>
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
        leading={
          <span
            className={cn(
              "inline-block w-1.5 h-1.5 rounded-full shrink-0",
              events.length > 0 ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
          />
        }
        trailing={
          showJumpLink ? (
            <Link
              href={`/events${queryString}`}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              View all
              <ArrowUpRight className="h-2.5 w-2.5" />
            </Link>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-auto min-h-0">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
            No matches for &ldquo;{search}&rdquo;
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {grouped && groups
              ? groups.map((group) => (
                  <GroupRow key={group.events[0].id} group={group} />
                ))
              : filtered.map((event) => (
                  <LogRow
                    key={event.id}
                    dotClassName={dotFor(event.severity)}
                    title={event.title}
                    chips={
                      sourceLabel(event) ? [{ key: sourceLabel(event)! }] : undefined
                    }
                    timestamp={event.created_at}
                  />
                ))}
          </div>
        )}
      </div>
    </div>
  );
}
