"use client";

import { useMemo, useState, useCallback } from "react";
import { format } from "date-fns";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { usePanelData } from "@/hooks/use-panel-data";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import { LogRow } from "@/components/dashboard/panels/log-row";
import { LogPanelHeader } from "@/components/dashboard/panels/log-panel-header";
import { formatRelativeShort } from "@/lib/format/relative-time";
import { ArrowUpRight } from "lucide-react";

interface ListPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

type ItemStatus = "pending" | "active" | "completed" | "error";

interface ListConfig {
  items?: ListItem[];
  showTimestamp?: boolean;
  showStatus?: boolean;
  maxItems?: number;
  timestampFormat?: "relative" | "absolute";
  statusMetric?: string;
  titleMetric?: string;
  descriptionMetric?: string;
  /** Row height preset. Defaults to compact. */
  density?: "compact" | "cozy";
  /** Hide the search input entirely. */
  hideSearch?: boolean;
  /** Show the left timeline rail. */
  showTimeline?: boolean;
}

interface ListItem {
  id: string;
  title: string;
  description?: string;
  timestamp?: string;
  status?: ItemStatus;
  href?: string;
  metadata?: Record<string, unknown>;
}

const STATUS_DOT: Record<ItemStatus, string> = {
  pending: "bg-muted-foreground/40",
  active: "bg-blue-500",
  completed: "bg-emerald-500",
  error: "bg-red-500",
};

/**
 * List Panel — compact Linear/Vercel-style activity feed.
 * Supports realtime, table, and connection data sources.
 */
export function ListPanel({ panel, timeRange }: ListPanelProps) {
  const config = panel.config as unknown as ListConfig;
  const showTimestamp = config.showTimestamp !== false;
  const showStatus = config.showStatus !== false;
  const maxItems = config.maxItems || 50;
  const timestampFormat = config.timestampFormat || "relative";
  const density = config.density ?? "compact";
  const hideSearch = config.hideSearch === true;
  const showTimeline = config.showTimeline !== false;

  const itemHeight = density === "cozy" ? 60 : 34;

  const [searchQuery, setSearchQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  // Measured height of the scroll viewport, kept in state (rather than read from
  // a ref during render) so the virtualization math stays render-pure. A
  // callback ref measures on mount and a ResizeObserver keeps it current.
  const [containerHeight, setContainerHeight] = useState(600);

  const scrollRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const measure = () => setContainerHeight(el.clientHeight || 600);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const { data, isLoading, error, sourceType, connectionMeta, refresh } =
    usePanelData({
      panel,
      timeRange,
    });

  const titleMetric = config.titleMetric || panel.metrics?.[0];
  const descriptionMetric = config.descriptionMetric || panel.metrics?.[1];
  const statusMetric = config.statusMetric || panel.metrics?.[2];

  const items = useMemo<ListItem[]>(() => {
    if (config.items && config.items.length > 0) {
      return config.items.slice(0, maxItems);
    }

    if (!data || !titleMetric) return [];

    const titleData = data[titleMetric] || [];

    if (titleData.length === 0 && sourceType === "connection") {
      const allKeys = Object.keys(data);
      if (allKeys.length > 0) {
        const firstKey = allKeys[0];
        const keyData = data[firstKey] || [];
        return keyData
          .map((point, index) => ({
            id: `${point.timestamp}-${index}`,
            title: String(point.value),
            timestamp: point.timestamp,
          }))
          .slice(0, maxItems);
      }
    }

    const descData = descriptionMetric ? data[descriptionMetric] || [] : [];
    const statusData = statusMetric ? data[statusMetric] || [] : [];

    const descLookup = new Map<string, string>();
    for (const d of descData) descLookup.set(d.timestamp, String(d.value));
    const statLookup = new Map<string, string>();
    for (const s of statusData) statLookup.set(s.timestamp, String(s.value));

    const builtItems: ListItem[] = titleData.map((point, index) => ({
      id: `${point.timestamp}-${index}`,
      title: String(point.value),
      description: descLookup.get(point.timestamp),
      timestamp: point.timestamp,
      status: statLookup.get(point.timestamp) as ItemStatus | undefined,
    }));

    return builtItems
      .sort((a, b) => {
        if (!a.timestamp || !b.timestamp) return 0;
        return (
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      })
      .slice(0, maxItems);
  }, [
    config.items,
    data,
    titleMetric,
    descriptionMetric,
    statusMetric,
    maxItems,
    sourceType,
  ]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.status?.toLowerCase().includes(query),
    );
  }, [items, searchQuery]);

  const formatTimestamp = (timestamp: string) =>
    timestampFormat === "relative"
      ? formatRelativeShort(timestamp)
      : format(new Date(timestamp), "MMM d, HH:mm");

  if (isLoading && items.length === 0) {
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

  if (items.length === 0) {
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
    <div className="h-full flex flex-col">
      {/* Header: search + count */}
      {!hideSearch && (
        <LogPanelHeader
          search={searchQuery}
          onSearchChange={setSearchQuery}
          count={filteredItems.length}
          total={items.length}
        />
      )}

      {/* Virtualized list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto min-h-0 relative"
        onScroll={handleScroll}
      >
        {showTimeline && (
          <div
            className="absolute top-2 bottom-2 w-px bg-border/50 pointer-events-none"
            style={{ left: 15 }}
          />
        )}

        {filteredItems.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
            No matches for &ldquo;{searchQuery}&rdquo;
          </div>
        ) : (
          <div
            style={{
              height: filteredItems.length * itemHeight,
              position: "relative",
            }}
          >
            {(() => {
              const startIdx = Math.floor(scrollTop / itemHeight);
              const endIdx = Math.min(
                filteredItems.length,
                startIdx + Math.ceil(containerHeight / itemHeight) + 2,
              );
              const visibleSlice = filteredItems.slice(startIdx, endIdx);

              return visibleSlice.map((item, i) => {
                const actualIdx = startIdx + i;
                const dotCls = item.status
                  ? STATUS_DOT[item.status]
                  : "bg-muted-foreground/30";
                const interactive = Boolean(item.href);
                const metadataEntries = item.metadata
                  ? Object.entries(item.metadata)
                  : [];

                if (density === "cozy") {
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "absolute left-0 right-0 group flex items-start gap-2.5 px-3 py-2",
                        "hover:bg-muted/40 transition-colors",
                        interactive && "cursor-pointer",
                      )}
                      style={{
                        top: actualIdx * itemHeight,
                        height: itemHeight,
                      }}
                      onClick={() => {
                        if (item.href) window.open(item.href, "_blank");
                      }}
                    >
                      {showStatus && (
                        <div
                          className={cn(
                            "w-1.5 h-1.5 rounded-full shrink-0 ring-[3px] ring-background relative z-[1] mt-1.5",
                            dotCls,
                            item.status === "active" && "animate-pulse",
                          )}
                        />
                      )}

                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        {/* Line 1: title + timestamp + arrow */}
                        <div className="flex items-baseline gap-2">
                          <span className="text-[12px] text-foreground font-medium truncate flex-1">
                            {item.title}
                          </span>
                          {showTimestamp && item.timestamp && (
                            <span
                              title={format(
                                new Date(item.timestamp),
                                "yyyy-MM-dd HH:mm:ss",
                              )}
                              className="text-[10px] font-mono text-muted-foreground/70 tabular-nums shrink-0"
                            >
                              {formatTimestamp(item.timestamp)}
                            </span>
                          )}
                          {interactive && (
                            <ArrowUpRight className="h-3 w-3 text-muted-foreground/50 group-hover:text-foreground shrink-0 transition-colors" />
                          )}
                        </div>

                        {/* Line 2: description + status + metadata */}
                        {(item.description ||
                          item.status ||
                          metadataEntries.length > 0) && (
                          <div className="flex items-baseline gap-2 min-w-0">
                            {item.description && (
                              <span className="text-[11px] text-muted-foreground truncate">
                                {item.description}
                              </span>
                            )}
                            {item.status && (
                              <span className="text-[10px] font-mono text-muted-foreground/80 capitalize shrink-0">
                                {item.status}
                              </span>
                            )}
                            {metadataEntries.map(([k, v]) => (
                              <span
                                key={k}
                                className="text-[10px] font-mono text-muted-foreground/60 tabular-nums shrink-0"
                              >
                                {k}=
                                <span className="text-muted-foreground/80">
                                  {String(v)}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                // Compact single-line row
                return (
                  <LogRow
                    key={item.id}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: actualIdx * itemHeight,
                      height: itemHeight,
                    }}
                    dotClassName={showStatus ? dotCls : null}
                    pulse={item.status === "active"}
                    title={item.title}
                    description={item.description}
                    chips={metadataEntries.map(([k, v]) => ({
                      key: k,
                      value: String(v),
                    }))}
                    timestamp={showTimestamp ? item.timestamp : null}
                    absoluteTime={timestampFormat === "absolute"}
                    href={item.href}
                    hoverTitle={
                      item.description && item.description !== item.title
                        ? item.description
                        : undefined
                    }
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
