"use client";

/**
 * Monitors Tab
 *
 * Unified view of all monitors (threshold limits + event monitors)
 * grouped by (source_id, metric).
 */

import { useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CreateButton } from "@/components/ui/create-button";
import { DeleteButton } from "@/components/ui/delete-button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Search,
  Gauge,
  Zap,
  ShieldCheck,
  X,
  WifiOff,
  AlertTriangle,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMonitors, monitorTargets } from "@/hooks/use-monitors";
import type { Monitor } from "@/hooks/use-monitors";
import { CreateMonitorDialog } from "@/components/monitors/create-monitor-dialog";
import {
  useNotificationTargetOptions,
  NotificationTargetChips,
  type NotificationTargetOption,
} from "@/components/monitors/notification-target-picker";
import { toast } from "@/lib/toast-utils";
import { SuggestedMonitorsSection } from "@/components/monitors/suggested-monitors-section";
import { formatDistanceToNow } from "date-fns";
import { ACTION_NEW_MONITOR } from "@/lib/shortcuts";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useListNavigation } from "@/hooks/use-list-navigation";

// =============================================================================
// CONSTANTS
// =============================================================================

const TYPE_CHIPS = [
  { value: "all", label: "All", icon: ShieldCheck },
  { value: "threshold", label: "Threshold", icon: Gauge },
  { value: "event", label: "Event", icon: Zap },
  { value: "both", label: "Both", icon: ShieldCheck },
] as const;

const TYPE_COLORS = {
  threshold: "bg-blue-500/10 text-blue-500",
  event: "bg-green-500/10 text-green-500",
  both: "bg-amber-500/10 text-amber-500",
  offline: "bg-purple-500/10 text-purple-500",
} as const;

const SEVERITY_BADGE = {
  critical: "bg-red-500/10 text-red-400",
  warning: "bg-amber-500/10 text-amber-400",
  info: "bg-blue-500/10 text-blue-400",
} as const;

// =============================================================================
// MAIN PAGE
// =============================================================================

type FilterType = "all" | "threshold" | "event" | "both";

/**
 * Stable, unique identity for a monitor row.
 *
 * Offline ("stream stopped") monitors are metric-less (`metric: ""`), so
 * `source_id::metric` collapses to `source_id::` and collides whenever a source
 * has more than one offline rule (or a slug that looks like another's id). That
 * non-unique React key triggers the "two children with the same key" warning and
 * breaks reconciliation — deletes succeed on the server but the row never leaves
 * the DOM. Offline rows carry a unique `offline.id`; everything else is already
 * uniquely keyed by `source_id::metric`.
 */
const monitorKey = (m: Monitor) =>
  m.offline ? `offline:${m.offline.id}` : `${m.source_id}::${m.metric}`;

export default function MonitorsPage() {
  const { monitors, isLoading, error, mutate, deleteMonitor, updateMonitorTargets } =
    useMonitors();
  const notifyOptions = useNotificationTargetOptions();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // selectedMonitorKey is derived directly from the URL (source of truth), so
  // dashboard limit pills can deep-link here (?monitor=<source_id>::<metric>)
  // and back/forward stays in sync without an effect.
  const selectedMonitorKey = searchParams.get("monitor");
  const setSelectedMonitorKey = useCallback(
    (key: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (key) params.set("monitor", key);
      else params.delete("monitor");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useHotkeys(
    [
      {
        key: ACTION_NEW_MONITOR,
        callback: () => setShowCreate(true),
        description: "New monitor",
        category: "action",
      },
    ],
    [setShowCreate],
  );

  const filteredMonitors = useMemo(() => {
    let result = monitors;

    if (filterType !== "all") {
      result = result.filter((m) => m.type === filterType);
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.source_name.toLowerCase().includes(q) ||
          m.metric.toLowerCase().includes(q),
      );
    }

    // Sort by newest first
    return [...result].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [monitors, filterType, search]);

  const { activeIndex, activeRef } = useListNavigation({
    items: filteredMonitors,
    onSelect: (m) => setSelectedMonitorKey(monitorKey(m)),
    onOpen: (m) => setSelectedMonitorKey(monitorKey(m)),
    enabled: true,
  });

  const selectedMonitor = useMemo(() => {
    if (!selectedMonitorKey) return null;
    return (
      monitors.find((m) => monitorKey(m) === selectedMonitorKey) || null
    );
  }, [monitors, selectedMonitorKey]);

  const handleDelete = useCallback(
    async (monitor: Monitor) => {
      const key = monitorKey(monitor);
      setDeletingKey(key);
      await deleteMonitor(monitor.source_id, monitor.metric, monitor.offline?.id);
      if (selectedMonitorKey === key) setSelectedMonitorKey(null);
      setDeletingKey(null);
    },
    [deleteMonitor, selectedMonitorKey, setSelectedMonitorKey],
  );

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col overflow-hidden p-2">
          <SuggestedMonitorsSection />

          {/* Filter Bar */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-7 h-8 w-48"
                />
              </div>

              <div className="w-px h-5 bg-border" />

              {/* Type Chips */}
              {TYPE_CHIPS.map((chip) => {
                const Icon = chip.icon;
                const active = filterType === chip.value;
                return (
                  <Button
                    key={chip.value}
                    variant={active ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilterType(chip.value as FilterType)}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] h-auto",
                      active
                        ? "bg-foreground text-background border-foreground hover:bg-foreground/90"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/50",
                    )}
                  >
                    <Icon className="h-2.5 w-2.5" />
                    {chip.label}
                  </Button>
                );
              })}

              {/* Count */}
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {filteredMonitors.length} monitor
                {filteredMonitors.length !== 1 ? "s" : ""}
              </span>
            </div>

            <CreateButton
              label="New Monitor"
              onClick={() => setShowCreate(true)}
              shortcut={ACTION_NEW_MONITOR}
            />
          </div>

          <div className="flex flex-1 gap-0 overflow-hidden relative">
            {/* Table */}
            <Card className="flex-1 overflow-hidden">
              <div className="h-full overflow-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Spinner className="h-5 w-5 text-muted-foreground" />
                  </div>
                ) : error ? (
                  <EmptyState
                    icon={Gauge}
                    title="Failed to load monitors"
                    description="Something went wrong loading your monitors"
                    className="h-full"
                  />
                ) : filteredMonitors.length === 0 ? (
                  <EmptyState
                    icon={Gauge}
                    title={
                      monitors.length === 0
                        ? "No monitors configured"
                        : "No matching monitors"
                    }
                    description={
                      monitors.length === 0
                        ? "Create a monitor to set thresholds or track events on your sources."
                        : "Try adjusting your search or filters"
                    }
                    action={
                      monitors.length === 0
                        ? {
                            label: "New Monitor",
                            onClick: () => setShowCreate(true),
                          }
                        : undefined
                    }
                    className="h-full"
                  />
                ) : (
                  <Table className="w-full">
                    <TableHeader className="bg-muted/50 sticky top-0 z-10">
                      <TableRow>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">
                          Type
                        </TableHead>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">
                          Source
                        </TableHead>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">
                          Metric
                        </TableHead>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">
                          Condition
                        </TableHead>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">
                          Notify
                        </TableHead>
                        <TableHead className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2">
                          Created
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMonitors.map((monitor, index) => {
                        const key = monitorKey(monitor);
                        const isSelected = selectedMonitorKey === key;
                        const isActive = activeIndex === index;

                        return (
                          <TableRow
                            key={key}
                            ref={
                              isActive
                                ? (activeRef as React.Ref<HTMLTableRowElement>)
                                : undefined
                            }
                            onClick={() => setSelectedMonitorKey(key)}
                            className={cn(
                              "border-b border-border/50 transition-colors cursor-pointer",
                              isSelected
                                ? "bg-accent"
                                : isActive
                                  ? "bg-accent/50"
                                  : "hover:bg-muted/50",
                            )}
                          >
                            {/* Type */}
                            <TableCell className="px-3 py-2.5">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                  TYPE_COLORS[monitor.type],
                                )}
                              >
                                {monitor.type === "event" ? (
                                  <Zap className="h-2.5 w-2.5" />
                                ) : monitor.type === "offline" ? (
                                  <WifiOff className="h-2.5 w-2.5" />
                                ) : (
                                  <Gauge className="h-2.5 w-2.5" />
                                )}
                                {monitor.type === "threshold"
                                  ? "Threshold"
                                  : monitor.type === "event"
                                    ? "Event"
                                    : monitor.type === "offline"
                                      ? "Stream stopped"
                                      : "Both"}
                              </span>
                              {monitor.unpinned && (
                                <span
                                  title="Not scanning — the metric column isn't pinned to a table. Delete this monitor and recreate it by picking the metric from the list."
                                  className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                                >
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  Not scanning
                                </span>
                              )}
                            </TableCell>

                            {/* Source */}
                            <TableCell className="px-3 py-2.5">
                              <span className="text-sm font-medium truncate max-w-[160px] block">
                                {monitor.source_name}
                              </span>
                            </TableCell>

                            {/* Metric */}
                            <TableCell className="px-3 py-2.5">
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                                {monitor.type === "offline"
                                  ? "any data"
                                  : monitor.metric}
                              </code>
                            </TableCell>

                            {/* Condition summary */}
                            <TableCell className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                {monitor.threshold && (
                                  <span>
                                    {monitor.threshold.min != null &&
                                      `< ${monitor.threshold.min}`}
                                    {monitor.threshold.min != null &&
                                      monitor.threshold.max != null &&
                                      " · "}
                                    {monitor.threshold.max != null &&
                                      `> ${monitor.threshold.max}`}
                                  </span>
                                )}
                                {monitor.threshold?.severity && (
                                  <span
                                    className={cn(
                                      "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                                      SEVERITY_BADGE[
                                        monitor.threshold
                                          .severity as keyof typeof SEVERITY_BADGE
                                      ] || SEVERITY_BADGE.info,
                                    )}
                                  >
                                    {monitor.threshold.severity}
                                  </span>
                                )}
                                {monitor.event && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
                                    <Zap className="h-2.5 w-2.5" />
                                    Every event
                                  </span>
                                )}
                                {monitor.offline && (
                                  <>
                                    <span>
                                      no data for{" "}
                                      {monitor.offline.timeout_seconds < 60
                                        ? `${monitor.offline.timeout_seconds}s`
                                        : `${Math.round(monitor.offline.timeout_seconds / 60)} min`}
                                    </span>
                                    <span
                                      className={cn(
                                        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                                        SEVERITY_BADGE[
                                          monitor.offline
                                            .severity as keyof typeof SEVERITY_BADGE
                                        ] || SEVERITY_BADGE.info,
                                      )}
                                    >
                                      {monitor.offline.severity}
                                    </span>
                                  </>
                                )}
                                {!monitor.threshold &&
                                  !monitor.event &&
                                  !monitor.offline &&
                                  "—"}
                              </div>
                            </TableCell>

                            {/* Notify — silent for default fan-out */}
                            <TableCell className="px-3 py-2.5">
                              <NotifyIndicator
                                targets={monitorTargets(monitor)}
                                options={notifyOptions}
                              />
                            </TableCell>

                            {/* Created */}
                            <TableCell className="px-3 py-2.5">
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                {formatDistanceToNow(
                                  new Date(monitor.created_at),
                                  { addSuffix: true },
                                )}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </Card>

            {/* Detail Panel */}
            <AnimatePresence mode="wait">
              {selectedMonitor && (
                <MonitorDetailPanel
                  monitor={selectedMonitor}
                  notifyOptions={notifyOptions}
                  onUpdateTargets={updateMonitorTargets}
                  deleting={deletingKey === monitorKey(selectedMonitor)}
                  onDelete={() => handleDelete(selectedMonitor)}
                  onClose={() => setSelectedMonitorKey(null)}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <CreateMonitorDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => mutate()}
      />
    </>
  );
}

// =============================================================================
// NOTIFY INDICATOR
// =============================================================================

/** Muted routing hint for a table row; renders nothing on default fan-out. */
function NotifyIndicator({
  targets,
  options,
}: {
  targets: string[] | null;
  options: NotificationTargetOption[];
}) {
  if (!targets || targets.length === 0) return null;
  const label =
    targets.length === 1
      ? `→ ${options.find((o) => o.id === targets[0])?.label ?? "1 channel"}`
      : `${targets.length} channels`;
  return (
    <span className="text-[10px] text-muted-foreground truncate max-w-[140px] block">
      {label}
    </span>
  );
}

// =============================================================================
// DETAIL PANEL
// =============================================================================

function MonitorDetailPanel({
  monitor,
  notifyOptions,
  onUpdateTargets,
  deleting,
  onDelete,
  onClose,
}: {
  monitor: Monitor;
  notifyOptions: NotificationTargetOption[];
  onUpdateTargets: (m: Monitor, targetIds: string[] | null) => Promise<void>;
  deleting: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  const typeLabel =
    monitor.type === "threshold"
      ? "Threshold"
      : monitor.type === "event"
        ? "Event"
        : "Both";

  // Auto-save chip toggles; selection reads from the (optimistically updated)
  // SWR cache via the monitor prop, so no local selection state to drift.
  const [savingTargets, setSavingTargets] = useState(false);
  const targets = monitorTargets(monitor) ?? [];
  const toggleTarget = async (id: string) => {
    const next = targets.includes(id)
      ? targets.filter((t) => t !== id)
      : [...targets, id];
    setSavingTargets(true);
    try {
      await onUpdateTargets(monitor, next.length > 0 ? next : null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update notifications",
      );
    } finally {
      setSavingTargets(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed right-0 top-0 bottom-0 w-[720px] bg-background border-l flex flex-col z-50"
      >
        {/* Header */}
        <div className="flex-shrink-0 border-b">
          <div className="flex items-start justify-between p-4">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  monitor.type === "event"
                    ? "bg-green-500/10"
                    : monitor.type === "both"
                      ? "bg-amber-500/10"
                      : "bg-blue-500/10",
                )}
              >
                {monitor.type === "event" ? (
                  <Zap className="h-5 w-5 text-green-400" />
                ) : (
                  <Gauge className="h-5 w-5 text-blue-400" />
                )}
              </div>
              <div>
                <h2 className="font-semibold">{monitor.metric}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                      TYPE_COLORS[monitor.type],
                    )}
                  >
                    {typeLabel}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {monitor.source_name}
                  </span>
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-8 w-8"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Threshold Details */}
          {monitor.threshold && (
            <div className="space-y-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Threshold
              </span>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Min
                  </div>
                  <div className="text-lg font-mono font-semibold">
                    {monitor.threshold.min != null
                      ? monitor.threshold.min
                      : "—"}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Max
                  </div>
                  <div className="text-lg font-mono font-semibold">
                    {monitor.threshold.max != null
                      ? monitor.threshold.max
                      : "—"}
                  </div>
                </div>
              </div>
              {monitor.threshold.severity && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    Severity
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                      SEVERITY_BADGE[
                        monitor.threshold
                          .severity as keyof typeof SEVERITY_BADGE
                      ] || SEVERITY_BADGE.info,
                    )}
                  >
                    {monitor.threshold.severity}
                  </span>
                </div>
              )}
              {monitor.threshold.message && (
                <p className="text-xs text-muted-foreground">
                  {monitor.threshold.message}
                </p>
              )}
            </div>
          )}

          {/* Event Details */}
          {monitor.event && (
            <div className="space-y-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Event Monitor
              </span>
              <p className="text-xs text-muted-foreground">
                Alerts on every new data point for this metric.
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  Severity
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                    SEVERITY_BADGE[
                      monitor.event.severity as keyof typeof SEVERITY_BADGE
                    ] || SEVERITY_BADGE.info,
                  )}
                >
                  {monitor.event.severity}
                </span>
              </div>
              {monitor.event.message && (
                <p className="text-xs text-muted-foreground">
                  {monitor.event.message}
                </p>
              )}
            </div>
          )}

          {/* Notifications */}
          {notifyOptions.length > 0 && (
            <div className="pt-4 border-t border-border/50 space-y-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Notifications
              </span>
              <NotificationTargetChips
                options={notifyOptions}
                selected={targets}
                onToggle={toggleTarget}
                disabled={savingTargets}
              />
              <p className="text-xs text-muted-foreground">
                {targets.length === 0
                  ? "All subscribed channels"
                  : "Only the selected channels receive alerts from this monitor"}
              </p>
            </div>
          )}

          {/* Created */}
          <div className="pt-4 border-t border-border/50">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Details
            </span>
            <div className="grid grid-cols-2 gap-3 mt-2 text-xs">
              <div>
                <span className="text-[10px] text-muted-foreground">
                  Created
                </span>
                <div className="mt-0.5">
                  {formatDistanceToNow(new Date(monitor.created_at), {
                    addSuffix: true,
                  })}
                </div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">
                  Source
                </span>
                <div className="mt-0.5">{monitor.source_name}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex-shrink-0 border-t p-4">
          <DeleteButton
            label="Delete Monitor"
            entityName={monitor.metric}
            onConfirm={onDelete}
            loading={deleting}
          />
        </div>
      </motion.div>
    </>
  );
}
