"use client";

/**
 * SourcePicker — the unified "what feeds this panel" popover: devices with
 * inline metric/camera checkboxes, plus connections. Extracted from the old
 * DataSourceSelector; everything connection-query-specific (tables, joins,
 * measures) now lives in ConnectionDataEditor, which renders beneath this
 * when a connection is selected.
 */

import { useState, useMemo, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { useMergedMetricsBySource } from "@/hooks/use-merged-metrics";
import { useSources } from "@/hooks/use-sources";
import { getLinkedDevicesForConnection } from "@/hooks/use-linked-devices";
import type { DataSource, ConnectionDataSource } from "@/lib/types/dashboard";
import { isRealtimeSource, isConnectionSource } from "@/lib/types/dashboard";
import {
  X,
  Cpu,
  CheckIcon,
  ChevronDown,
  ChevronRight,
  Wifi,
  Link2,
  Video,
  Search,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const PLEXUS_SOURCE_ID = "__plexus__";

/** Visual-only checkbox indicator (not a <button>) to avoid nested button hydration errors */
function CheckIndicator({
  checked,
  className,
}: {
  checked?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`size-4 shrink-0 rounded-[4px] border shadow-xs flex items-center justify-center ${
        checked
          ? "bg-primary border-primary text-primary-foreground"
          : "border-input dark:bg-input/30"
      } ${className || ""}`}
    >
      {checked && <CheckIcon className="size-3.5" />}
    </div>
  );
}

export interface SourcePickerProps {
  dataSource: DataSource;
  selectedMetrics: string[];
  onDataSourceChange: (source: DataSource) => void;
  onMetricsChange: (metrics: string[]) => void;
}

export function SourcePicker({
  dataSource,
  selectedMetrics,
  onDataSourceChange,
  onMetricsChange,
}: SourcePickerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Shared source → metrics discovery (also feeds the signal rail).
  const { sources: mergedMetricsBySource, isLoading: metricsLoading } =
    useMergedMetricsBySource();
  const {
    connections,
    devices: allDevices,
    isLoading: connectionsLoading,
  } = useSources();

  const isConnection = isConnectionSource(dataSource);

  // Clear search when the popover closes
  useEffect(() => {
    if (!open) return;
    return () => setSearchQuery("");
  }, [open]);

  // Auto-collapse groups with no selected metrics when there are 3+ groups.
  // Fires once per source-set identity (see the ref guard — realtime ticks
  // rebuild mergedMetricsBySource every few seconds).
  const autoCollapsedKeyRef = useRef<string>("");
  useEffect(() => {
    if (mergedMetricsBySource.length < 3) return;
    const key = mergedMetricsBySource
      .map((s) => s.source_id)
      .sort()
      .join("|");
    if (autoCollapsedKeyRef.current === key) return;
    autoCollapsedKeyRef.current = key;

    const collapsed = new Set<string>();
    for (const source of mergedMetricsBySource) {
      const hasSelected = source.metrics.some((m) =>
        selectedMetrics.includes(`${source.source_id}:${m}`),
      );
      const hasCameraSelected = source.cameras.some((cam) =>
        selectedMetrics.includes(
          `${source.source_id}:$camera:${cam.camera_id}`,
        ),
      );
      if (!hasSelected && !hasCameraSelected) {
        collapsed.add(source.source_id);
      }
    }
    setCollapsedGroups(collapsed);
    // selectedMetrics is intentionally NOT a dep — we only want to compute
    // the initial collapsed set once per source-set identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedMetricsBySource]);

  const isRealtime = isRealtimeSource(dataSource);

  // Filtered sources based on search
  const filteredSources = useMemo(() => {
    if (!searchQuery.trim()) return mergedMetricsBySource;
    const q = searchQuery.toLowerCase();
    return mergedMetricsBySource
      .map((source) => ({
        ...source,
        metrics: source.metrics.filter((m) => m.toLowerCase().includes(q)),
        cameras: source.cameras.filter((c) =>
          (c.name || c.camera_id).toLowerCase().includes(q),
        ),
      }))
      .filter(
        (source) =>
          source.source_id.toLowerCase().includes(q) ||
          source.metrics.length > 0 ||
          source.cameras.length > 0,
      );
  }, [mergedMetricsBySource, searchQuery]);

  const filteredConnections = useMemo(() => {
    if (!searchQuery.trim()) return connections;
    const q = searchQuery.toLowerCase();
    return connections.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q),
    );
  }, [connections, searchQuery]);

  // Handle connection selection — ConnectionDataEditor takes over from here.
  const handleConnectionSelect = (sourceId: string) => {
    onDataSourceChange({
      type: "connection",
      sourceId,
      query: "",
      refreshInterval: 30000,
    });
    onMetricsChange([]);
    setOpen(false);
  };

  // Handle device metric toggle
  const handleMetricToggle = (metric: string) => {
    const newMetrics = selectedMetrics.includes(metric)
      ? selectedMetrics.filter((m) => m !== metric)
      : [...selectedMetrics, metric];
    onMetricsChange(newMetrics);
  };

  const selectedConnection = isConnection
    ? connections.find((c) => c.id === dataSource.sourceId)
    : null;

  const isPlexusConnection =
    isConnection &&
    (dataSource as ConnectionDataSource).sourceId === PLEXUS_SOURCE_ID;

  const getDisplayText = () => {
    if (isPlexusConnection) {
      return "Plexus Telemetry";
    }
    if (isConnection && selectedConnection) {
      return selectedConnection.name || selectedConnection.slug;
    }
    if (isRealtime && selectedMetrics.length > 0) {
      return `${selectedMetrics.length} metric${
        selectedMetrics.length > 1 ? "s" : ""
      } selected`;
    }
    return "Select data source";
  };

  const toggleGroup = (sourceId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  const isLoading = metricsLoading || connectionsLoading;

  const plexusMatchesSearch =
    !searchQuery.trim() ||
    "plexus telemetry".includes(searchQuery.toLowerCase());

  const hasSearchResults =
    filteredSources.length > 0 ||
    plexusMatchesSearch ||
    filteredConnections.length > 0;

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
          Data Source
        </Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button className="w-full mt-1.5 h-9 px-3 flex items-center justify-between rounded-md border border-input bg-background text-sm hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                {isPlexusConnection ? (
                  <Server className="h-3.5 w-3.5 text-muted-foreground" />
                ) : isConnection ? (
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-sm truncate">{getDisplayText()}</span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-80 p-0"
            align="start"
            onWheel={(e) => e.stopPropagation()}
          >
            {isLoading ? (
              <div className="p-4">
                <Spinner />
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="border-b border-border">
                  <div className="p-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search sources, metrics..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                        className="w-full h-8 pl-8 pr-3 text-sm bg-transparent border-0 outline-none placeholder:text-muted-foreground/60"
                      />
                    </div>
                  </div>
                </div>

                <div className="max-h-80 overflow-y-auto">
                  <div className="p-1.5">
                    {filteredSources.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground font-medium px-3 py-1.5">
                          Devices
                        </div>
                        {filteredSources.map((source) => {
                          const isGroupCollapsed = collapsedGroups.has(
                            source.source_id,
                          );

                          // When searching, force expand all groups
                          const effectiveCollapsed = searchQuery.trim()
                            ? false
                            : isGroupCollapsed;

                          return (
                            <Collapsible
                              key={source.source_id}
                              open={!effectiveCollapsed}
                              onOpenChange={() => toggleGroup(source.source_id)}
                            >
                              <CollapsibleTrigger asChild>
                                <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 rounded-md transition-colors">
                                  <ChevronRight
                                    className={`h-3.5 w-3.5 transition-transform ${
                                      !effectiveCollapsed ? "rotate-90" : ""
                                    }`}
                                  />
                                  <span className="truncate font-medium">
                                    {source.source_id}
                                  </span>
                                  {source.isOnline && (
                                    <Wifi className="h-3 w-3 text-blue-500 ml-auto shrink-0" />
                                  )}
                                </button>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                {/* Cameras */}
                                {source.cameras.map((camera) => {
                                  const cameraKey = `${source.source_id}:$camera:${camera.camera_id}`;
                                  const isSelected =
                                    selectedMetrics.includes(cameraKey);
                                  return (
                                    <Button
                                      key={cameraKey}
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleMetricToggle(cameraKey)
                                      }
                                      className="w-full justify-start px-3 py-2 pl-9 text-sm flex items-center gap-2.5 h-auto font-normal"
                                    >
                                      <CheckIndicator checked={isSelected} />
                                      <Video className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                      <span className="truncate">
                                        {camera.name || camera.camera_id}
                                      </span>
                                    </Button>
                                  );
                                })}
                                {/* Metrics */}
                                {source.metrics.map((metric) => {
                                  const metricKey = `${source.source_id}:${metric}`;
                                  const isSelected =
                                    selectedMetrics.includes(metricKey);
                                  return (
                                    <Button
                                      key={metricKey}
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleMetricToggle(metricKey)
                                      }
                                      className="w-full justify-start px-3 py-2 pl-9 text-sm flex items-center gap-2.5 h-auto font-normal"
                                    >
                                      <CheckIndicator checked={isSelected} />
                                      <span className="truncate">{metric}</span>
                                    </Button>
                                  );
                                })}
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        })}
                      </div>
                    )}

                    {/* Connections Section */}
                    {filteredConnections.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground font-medium px-3 py-1.5">
                          Connections
                        </div>
                        {filteredConnections.map((conn) => {
                          const isSelected =
                            isConnection &&
                            (dataSource as ConnectionDataSource).sourceId ===
                              conn.id;
                          const linked = getLinkedDevicesForConnection(
                            allDevices,
                            conn.id,
                          );
                          const deviceNames = linked
                            .map((l) => l.device.name || l.device.slug)
                            .join(", ");
                          return (
                            <Button
                              key={conn.id}
                              variant="ghost"
                              size="sm"
                              onClick={() => handleConnectionSelect(conn.id)}
                              className="w-full justify-start px-3 py-2 text-sm flex items-center gap-2.5 h-auto font-normal"
                            >
                              <CheckIndicator checked={isSelected} />
                              <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <div className="min-w-0 flex-1 text-left">
                                <span className="truncate block">
                                  {conn.name || conn.slug}
                                </span>
                                {deviceNames && (
                                  <span className="text-[10px] text-muted-foreground truncate block">
                                    {deviceNames}
                                  </span>
                                )}
                              </div>
                            </Button>
                          );
                        })}
                      </div>
                    )}

                    {/* No results */}
                    {!hasSearchResults && searchQuery.trim() && (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        No results for &ldquo;{searchQuery}&rdquo;
                      </div>
                    )}

                    {/* Empty state */}
                    {mergedMetricsBySource.length === 0 &&
                      connections.length === 0 && (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                          No data sources available
                        </div>
                      )}
                  </div>
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Selected metrics badges (for realtime) */}
      {isRealtime && selectedMetrics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedMetrics.map((m) => {
            // Check if this is a camera selection (format: source_id:$camera:camera_id)
            const isCamera = m.includes(":$camera:");
            let displayName: string;
            if (isCamera) {
              const markerIdx = m.indexOf(":$camera:");
              displayName = m.substring(markerIdx + ":$camera:".length);
            } else {
              const firstColon = m.indexOf(":");
              displayName = firstColon !== -1 ? m.substring(firstColon + 1) : m;
            }
            return (
              <Badge
                key={m}
                variant="secondary"
                className="text-xs px-2 py-0.5 cursor-pointer hover:bg-destructive/20 hover:text-destructive flex items-center gap-1 transition-colors"
                onClick={() => handleMetricToggle(m)}
              >
                {isCamera && <Video className="h-3 w-3" />}
                {displayName}
                <X className="h-2.5 w-2.5 ml-0.5" />
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
