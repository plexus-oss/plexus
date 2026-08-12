"use client";

/**
 * Alerts Page
 *
 * A clean table view of alerts with a beautiful detail drawer
 * featuring an events timeline.
 */

import { useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Search } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useAlerts, useAlertDetail } from "@/hooks/use-alerts";
import { useSource } from "@/hooks/use-sources";
import { useSourceContext } from "@/hooks/use-source-context";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AlertStatus } from "@/lib/db/types";
import {
  alertSummary,
  type AlertSourceFields,
} from "@/lib/alerts/event-summary";
import { EntityActions } from "@/components/ui/entity-actions";
import { AlertStoryPanel } from "@/components/alerts/alert-story-panel";
import { useRole } from "@/hooks/use-role";

// =============================================================================
// CONSTANTS
// =============================================================================

const STATUS_CONFIG = {
  open: { color: "text-foreground/70", bg: "bg-foreground/70", label: "Open" },
  acknowledged: {
    color: "text-amber-400",
    bg: "bg-amber-500",
    label: "Acknowledged",
  },
  resolved: {
    color: "text-muted-foreground",
    bg: "bg-muted-foreground/50",
    label: "Resolved",
  },
};

// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

export default function AlertsPage() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<AlertStatus | "all">("all");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // selectedAlertId is derived directly from the URL (source of truth), so it
  // stays in sync with browser back/forward without an effect.
  const selectedAlertId = searchParams.get("selected");
  const setSelectedAlertId = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("selected", id);
      else params.delete("selected");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const [contextMenuAlertId, setContextMenuAlertId] = useState<string | null>(
    null,
  );
  const { role } = useRole();

  const {
    alerts,
    counts,
    isLoading,
    refresh,
    acknowledgeAlert,
    resolveAlert,
    reopenAlert,
    deleteAlert,
    addComment,
  } = useAlerts({
    status: activeTab === "all" ? undefined : activeTab,
  });

  const selectedAlert = useMemo(
    () => alerts.find((a) => a.id === selectedAlertId) || null,
    [alerts, selectedAlertId],
  );

  const { source: selectedSource } = useSource(
    selectedAlert?.source_id ?? null,
  );
  const { context: sourceContext, createNote } = useSourceContext(
    selectedAlert?.source_id ?? null,
  );

  const { events, verdictStats } = useAlertDetail(selectedAlertId);

  const { activeIndex, activeRef } = useListNavigation({
    items: alerts,
    onSelect: (alert) => setSelectedAlertId(alert.id),
    onOpen: (alert) => setSelectedAlertId(alert.id),
    enabled: true,
  });

  const filteredAlerts = useMemo(() => {
    if (!search) return alerts;
    const searchLower = search.toLowerCase();
    return alerts.filter((alert) => {
      const src = alert as AlertSourceFields;
      return (
        alert.metric.toLowerCase().includes(searchLower) ||
        alert.trigger_type.toLowerCase().includes(searchLower) ||
        (src.source_slug ?? "").toLowerCase().includes(searchLower) ||
        (src.source_name ?? "").toLowerCase().includes(searchLower)
      );
    });
  }, [alerts, search]);

  const handleAction = useCallback(
    async (alertId: string, action: "acknowledge" | "resolve" | "reopen") => {
      switch (action) {
        case "acknowledge":
          await acknowledgeAlert(alertId);
          break;
        case "resolve":
          await resolveAlert(alertId);
          break;
        case "reopen":
          await reopenAlert(alertId);
          break;
      }
      refresh();
    },
    [acknowledgeAlert, resolveAlert, reopenAlert, refresh],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex flex-col overflow-hidden p-2">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 h-8 w-48"
              />
            </div>
            <div className="flex items-center gap-4 border-b border-border/40 -mb-px self-stretch">
              {[
                { id: "all", label: "All" },
                { id: "open", label: "Open", count: counts.open },
                {
                  id: "acknowledged",
                  label: "Acknowledged",
                  count: counts.acknowledged,
                },
                { id: "resolved", label: "Resolved", count: counts.resolved },
              ].map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id as AlertStatus | "all")}
                    className={cn(
                      "relative text-xs font-medium h-8 inline-flex items-center gap-1.5 transition-colors border-b -mb-px",
                      isActive
                        ? "text-foreground border-foreground"
                        : "text-muted-foreground hover:text-foreground border-transparent",
                    )}
                  >
                    {tab.label}
                    {tab.count !== undefined && tab.count > 0 && (
                      <span
                        className={cn(
                          "tabular-nums text-[10px]",
                          isActive
                            ? "text-muted-foreground"
                            : "text-muted-foreground/70",
                        )}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex flex-1 min-h-0 gap-0 overflow-hidden relative">
          {/* Table */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="h-full overflow-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Spinner className="h-5 w-5 text-muted-foreground" />
                </div>
              ) : filteredAlerts.length === 0 ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="No alerts"
                  description={
                    search
                      ? "No alerts match your search"
                      : activeTab !== "all"
                        ? `No ${activeTab} alerts`
                        : "Alerts will appear when anomalies are detected"
                  }
                  className="h-full"
                />
              ) : (
                <Table className="w-full">
                  <TableHeader className="bg-background sticky top-0 z-10 [&_tr]:border-b [&_tr]:border-border/40">
                    <TableRow>
                      <TableHead className="text-left text-xs font-medium text-muted-foreground pl-4 pr-3 py-1.5">
                        Alert
                      </TableHead>
                      <TableHead className="text-left text-xs font-medium text-muted-foreground px-3 py-1.5">
                        Source
                      </TableHead>
                      <TableHead className="text-left text-xs font-medium text-muted-foreground px-3 py-1.5">
                        Triggered
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAlerts.map((alert, index) => {
                      const status =
                        STATUS_CONFIG[alert.status as AlertStatus] ||
                        STATUS_CONFIG.open;
                      const isSelected = selectedAlertId === alert.id;
                      const isActive = activeIndex === index;
                      const edgeColor =
                        alert.severity === "critical"
                          ? "border-l-red-500"
                          : alert.severity === "warning"
                            ? "border-l-amber-500"
                            : "border-l-transparent";

                      return (
                        <EntityActions
                          key={alert.id}
                          entityType="alert"
                          entity={{ id: alert.id, name: alert.metric }}
                          role={role}
                          handlers={{
                            "action-acknowledge-alert": () => {
                              acknowledgeAlert(alert.id);
                              refresh();
                            },
                            "action-delete-alert": () => {
                              deleteAlert(alert.id);
                              refresh();
                            },
                          }}
                          open={contextMenuAlertId === alert.id}
                          onOpenChange={(open) => {
                            setContextMenuAlertId(open ? alert.id : null);
                          }}
                        >
                          <TableRow
                            ref={
                              isActive
                                ? (activeRef as React.Ref<HTMLTableRowElement>)
                                : undefined
                            }
                            onClick={() => setSelectedAlertId(alert.id)}
                            className={cn(
                              "border-b border-border/40 border-l-2 transition-colors cursor-pointer",
                              edgeColor,
                              isSelected
                                ? "bg-accent"
                                : isActive
                                  ? "bg-accent/30"
                                  : "hover:bg-muted/30",
                            )}
                          >
                            {/* Alert */}
                            <TableCell className="pl-4 pr-3 py-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full flex-shrink-0",
                                    status.bg,
                                    alert.status === "open" && "animate-pulse",
                                  )}
                                  aria-label={status.label}
                                />
                                <span className="text-xs truncate max-w-[420px]">
                                  {alertSummary(alert)}
                                </span>
                              </div>
                            </TableCell>

                            {/* Source */}
                            <TableCell className="px-3 py-1.5">
                              <span className="text-xs font-mono text-muted-foreground truncate max-w-[180px] inline-block align-middle">
                                {(alert as AlertSourceFields).source_name ||
                                  (alert as AlertSourceFields).source_slug ||
                                  "—"}
                              </span>
                            </TableCell>

                            {/* Triggered */}
                            <TableCell className="px-3 py-1.5">
                              <span
                                className="text-[10px] text-muted-foreground tabular-nums"
                                title={new Date(
                                  alert.triggered_at,
                                ).toISOString()}
                              >
                                {formatDistanceToNow(
                                  new Date(alert.triggered_at),
                                  { addSuffix: true },
                                )}
                              </span>
                            </TableCell>
                          </TableRow>
                        </EntityActions>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>

          </div>

          {/* Detail Panel */}
          <AnimatePresence mode="wait">
            {selectedAlert && (
              <AlertStoryPanel
                alert={selectedAlert}
                events={events}
                verdictStats={verdictStats}
                source={selectedSource}
                sourceContext={sourceContext}
                onClose={() => setSelectedAlertId(null)}
                onAction={(action) => handleAction(selectedAlert.id, action)}
                onAddComment={async (message) => {
                  const success = await addComment(selectedAlert.id, message);
                  if (success) refresh();
                  return success;
                }}
                onResolveWithContext={async (notes, saveCtx) => {
                  await resolveAlert(selectedAlert.id, notes || undefined);
                  if (saveCtx && notes && selectedAlert.source_id) {
                    await createNote({
                      name: `Resolution: ${selectedAlert.metric}`,
                      content: notes,
                    });
                  }
                  refresh();
                }}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
