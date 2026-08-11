"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSources } from "@/hooks/use-sources";
import { useMonitors } from "@/hooks/use-monitors";
import { useAvailableMetrics } from "@/hooks/use-telemetry";
import { usePlexusRealtime } from "@/hooks/use-plexus-realtime";
import {
  useNotificationTargetOptions,
  NotificationTargetChips,
} from "@/components/monitors/notification-target-picker";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Search,
  Gauge,
  Zap,
  Globe,
  MapPin,
  BarChart3,
  WifiOff,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast-utils";
import { cn } from "@/lib/utils";

interface MetricInfo {
  name: string;
  type?: string;
  table?: string;
}

export interface MonitorPrefill {
  sourceId?: string;
  metric?: string;
  /** Connection sources: table the metric column belongs to, when the caller knows it. */
  table?: string;
  min?: number;
  max?: number;
}

interface CreateMonitorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  prefill?: MonitorPrefill;
}

const severityConfig = {
  critical: { icon: AlertTriangle, color: "text-red-500", label: "Critical" },
  warning: { icon: AlertCircle, color: "text-yellow-500", label: "Warning" },
  info: { icon: Info, color: "text-blue-500", label: "Info" },
} as const;

const vizPresets = [
  {
    key: "earth",
    label: "Earth View",
    icon: Globe,
    color: "text-cyan-500",
    borderColor: "border-cyan-500/50 bg-cyan-500/5 ring-1 ring-cyan-500/20",
    config: {
      panel_type: "earth",
      panel_config: {
        showOrbitalPaths: true,
        enableRotation: true,
        showClouds: true,
        showAtmosphere: true,
      },
    },
  },
  {
    key: "map",
    label: "Map View",
    icon: MapPin,
    color: "text-emerald-500",
    borderColor:
      "border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/20",
    config: {
      panel_type: "map",
      panel_config: {},
    },
  },
  {
    key: "chart",
    label: "Chart",
    icon: BarChart3,
    color: "text-blue-500",
    borderColor: "border-blue-500/50 bg-blue-500/5 ring-1 ring-blue-500/20",
    config: {
      panel_type: "line",
      panel_config: {},
    },
  },
] as const;

export function CreateMonitorDialog({
  open,
  onOpenChange,
  onCreated,
  prefill,
}: CreateMonitorDialogProps) {
  const { sources, getSourceMetrics } = useSources();
  const { createMonitor } = useMonitors();
  const { metricsBySource } = useAvailableMetrics();
  const { sources: realtimeSources } = usePlexusRealtime();
  const notifyOptions = useNotificationTargetOptions();

  const [sourceId, setSourceId] = useState("");
  const [metric, setMetric] = useState("");
  // Connection sources: the table the picked metric column belongs to —
  // persisted with event monitors so the poll loop knows what to scan.
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricInfo[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [metricSearch, setMetricSearch] = useState("");
  const [metricListOpen, setMetricListOpen] = useState(true);

  // Monitor type selection
  const [thresholdEnabled, setThresholdEnabled] = useState(false);
  const [eventEnabled, setEventEnabled] = useState(false);
  const [offlineEnabled, setOfflineEnabled] = useState(false);
  const [timeoutValue, setTimeoutValue] = useState("5");
  const [timeoutUnit, setTimeoutUnit] = useState<"seconds" | "minutes">(
    "minutes",
  );
  const [selectedViz, setSelectedViz] = useState<string | null>(null);
  const [eventSeverity, setEventSeverity] = useState<
    "critical" | "warning" | "info"
  >("info");
  // Extra columns from the monitored table shown in the alert (max 5) —
  // "New users row — email=ann@example.com" instead of "Value: 1".
  const [contextCols, setContextCols] = useState<string[]>([]);

  // Threshold config
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [severity, setSeverity] = useState<"critical" | "warning" | "info">(
    "warning",
  );

  // Alert message template
  const [message, setMessage] = useState("");
  // Explicit notification targets (integration ids). Empty = default fan-out
  // to every integration subscribed to the event type.
  const [notifyTargets, setNotifyTargets] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);

  // Apply prefill values when the dialog opens. This adjusts state in response
  // to an `open`/`prefill` prop change during render (React's documented
  // alternative to a setState-in-effect), preserving the prior behavior of
  // only overwriting the fields present in `prefill`.
  const [prefillSync, setPrefillSync] = useState<{
    open: boolean;
    prefill: MonitorPrefill | undefined;
  }>({ open: false, prefill });
  if (prefillSync.open !== open || prefillSync.prefill !== prefill) {
    setPrefillSync({ open, prefill });
    if (open && prefill) {
      if (prefill.sourceId) setSourceId(prefill.sourceId);
      if (prefill.metric) {
        setMetric(prefill.metric);
        setSelectedTable(prefill.table ?? null);
        setMetricListOpen(false);
      }
      if (prefill.min !== undefined) {
        setMin(String(prefill.min));
        setThresholdEnabled(true);
      }
      if (prefill.max !== undefined) {
        setMax(String(prefill.max));
        setThresholdEnabled(true);
      }
    }
  }

  // Collect live + stored metrics for the selected source
  const availableMetrics = useMemo(() => {
    if (!sourceId) return [];

    const names = new Set<string>();
    const result: MetricInfo[] = [];

    // Stored telemetry from ClickHouse
    const telemetry = metricsBySource.find((s) => s.source_id === sourceId);
    for (const name of telemetry?.metrics || []) {
      if (!names.has(name)) {
        names.add(name);
        result.push({ name });
      }
    }

    // Live metrics from WebSocket
    const rtSource = realtimeSources.find((s) => s.source_id === sourceId);
    if (rtSource?.sensors) {
      for (const sensor of rtSource.sensors) {
        if (sensor.available && sensor.metrics) {
          for (const name of sensor.metrics) {
            if (!names.has(name)) {
              names.add(name);
              result.push({ name });
            }
          }
        }
      }
    }

    return result;
  }, [sourceId, metricsBySource, realtimeSources]);

  // Fetch schema metrics and merge with live/stored metrics
  useEffect(() => {
    // The metric list UI is gated on `sourceId`, and `resetForm`/the source
    // <Select> already clear `metric`/`metrics` when the source changes, so no
    // synchronous reset is needed here when there is no source.
    if (!sourceId) return;

    // Run the fetch (and its loading-state toggles) inside a callback so the
    // setState calls aren't synchronous in the effect body. `cancelled` guards
    // against a stale response landing after the source changed.
    let cancelled = false;
    const loadMetrics = async () => {
      setLoadingMetrics(true);
      try {
        const schemaMetrics = await getSourceMetrics(sourceId);
        if (cancelled) return;
        // Schema metrics have type info, so they take priority
        const schemaNames = new Set(schemaMetrics.map((m) => m.name));
        const merged = [
          ...schemaMetrics,
          ...availableMetrics.filter((m) => !schemaNames.has(m.name)),
        ];
        setMetrics(merged);
      } catch {
        // Fall back to live/stored metrics
        if (!cancelled) setMetrics(availableMetrics);
      } finally {
        if (!cancelled) setLoadingMetrics(false);
      }
    };
    loadMetrics();

    return () => {
      cancelled = true;
    };
  }, [sourceId, availableMetrics, getSourceMetrics]);

  // Prefilled metrics arrive without a table (the picker click that normally
  // sets selectedTable never happens). Resolve it from the loaded metric list
  // at submit time — an unpinned connection monitor is silently skipped by
  // the poller, and the API now rejects ambiguous ones outright.
  const resolvedTable =
    selectedTable ??
    metrics.find((m) => m.name === metric && m.table)?.table ??
    null;

  // Candidate context columns: the pinned table's other columns (connection
  // sources only — device telemetry has a fixed shape with nothing to add).
  const contextCandidates = useMemo(
    () =>
      resolvedTable
        ? metrics
            .filter((m) => m.table === resolvedTable && m.name !== metric)
            .map((m) => m.name)
        : [],
    [metrics, resolvedTable, metric],
  );

  const filteredMetrics = useMemo(() => {
    if (!metricSearch) return metrics;
    const q = metricSearch.toLowerCase();
    return metrics.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.table?.toLowerCase().includes(q),
    );
  }, [metrics, metricSearch]);

  const hasThreshold = thresholdEnabled && (min !== "" || max !== "");
  const needsMetric = thresholdEnabled || eventEnabled;
  const canSubmit =
    !!sourceId &&
    (!needsMetric || !!metric) &&
    (hasThreshold || eventEnabled || offlineEnabled) &&
    !submitting;

  const resetForm = () => {
    setSourceId("");
    setMetric("");
    setSelectedTable(null);
    setMetrics([]);
    setMetricSearch("");
    setMetricListOpen(true);
    setThresholdEnabled(false);
    setEventEnabled(false);
    setOfflineEnabled(false);
    setTimeoutValue("5");
    setTimeoutUnit("minutes");
    setEventSeverity("info");
    setSelectedViz(null);
    setContextCols([]);
    setMin("");
    setMax("");
    setSeverity("warning");
    setMessage("");
    setNotifyTargets([]);
  };

  const handleSubmit = async () => {
    if (!sourceId) {
      toast.error("Source is required");
      return;
    }
    if (needsMetric && !metric) {
      toast.error("Metric is required");
      return;
    }
    if (!hasThreshold && !eventEnabled && !offlineEnabled) {
      toast.error("Select at least one monitor type");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { source_id: sourceId };
      if (needsMetric) body.metric = metric;
      if (notifyTargets.length > 0) body.notification_targets = notifyTargets;

      if (hasThreshold) {
        body.threshold = {
          min: min ? parseFloat(min) : null,
          max: max ? parseFloat(max) : null,
          severity,
          message: message || null,
          ...(resolvedTable ? { table: resolvedTable } : {}),
        };
      }

      if (eventEnabled) {
        const vizPreset = vizPresets.find((v) => v.key === selectedViz);
        body.event = {
          severity: eventSeverity,
          message: message || null,
          enabled: true,
          visualization: vizPreset ? vizPreset.config : null,
          ...(resolvedTable ? { table: resolvedTable } : {}),
          ...(contextCols.length > 0 ? { context_columns: contextCols } : {}),
        };
      }

      if (offlineEnabled) {
        const raw = parseFloat(timeoutValue) || 0;
        const seconds = timeoutUnit === "minutes" ? raw * 60 : raw;
        body.offline = {
          // Floor at 10s — the detector scan runs ~every 60s, so anything
          // shorter just fires on the next scan anyway.
          timeout_seconds: Math.max(10, Math.round(seconds)),
          severity,
          message: message || null,
        };
      }

      await createMonitor(body);
      resetForm();
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create monitor",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const hasTypeSelected = thresholdEnabled || eventEnabled || offlineEnabled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">New Monitor</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground block">
              Monitor type
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setThresholdEnabled(!thresholdEnabled)}
                className={cn(
                  "flex flex-col items-start gap-2 p-4 rounded-lg border text-left transition-all",
                  thresholdEnabled
                    ? "border-blue-500/50 bg-blue-500/5 ring-1 ring-blue-500/20"
                    : "border-dashed hover:border-border hover:bg-accent/50",
                )}
              >
                <Gauge
                  className={cn(
                    "h-4 w-4",
                    thresholdEnabled
                      ? "text-blue-500"
                      : "text-muted-foreground",
                  )}
                />
                <div>
                  <div className="text-xs font-medium">Threshold</div>
                  <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                    Alert when values cross fixed boundaries
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setEventEnabled(!eventEnabled)}
                className={cn(
                  "flex flex-col items-start gap-2 p-4 rounded-lg border text-left transition-all",
                  eventEnabled
                    ? "border-green-500/50 bg-green-500/5 ring-1 ring-green-500/20"
                    : "border-dashed hover:border-border hover:bg-accent/50",
                )}
              >
                <Zap
                  className={cn(
                    "h-4 w-4",
                    eventEnabled ? "text-green-500" : "text-muted-foreground",
                  )}
                />
                <div>
                  <div className="text-xs font-medium">Event</div>
                  <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                    Alert on every new data point
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setOfflineEnabled(!offlineEnabled)}
                className={cn(
                  "flex flex-col items-start gap-2 p-4 rounded-lg border text-left transition-all",
                  offlineEnabled
                    ? "border-purple-500/50 bg-purple-500/5 ring-1 ring-purple-500/20"
                    : "border-dashed hover:border-border hover:bg-accent/50",
                )}
              >
                <WifiOff
                  className={cn(
                    "h-4 w-4",
                    offlineEnabled ? "text-purple-500" : "text-muted-foreground",
                  )}
                />
                <div>
                  <div className="text-xs font-medium">Stream stopped</div>
                  <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                    Alert when data stops streaming
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* ── Step 2: Source & Metric (shown after type selected) ── */}
          {hasTypeSelected && (
            <>
              <div className="border-t border-border" />
              <div className="space-y-3">
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                  Source
                </label>
                <Select
                  value={sourceId}
                  onValueChange={(v) => {
                    setSourceId(v);
                    setMetric("");
                    setSelectedTable(null);
                    setContextCols([]);
                    setMetricSearch("");
                    setMetricListOpen(true);
                  }}
                >
                  <SelectTrigger className="h-9 text-xs w-full">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.name || s.slug}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {needsMetric &&
                  sourceId &&
                  (loadingMetrics ? (
                    <div className="flex items-center gap-2 h-9 text-xs text-muted-foreground px-1">
                      <Spinner className="h-3 w-3" />
                      Loading metrics...
                    </div>
                  ) : metrics.length > 0 ? (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                        Metric
                      </label>
                      {metric && !metricListOpen ? (
                        <button
                          type="button"
                          className="w-full flex items-center justify-between h-9 px-3 text-xs rounded-lg border bg-accent/50"
                          onClick={() => setMetricListOpen(true)}
                        >
                          <code className="font-mono">{metric}</code>
                          <span className="text-muted-foreground text-[10px]">
                            Change
                          </span>
                        </button>
                      ) : (
                        <>
                          {metrics.length > 6 && (
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                              <Input
                                className="h-9 text-xs pl-7"
                                placeholder="Filter metrics..."
                                value={metricSearch}
                                onChange={(e) =>
                                  setMetricSearch(e.target.value)
                                }
                              />
                            </div>
                          )}
                          <div className="max-h-[180px] overflow-y-auto rounded-lg border">
                            {filteredMetrics.map((m) => {
                              const key = `${m.table || ""}:${m.name}`;
                              const isSelected = metric === m.name;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  className={cn(
                                    "w-full text-left px-3 py-2 text-xs transition-colors",
                                    "hover:bg-accent",
                                    isSelected &&
                                      "bg-accent text-accent-foreground",
                                  )}
                                  onClick={() => {
                                    setMetric(m.name);
                                    setSelectedTable(m.table ?? null);
                                    setContextCols([]);
                                    setMetricListOpen(false);
                                  }}
                                >
                                  <span>
                                    {m.table ? `${m.table}.` : ""}
                                    {m.name}
                                  </span>
                                  {m.type && (
                                    <span className="text-muted-foreground ml-1.5">
                                      {m.type}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                            {filteredMetrics.length === 0 && (
                              <div className="px-3 py-3 text-xs text-muted-foreground">
                                No metrics match &ldquo;{metricSearch}&rdquo;
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                        Metric
                      </label>
                      <div className="px-3 py-3 text-xs text-muted-foreground rounded-lg border border-dashed">
                        No metrics found. Send telemetry data from this source
                        first.
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}

          {/* ── Stream-stopped config (metric-less) ── */}
          {offlineEnabled && sourceId && (
            <>
              <div className="border-t border-border" />
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    Alert if no data for
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      className="h-9 text-xs w-24"
                      value={timeoutValue}
                      onChange={(e) => setTimeoutValue(e.target.value)}
                    />
                    <Select
                      value={timeoutUnit}
                      onValueChange={(v) =>
                        setTimeoutUnit(v as "seconds" | "minutes")
                      }
                    >
                      <SelectTrigger className="h-9 text-xs w-[110px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seconds" className="text-xs">
                          seconds
                        </SelectItem>
                        <SelectItem value="minutes" className="text-xs">
                          minutes
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Fires when the source stops streaming; auto-resolves when it
                    resumes.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Severity</label>
                  <Select
                    value={severity}
                    onValueChange={(v) => setSeverity(v as typeof severity)}
                  >
                    <SelectTrigger className="h-9 text-xs w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(severityConfig) as [
                          keyof typeof severityConfig,
                          (typeof severityConfig)[keyof typeof severityConfig],
                        ][]
                      ).map(([value, config]) => (
                        <SelectItem key={value} value={value} className="text-xs">
                          <div className="flex items-center gap-2">
                            <config.icon className={cn("h-3 w-3", config.color)} />
                            {config.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {/* ── Step 3: Type-specific config ── */}
          {hasTypeSelected && sourceId && metric && !metricListOpen && (
            <>
              <div className="border-t border-border" />
              <div className="space-y-4">
                {/* Threshold config */}
                {thresholdEnabled && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">
                          Minimum
                        </label>
                        <Input
                          type="number"
                          className="h-9 text-xs"
                          placeholder="No minimum"
                          value={min}
                          onChange={(e) => setMin(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Alert when value drops below
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">
                          Maximum
                        </label>
                        <Input
                          type="number"
                          className="h-9 text-xs"
                          placeholder="No maximum"
                          value={max}
                          onChange={(e) => setMax(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Alert when value exceeds
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">
                        Severity
                      </label>
                      <Select
                        value={severity}
                        onValueChange={(v) => setSeverity(v as typeof severity)}
                      >
                        <SelectTrigger className="h-9 text-xs w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            Object.entries(severityConfig) as [
                              keyof typeof severityConfig,
                              (typeof severityConfig)[keyof typeof severityConfig],
                            ][]
                          ).map(([value, config]) => (
                            <SelectItem
                              key={value}
                              value={value}
                              className="text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <config.icon
                                  className={cn("h-3 w-3", config.color)}
                                />
                                {config.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Event config */}
                {eventEnabled && (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      An alert will be created every time a new data point
                      arrives for this metric.
                    </p>

                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">
                        Severity
                      </label>
                      <Select
                        value={eventSeverity}
                        onValueChange={(v) =>
                          setEventSeverity(v as typeof eventSeverity)
                        }
                      >
                        <SelectTrigger className="h-9 text-xs w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            Object.entries(severityConfig) as [
                              keyof typeof severityConfig,
                              (typeof severityConfig)[keyof typeof severityConfig],
                            ][]
                          ).map(([value, config]) => (
                            <SelectItem
                              key={value}
                              value={value}
                              className="text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <config.icon
                                  className={cn("h-3 w-3", config.color)}
                                />
                                {config.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {contextCandidates.length > 0 && (
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">
                          Include in alert{" "}
                          <span className="text-muted-foreground/60">
                            (optional, up to 5)
                          </span>
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {contextCandidates.map((col) => {
                            const isSelected = contextCols.includes(col);
                            return (
                              <button
                                key={col}
                                type="button"
                                onClick={() =>
                                  setContextCols((prev) =>
                                    isSelected
                                      ? prev.filter((c) => c !== col)
                                      : prev.length < 5
                                        ? [...prev, col]
                                        : prev,
                                  )
                                }
                                className={cn(
                                  "px-2 py-1 rounded-md border text-[11px] font-mono transition-colors",
                                  isSelected
                                    ? "border-green-500/50 bg-green-500/10 text-foreground"
                                    : "border-dashed text-muted-foreground hover:border-border hover:bg-accent/50",
                                )}
                              >
                                {col}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Columns from {resolvedTable} shown in the
                          notification — e.g. who or what triggered it
                        </p>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">
                        Visualization{" "}
                        <span className="text-muted-foreground/60">
                          (optional)
                        </span>
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {vizPresets.map((preset) => {
                          const isSelected = selectedViz === preset.key;
                          const Icon = preset.icon;
                          return (
                            <button
                              key={preset.key}
                              type="button"
                              onClick={() =>
                                setSelectedViz(isSelected ? null : preset.key)
                              }
                              className={cn(
                                "flex flex-col items-center gap-1.5 p-3 rounded-lg border text-center transition-all",
                                isSelected
                                  ? preset.borderColor
                                  : "border-dashed hover:border-border hover:bg-accent/50",
                              )}
                            >
                              <Icon
                                className={cn(
                                  "h-4 w-4",
                                  isSelected
                                    ? preset.color
                                    : "text-muted-foreground",
                                )}
                              />
                              <span className="text-[10px] font-medium">
                                {preset.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Show this visualization in the alert detail view
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Alert Message ── */}
          {hasTypeSelected && sourceId && metric && !metricListOpen && (
            <>
              <div className="border-t border-border" />
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground block">
                  Alert message{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <Input
                  className="h-9 text-xs"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={
                    eventEnabled
                      ? `New data received for ${metric}`
                      : `${metric} exceeded threshold`
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Custom message included in alert notifications
                </p>
              </div>

              {/* ── Notification targets ── */}
              {notifyOptions.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground block">
                    Notify{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </label>
                  <NotificationTargetChips
                    options={notifyOptions}
                    selected={notifyTargets}
                    onToggle={(id) =>
                      setNotifyTargets((prev) =>
                        prev.includes(id)
                          ? prev.filter((t) => t !== id)
                          : [...prev, id],
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {notifyTargets.length === 0
                      ? "Alerts go to all channels subscribed to alert events"
                      : "Alerts from this monitor go only to the selected channels"}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="text-xs"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={submitting}
          >
            Create Monitor
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
