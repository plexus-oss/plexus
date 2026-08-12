"use client";

import { useState, use, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Circle,
  Copy,
  Clock,
  ChevronRight,
  ChevronDown,
  MapPin,
  Cpu,
  WifiOff,
  Link2,
  Upload,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useSource, useSources, useDeviceSchema } from "@/hooks/use-sources";
import { useSourceAssociations } from "@/hooks/use-source-associations";
import { useConnectionSchema } from "@/hooks/use-connection-schema";
import { UnifiedDataTab } from "@/components/source/unified-data-tab";
import { ImportDataSheet } from "@/components/source/import-data-sheet";
import { suggestPanelsForTable } from "@/lib/dashboard/suggest";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { TabNav } from "@/components/ui/tab-nav";
import { DeviceRecordings } from "@/components/data/device-recordings";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  usePlexusRealtime,
  SensorInfo,
  CameraInfo,
} from "@/hooks/use-plexus-realtime";
import { SensorConfig } from "@/components/fleet/sensor-config";
import { StreamControl } from "@/components/fleet/stream-control";
import { LiveCameraSection } from "@/components/device/live-camera-section";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { TelemetryProvider } from "@/components/dashboard/telemetry-provider";
import { DashboardStateProvider } from "@/components/dashboard/dashboard-state-context";
import {
  buildPanels,
  LINE_W,
  LINE_H,
} from "@/lib/dashboards/quick-start-layout";
import {
  DEFAULT_PANEL_CONFIG,
  DEFAULT_TIME_RANGE,
  type DashboardConfig,
  type DashboardVariable,
  type DataFilter,
  type Panel,
} from "@/lib/types/dashboard";
import { toast } from "@/lib/toast-utils";
import { useAvailableMetrics } from "@/hooks/use-telemetry";
import { useRole } from "@/hooks/use-role";
import { DeviceModeBadge } from "@/components/device/device-mode-badge";
import type { LinkedConnection } from "@/lib/db/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogContent,
} from "@/components/ui/alert-dialog";
import { SaveBar } from "@/components/ui/save-bar";
import { useSaveBar } from "@/hooks/use-save-bar";

interface PageProps {
  params: Promise<{ slug: string }>;
}

type DeviceTabType = "overview" | "live" | "recordings" | "data";

// Stable references for the ephemeral Live-tab dashboard — the providers
// diff these by identity, so fresh literals each render would churn state.
const EMPTY_FILTERS: DataFilter[] = [];
const EMPTY_VARIABLES: DashboardVariable[] = [];
const noopConfigChange = () => {};

export default function DeviceDetailPage({ params }: PageProps) {
  const { slug } = use(params);
  const router = useRouter();

  // Fire these in parallel — useSource resolves slug→Source, useDeviceSchema
  // hits the same endpoint with slug. Neither waits on the other.
  const { source, isLoading, mutate } = useSource(slug);
  useDeviceSchema(slug);

  // Discovered-entity plumbing: the connection-table slice feeding this
  // source (written by the discovery loop). Empty for plain push devices.
  const { associations } = useSourceAssociations(slug);
  const primaryAssociation = associations[0] ?? null;
  const hasAssociation = associations.length > 0;
  const assocConnectionRef = primaryAssociation
    ? primaryAssociation.connection_slug || primaryAssociation.connection_id
    : null;
  const { source: assocConnection } = useSource(assocConnectionRef);
  const { tables: assocTables, isLoading: assocSchemaLoading } =
    useConnectionSchema(assocConnection?.id ?? null);
  const assocFilter = useMemo(() => {
    if (!primaryAssociation?.filter_column || !primaryAssociation.filter_value)
      return undefined;
    return {
      column: primaryAssociation.filter_column,
      value: primaryAssociation.filter_value,
    };
  }, [primaryAssociation]);

  const [activeTab, setActiveTab] = useState<DeviceTabType>("overview");
  const [metricsToSubscribe, setMetricsToSubscribe] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [showImportSheet, setShowImportSheet] = useState(false);
  const { metricsBySource } = useAvailableMetrics();
  const { canEdit } = useRole();

  // Get recording preference from source config
  const sourceConfig = source?.config as Record<string, unknown> | null;
  const savedRecordingPref = sourceConfig?.recording === true;

  const sourceSlug = source?.slug;
  const recordingPreferences = useMemo(() => {
    if (!sourceSlug) return {};
    return { [sourceSlug]: savedRecordingPref };
  }, [sourceSlug, savedRecordingPref]);

  const {
    sources: onlineSources,
    videoFrameStore,
    configureSensor,
    setRecording,
    startCamera,
    stopCamera,
  } = usePlexusRealtime(metricsToSubscribe, {
    autoStream: true,
    recordingPreferences,
  });

  // Find this source in online sources
  const wsSource = useMemo(() => {
    return onlineSources.find((d) => {
      const s = source?.slug;
      if (!s) return undefined;
      return d.source_id === s || d.source_id.endsWith(`:${s}`);
    });
  }, [onlineSources, source?.slug]);

  const isSourceOnline = !!wsSource;
  // The single truth for "is this device online": a live WS session OR the
  // server-derived status (last_seen_at within threshold). Batch/HTTP devices
  // report without holding a WS session — they are online, not "offline".
  const isOnline = isSourceOnline || source?.status === "online";
  const wsSourceId = wsSource?.source_id;
  const sourceSensors: SensorInfo[] = wsSource?.sensors || [];
  const sourceCameras: CameraInfo[] = wsSource?.cameras || [];

  const [activeCameraIds, setActiveCameraIds] = useState<Set<string>>(
    new Set(),
  );

  // Every metric known for this device: stored metrics from ClickHouse
  // (metricsBySource is keyed by SLUG) unioned with the bare metric names the
  // live sensors report right now — so the Live grid renders on first connect
  // even before anything has been persisted.
  const deviceMetrics = useMemo(() => {
    const set = new Set<string>();
    if (sourceSlug) {
      for (const m of metricsBySource) {
        if (m.source_id === sourceSlug) {
          for (const metric of m.metrics) set.add(metric);
        }
      }
    }
    for (const sensor of wsSource?.sensors || []) {
      for (const metric of sensor.metrics) {
        set.add(sensor.prefix ? `${sensor.prefix}.${metric}` : metric);
      }
    }
    return Array.from(set).sort();
  }, [metricsBySource, sourceSlug, wsSource]);

  // Ephemeral quick-start layout for the Live tab — same builder as
  // POST /api/dashboards/quick-start, so "Save as dashboard" persists
  // exactly the grid on screen.
  const liveConfig = useMemo<DashboardConfig>(
    () => ({
      panels: buildPanels(deviceMetrics, sourceSlug || slug),
      timeRange: DEFAULT_TIME_RANGE,
      refreshInterval: 5000,
      displaySettings: { syncTooltips: true },
    }),
    [deviceMetrics, sourceSlug, slug],
  );

  // Discovered-source fallback for the Live grid: no realtime metrics, but
  // the entity's rows live in a connection table — suggest entity-scoped
  // panels from the connection's schema snapshot. Connection panels fetch
  // via their own query path; TelemetryProvider autoStream=false stays as-is.
  const assocPanels = useMemo<Panel[]>(() => {
    if (deviceMetrics.length > 0) return [];
    if (!primaryAssociation || !assocConnection || !assocFilter) return [];
    const table = assocTables.find(
      (t) => t.name === primaryAssociation.table_name,
    );
    if (!table) return [];
    const suggestions = suggestPanelsForTable(table, assocConnection.id, {
      maxSuggestions: 6,
      tables: assocTables,
      entityFilter: assocFilter,
    });
    return suggestions.map((s, i) => ({
      id: `assoc-${i + 1}`,
      type: s.panelType,
      title: s.title,
      metrics: [],
      dataSource: s.dataSource,
      config: { ...DEFAULT_PANEL_CONFIG, ...s.config },
      layout: {
        x: (i % 2) * LINE_W,
        y: Math.floor(i / 2) * LINE_H,
        w: LINE_W,
        h: LINE_H,
        minW: 4,
        minH: 3,
      },
    }));
  }, [
    deviceMetrics,
    primaryAssociation,
    assocConnection,
    assocFilter,
    assocTables,
  ]);

  const assocLiveConfig = useMemo<DashboardConfig>(
    () => ({
      panels: assocPanels,
      timeRange: DEFAULT_TIME_RANGE,
      refreshInterval: 5000,
      displaySettings: { syncTooltips: true },
    }),
    [assocPanels],
  );

  // Discovered-only sources are fed by a connection slice, not a push
  // stream — hide push-flavored chrome (mirrors the isPassiveDevice pattern).
  const isDiscoveredOnly = hasAssociation && deviceMetrics.length === 0;

  // The metrics we want to subscribe to are fully derived from the online
  // source's sensor metadata (presence is independent of the active
  // subscription, so this isn't a feedback loop). Compute it as a derived value.
  const desiredMetrics = useMemo(() => {
    if (!wsSource) return [];
    const sourceId = wsSource.source_id;
    const sensors = wsSource.sensors || [];
    const metrics: string[] = [];
    for (const sensor of sensors) {
      for (const metric of sensor.metrics) {
        metrics.push(
          sensor.prefix
            ? `${sourceId}:${sensor.prefix}.${metric}`
            : `${sourceId}:${metric}`,
        );
      }
    }
    return metrics.sort();
  }, [wsSource]);

  // Push the derived set into subscription state when it changes (React's
  // "adjust state during render" pattern — converges without an extra commit).
  if (
    JSON.stringify(desiredMetrics) !==
    JSON.stringify([...metricsToSubscribe].sort())
  ) {
    setMetricsToSubscribe(desiredMetrics);
  }

  // Name/location editing
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedLocation, setEditedLocation] = useState("");
  const [editedRecordingPref, setEditedRecordingPref] = useState<
    boolean | null
  >(null);
  const initializedRef = useRef(false);
  const locationInputRef = useRef<HTMLInputElement>(null);

  const { deleteSource, updateSource, createSource, connections } =
    useSources();

  const metadata = source?.metadata as Record<string, unknown> | null;
  const sourceLocation = metadata?.location as string | undefined;
  const sourceTags = metadata?.tags as string[] | undefined;

  // Linked connections for overview display
  const linkedConnections: LinkedConnection[] = useMemo(() => {
    if (!metadata) return [];
    const linked = metadata.linked_connections;
    return Array.isArray(linked) ? (linked as LinkedConnection[]) : [];
  }, [metadata]);

  // Save bar for deferred saves — keep latest values in refs so the onSave
  // callback reads current state. Writing in an effect (no deps = after every
  // render) preserves the "always latest" semantics without touching refs in render.
  const sourceRef = useRef(source);
  const editedNameRef = useRef(editedName);
  const editedLocationRef = useRef(editedLocation);
  const editedRecordingPrefRef = useRef(editedRecordingPref);
  useEffect(() => {
    sourceRef.current = source;
    editedNameRef.current = editedName;
    editedLocationRef.current = editedLocation;
    editedRecordingPrefRef.current = editedRecordingPref;
  });

  const { saveBarProps, leaveConfirm, markDirty } = useSaveBar({
    onSave: async () => {
      const s = sourceRef.current;
      if (!s) return;
      const updates: Record<string, unknown> = {};
      // Name
      if (editedNameRef.current !== (s.name || "")) {
        updates.name = editedNameRef.current || undefined;
      }
      // Location (in metadata)
      const currentMetadata =
        s.metadata &&
        typeof s.metadata === "object" &&
        !Array.isArray(s.metadata)
          ? (s.metadata as Record<string, unknown>)
          : {};
      const currentLocation = (currentMetadata.location as string) || "";
      if (editedLocationRef.current !== currentLocation) {
        updates.metadata = {
          ...currentMetadata,
          location: editedLocationRef.current || null,
        };
      }
      // Recording preference
      const currentConfig = (s.config as Record<string, unknown>) || {};
      if (
        editedRecordingPrefRef.current !== null &&
        editedRecordingPrefRef.current !== (currentConfig.recording === true)
      ) {
        updates.config = {
          ...currentConfig,
          recording: editedRecordingPrefRef.current,
        };
      }
      if (Object.keys(updates).length > 0) {
        await updateSource(s.id, updates);
        mutate();
      }
      setIsEditingLocation(false);
      setEditedRecordingPref(null);
    },
    onDiscard: () => {
      const s = sourceRef.current;
      setEditedName(s?.name || "");
      const md = s?.metadata as Record<string, unknown> | null;
      setEditedLocation((md?.location as string) || "");
      setEditedRecordingPref(null);
      setIsEditingLocation(false);
    },
    currentPath: `/devices/${slug}`,
    enabled: canEdit,
    successMessage: "Device saved",
    errorMessage: "Failed to save device",
  });

  useEffect(() => {
    if (source && !initializedRef.current) {
      initializedRef.current = true;
      setEditedName(source.name || "");
      setEditedLocation(sourceLocation || "");
    }
  }, [source, sourceLocation]);

  useEffect(() => {
    if (isEditingLocation && locationInputRef.current) {
      locationInputRef.current.focus();
      locationInputRef.current.select();
    }
  }, [isEditingLocation]);

  const handleNameChange = useCallback(
    (value: string) => {
      setEditedName(value);
      markDirty();
    },
    [markDirty],
  );

  const handleLocationChange = useCallback(
    (value: string) => {
      setEditedLocation(value);
      markDirty();
    },
    [markDirty],
  );

  const handleRecordingPrefChange = useCallback(
    async (recording: boolean) => {
      if (!source) return;
      const currentConfig = (source.config as Record<string, unknown>) || {};
      await updateSource(source.id, {
        config: { ...currentConfig, recording },
      });
      mutate();
    },
    [source, updateSource, mutate],
  );

  // "Save as dashboard" — persists the Live tab's quick-start layout as a
  // real dashboard via the same route the Terminal proposal applies.
  const [isSavingDashboard, setIsSavingDashboard] = useState(false);
  const handleSaveAsDashboard = useCallback(async () => {
    const s = sourceRef.current;
    if (!s) return;
    setIsSavingDashboard(true);
    try {
      const res = await fetch("/api/dashboards/quick-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: s.slug,
          name: `${s.name || s.slug} overview`,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        dashboard?: { id: string };
        error?: string;
      };
      if (!res.ok || !body.dashboard) {
        throw new Error(body.error || "Failed to create dashboard");
      }
      toast.success("Dashboard created");
      router.push(`/dashboards/${body.dashboard.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create dashboard",
      );
    } finally {
      setIsSavingDashboard(false);
    }
  }, [router]);

  const handleDelete = () => {
    if (!source) return;
    // Navigate first; useSources optimistically removes the device from
    // every cached list view, so the destination already reflects the
    // delete. The hook toasts and reverts on failure.
    router.push(`/devices`);
    void deleteSource(source.id).catch(() => {});
  };

  const copySlug = () => {
    if (source?.slug) {
      navigator.clipboard.writeText(source.slug);
    }
  };

  // No blocking spinner here — `loading.tsx` renders the route-level
  // skeleton during navigation and SWR's keepPreviousData smooths
  // re-fetches. The "not found" branch below handles `!source` either
  // way; for an in-flight fetch we render the chrome and let content
  // stream in.
  if (isLoading && !source) {
    return <PageWrapper title="Device" />;
  }

  if (!source) {
    // Check if device is visible via WebSocket but not yet in the DB
    const wsOnlySource = onlineSources.find(
      (d) => d.source_id === slug || d.source_id.endsWith(`:${slug}`),
    );

    return (
      <PageWrapper title="Device" description="Device not found">
        <div className="p-8">
          {wsOnlySource ? (
            <div className="space-y-4">
              <EmptyState
                icon={Cpu}
                title="Unregistered device"
                description={`"${slug}" is streaming data but hasn't been added to your fleet yet.`}
                action={
                  canEdit
                    ? {
                        label: "Add to Fleet",
                        onClick: async () => {
                          try {
                            await createSource({
                              source_type: "device",
                              slug,
                              name: slug,
                              device_type: wsOnlySource.platform || undefined,
                            });
                            mutate();
                          } catch {
                            // Error handled in createSource
                          }
                        },
                      }
                    : {
                        label: "Back to Devices",
                        onClick: () => router.push(`/devices`),
                      }
                }
              />
            </div>
          ) : (
            <EmptyState
              icon={Cpu}
              title="Device not found"
              action={{
                label: "Back to Devices",
                onClick: () => router.push(`/devices`),
              }}
            />
          )}
        </div>
      </PageWrapper>
    );
  }

  const isPassiveDevice = source.device_type === "satellite";

  const tabs = [
    { id: "overview", label: "Overview" },
    ...(!isPassiveDevice
      ? [
          { id: "live", label: "Live" },
          { id: "recordings", label: "Recordings" },
        ]
      : []),
    ...(hasAssociation ? [{ id: "data", label: "Data" }] : []),
  ];

  return (
    <PageWrapper
      title={
        <div className="flex items-center gap-1">
          <Link
            href={`/devices`}
            className="text-muted-foreground text-sm hover:text-foreground transition-colors flex items-center gap-1"
          >
            Devices
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-sm font-medium">
            {source.name || source.slug}
          </span>
        </div>
      }
    >
      <div className="flex flex-col h-full">
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as DeviceTabType)}
        />

        <div className="flex-1 overflow-auto">
          {/* OVERVIEW TAB */}
          {activeTab === "overview" && (
            <div className="p-6 max-w-3xl mx-auto">
              {/* Header */}
              <div className="mb-8">
                <div className="mb-3">
                  <Label className="text-xs text-muted-foreground mb-1.5 block">
                    Device Name
                  </Label>
                  <Input
                    type="text"
                    value={editedName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    disabled={!canEdit}
                    maxLength={100}
                    className="h-9 text-sm"
                    placeholder="Untitled device"
                  />
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <code className="font-mono">{source.slug}</code>
                  <Button
                    variant="ghost"
                    onClick={copySlug}
                    size="sm"
                    className="h-6 text-xs p-0"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <DeviceModeBadge
                    deviceType={source.device_type}
                    recording={
                      (source.config as Record<string, unknown> | null)
                        ?.recording === true
                    }
                    status={
                      source.status as
                        | "online"
                        | "offline"
                        | "unknown"
                        | "pending"
                        | "error"
                        | null
                    }
                    linkedCount={linkedConnections.length}
                  />
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setShowImportSheet(true)}
                    >
                      <Upload className="h-3 w-3 mr-1" />
                      Import data
                    </Button>
                  )}
                </div>
              </div>
              {canEdit && !isPassiveDevice && !isDiscoveredOnly && (
                <div className="mb-6">
                  <Card className="p-4">
                    <StreamControl
                      sourceId={wsSourceId || source?.slug || slug}
                      isSourceOnline={isOnline}
                      // Bind the switch to the persisted source.config.recording
                      // (the value the loader actually filters on), not the
                      // live-stream `store` flag which can flip independently
                      // and made every click flip the saved value the opposite
                      // direction the user intended.
                      isRecording={savedRecordingPref}
                      onSetRecording={(store) => {
                        const srcId = wsSourceId || source?.slug || slug;
                        setRecording(srcId, store);
                      }}
                      onSavePreference={handleRecordingPrefChange}
                    />
                  </Card>
                </div>
              )}

              {/* Properties */}
              <div className="space-y-4">
                <SectionHeader>Properties</SectionHeader>

                <div className="space-y-3">
                  <div className="flex items-start py-1.5">
                    <span className="w-32 text-sm text-muted-foreground flex items-center gap-2">
                      <Circle className="h-3.5 w-3.5" />
                      Status
                    </span>
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full",
                          isOnline ? "bg-green-500" : "bg-zinc-400",
                        )}
                      />
                      <span className="text-sm capitalize">
                        {isOnline ? "Online" : "Offline"}
                      </span>
                    </div>
                  </div>

                  {/* Location */}
                  <div className="flex items-start py-1.5">
                    <span className="w-32 text-sm text-muted-foreground flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5" />
                      Location
                    </span>
                    {isEditingLocation ? (
                      <Input
                        ref={locationInputRef}
                        type="text"
                        value={editedLocation}
                        onChange={(e) => handleLocationChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setIsEditingLocation(false);
                          if (e.key === "Escape") {
                            setEditedLocation(sourceLocation || "");
                            setIsEditingLocation(false);
                          }
                        }}
                        onBlur={() => setIsEditingLocation(false)}
                        className="text-sm bg-transparent border-none outline-none focus:ring-0 p-0 flex-1"
                        placeholder="Add location..."
                      />
                    ) : (
                      <span
                        onClick={
                          canEdit ? () => setIsEditingLocation(true) : undefined
                        }
                        className={cn(
                          "text-sm rounded px-1 -mx-1 transition-colors",
                          canEdit && "cursor-text hover:bg-muted/50",
                          !sourceLocation && "text-muted-foreground",
                        )}
                      >
                        {sourceLocation ||
                          (canEdit ? "Add location..." : "\u2014")}
                      </span>
                    )}
                  </div>

                  <div className="flex items-start py-1.5">
                    <span className="w-32 text-sm text-muted-foreground flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5" />
                      Last seen
                    </span>
                    <span className="text-sm">
                      {source.last_seen_at
                        ? formatDistanceToNow(new Date(source.last_seen_at), {
                            addSuffix: true,
                          })
                        : "Never"}
                    </span>
                  </div>
                  {/* Linked Connections */}
                  {linkedConnections.length > 0 && (
                    <div className="flex items-start py-1.5">
                      <span className="w-32 text-sm text-muted-foreground flex items-center gap-2">
                        <Link2 className="h-3.5 w-3.5" />
                        Connections
                      </span>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {linkedConnections.map((lc) => {
                          const conn = connections.find(
                            (c) => c.id === lc.connection_id,
                          );
                          return (
                            <Link
                              key={lc.connection_id}
                              href={`/connections/${conn?.slug || lc.connection_id}`}
                              className="text-sm text-blue-500 hover:underline"
                            >
                              {lc.label ||
                                conn?.name ||
                                conn?.slug ||
                                "Database"}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Tags */}
              {sourceTags && sourceTags.length > 0 && (
                <div className="mt-8 space-y-4">
                  <SectionHeader>Tags</SectionHeader>
                  <div className="flex flex-wrap gap-1.5">
                    {sourceTags.map((tag, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 text-xs bg-muted rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata (collapsed by default) */}
              {!!(metadata && Object.keys(metadata).length > 0) && (
                <div className="mt-8">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowMetadata(!showMetadata)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground h-auto p-0 hover:bg-transparent"
                  >
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 transition-transform",
                        !showMetadata && "-rotate-90",
                      )}
                    />
                    Metadata
                  </Button>
                  {showMetadata && (
                    <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-auto mt-2">
                      {JSON.stringify(source.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {/* <div className="mt-8">
                <ContextTab sourceId={source.id} />
              </div> */}

              {canEdit && (
                <div className="mt-12 pt-8 border-t border-border">
                  <Button
                    onClick={() => setShowDeleteConfirm(true)}
                    size="sm"
                    variant="destructive"
                  >
                    Delete device
                  </Button>
                </div>
              )}
              <AlertDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Device</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete &quot;
                      {source?.name || source?.slug}
                      &quot;? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleDelete}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {activeTab === "live" && (
            <div className="p-6 space-y-8">
              {/* Slim status row — the grid below is the content, not the connection */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      isOnline ? "bg-green-500" : "bg-zinc-400",
                    )}
                  />
                  <span className="text-sm text-muted-foreground">
                    {isSourceOnline
                      ? "Connected"
                      : isOnline
                        ? "Online"
                        : "Offline"}
                  </span>
                </div>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={deviceMetrics.length === 0 || isSavingDashboard}
                    onClick={handleSaveAsDashboard}
                  >
                    Save as dashboard
                  </Button>
                )}
              </div>

              {/* Live metrics grid — ephemeral quick-start dashboard. The page
                  already owns the device stream (usePlexusRealtime above), so
                  the provider listens without issuing duplicate start commands. */}
              {deviceMetrics.length > 0 ? (
                <TelemetryProvider
                  timeRange={liveConfig.timeRange}
                  refreshInterval={5000}
                  autoStream={false}
                >
                  <DashboardStateProvider
                    filters={EMPTY_FILTERS}
                    variables={EMPTY_VARIABLES}
                    refreshInterval={5000}
                  >
                    <DashboardGrid
                      config={liveConfig}
                      onConfigChange={noopConfigChange}
                      isEditing={false}
                    />
                  </DashboardStateProvider>
                </TelemetryProvider>
              ) : assocPanels.length > 0 ? (
                // Discovered source: entity-scoped panels suggested from the
                // parent connection's schema — same grid recipe as above.
                <TelemetryProvider
                  timeRange={assocLiveConfig.timeRange}
                  refreshInterval={5000}
                  autoStream={false}
                >
                  <DashboardStateProvider
                    filters={EMPTY_FILTERS}
                    variables={EMPTY_VARIABLES}
                    refreshInterval={5000}
                  >
                    <DashboardGrid
                      config={assocLiveConfig}
                      onConfigChange={noopConfigChange}
                      isEditing={false}
                    />
                  </DashboardStateProvider>
                </TelemetryProvider>
              ) : (
                <EmptyState
                  icon={WifiOff}
                  title="No telemetry yet"
                  description={
                    source.device_type === "embedded"
                      ? "Press the reset button or power cycle the board to start streaming."
                      : "Run `plexus start` on the device to start streaming metrics."
                  }
                />
              )}

              {/* Sensors */}
              {sourceSensors.length > 0 && !isDiscoveredOnly && (
                <div className="space-y-4">
                  <SectionHeader>Sensors</SectionHeader>
                  <Card className="p-4">
                    <SensorConfig
                      sensors={sourceSensors}
                      isSourceOnline={isSourceOnline}
                      onConfigureSensor={(sensor, config) => {
                        if (wsSourceId) {
                          configureSensor(wsSourceId, sensor, config);
                        }
                      }}
                    />
                  </Card>
                </div>
              )}

              {/* Cameras */}
              {sourceCameras.length > 0 && !isDiscoveredOnly && (
                <LiveCameraSection
                  videoFrameStore={videoFrameStore}
                  cameras={sourceCameras}
                  wsSourceId={wsSourceId}
                  isSourceOnline={isSourceOnline}
                  activeCameraIds={activeCameraIds}
                  setActiveCameraIds={setActiveCameraIds}
                  startCamera={startCamera}
                  stopCamera={stopCamera}
                />
              )}
            </div>
          )}

          {/* RECORDINGS TAB */}
          {activeTab === "recordings" && (
            <div className="h-full">
              <DeviceRecordings sourceId={source.id} />
            </div>
          )}

          {/* DATA TAB — discovered sources: the connection-table slice
              feeding this entity, explored via the parent connection. */}
          {activeTab === "data" && primaryAssociation && (
            <div className="h-full">
              {assocConnection ? (
                <UnifiedDataTab
                  key={assocConnection.id}
                  source={assocConnection}
                  schema={assocSchemaLoading ? undefined : assocTables}
                  initialTable={primaryAssociation.table_name}
                  filter={assocFilter}
                />
              ) : (
                <div className="flex items-center justify-center py-12">
                  <Spinner />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <ImportDataSheet
        sourceSlug={source.slug}
        open={showImportSheet}
        onOpenChange={setShowImportSheet}
      />
      {canEdit && <SaveBar {...saveBarProps} />}

      <AlertDialog open={leaveConfirm.isOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes that will be lost. Are you sure you want
              to leave?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={leaveConfirm.onStay}>
              Stay
            </AlertDialogCancel>
            <AlertDialogAction onClick={leaveConfirm.onLeave}>
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageWrapper>
  );
}
