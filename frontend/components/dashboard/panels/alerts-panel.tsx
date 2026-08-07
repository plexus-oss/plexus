"use client";

/**
 * Alerts Panel — compact feed of active alerts.
 *
 * Two data paths:
 *   1. Built-in alerts system (default) — `useAlerts()`
 *   2. Connection query — when `panel.dataSource` is a connection source,
 *      rows from any SQL are mapped into the same Alert shape + UI
 *
 * Rendered with the shared LogRow + LogPanelHeader primitives so it matches
 * Logs / Device Events / Activity. The full /alerts page keeps its richer
 * table; inside a dense dashboard panel the feed reads better.
 *
 * Click a row → /alerts?selected=<id>. `config.clickUrlColumn` overrides the
 * destination (connection mode). Source scope is inherited from the dashboard
 * unless the panel sets its own sourceId. (Alerts are not time-windowed — an
 * alert feed shows what's currently open regardless of the dashboard range.)
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useAlerts } from "@/hooks/use-alerts";
import { usePanelData } from "@/hooks/use-panel-data";
import { LogRow } from "@/components/dashboard/panels/log-row";
import { LogPanelHeader } from "@/components/dashboard/panels/log-panel-header";
import {
  useDashboardFilters,
  useDashboardVariables,
} from "@/components/dashboard/dashboard-state-context";
import { resolveScopeSourceId } from "@/lib/dashboard/resolve-source-scope";
import { cn } from "@/lib/utils";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import type { Alert, AlertStatus, LimitSeverity } from "@/lib/db/types";
import type { LogRowChip } from "@/components/dashboard/panels/log-row";

const SEVERITY_DOT: Record<LimitSeverity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
};

const STATUS_META: Record<AlertStatus, { color: string; label: string }> = {
  open: { color: "text-foreground/70", label: "Open" },
  acknowledged: { color: "text-amber-400", label: "Ack" },
  resolved: { color: "text-muted-foreground", label: "Resolved" },
};

interface AlertsPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

interface AlertsPanelConfig {
  sourceId?: string;
  showResolved?: boolean;
  maxItems?: number;
  showSourceName?: boolean;
  /** Column whose value is used as the click URL (connection mode). */
  clickUrlColumn?: string;
}

interface ConnectionAlertRow {
  id?: string | null;
  source_slug?: string | null;
  source_id?: string | null;
  severity?: string | null;
  metric?: string | null;
  threshold?: number | string | null;
  value?: number | string | null;
  bound?: string | null;
  message?: string | null;
  triggered_at?: string | null;
  created_at?: string | null;
  status?: string | null;
  trigger_type?: string | null;
}

function normalizeSeverity(s: unknown): LimitSeverity {
  const v = String(s ?? "info").toLowerCase();
  if (v === "critical" || v === "error") return "critical";
  if (v === "warning" || v === "warn") return "warning";
  return "info";
}

function normalizeStatus(s: unknown): AlertStatus {
  const v = String(s ?? "open").toLowerCase();
  if (v === "resolved" || v === "closed") return "resolved";
  if (v === "acknowledged" || v === "ack") return "acknowledged";
  return "open";
}

function rowToAlert(row: ConnectionAlertRow, idx: number): Alert {
  const valueNum =
    row.value == null
      ? 0
      : typeof row.value === "number"
        ? row.value
        : Number(row.value);
  const thresholdNum =
    row.threshold == null
      ? null
      : typeof row.threshold === "number"
        ? row.threshold
        : Number(row.threshold);
  return {
    id: String(row.id ?? `row-${idx}`),
    source_id: String(row.source_slug ?? row.source_id ?? ""),
    severity: normalizeSeverity(row.severity),
    metric: String(row.metric ?? row.message ?? "alert"),
    trigger_type: (row.trigger_type ??
      "limit_violation") as Alert["trigger_type"],
    value: Number.isFinite(valueNum) ? valueNum : 0,
    threshold: Number.isFinite(thresholdNum as number)
      ? (thresholdNum as number)
      : null,
    bound: (row.bound as "max" | "min" | null) ?? "max",
    triggered_at: String(
      row.triggered_at ?? row.created_at ?? new Date().toISOString(),
    ),
    status: normalizeStatus(row.status),
  } as Alert;
}

export function AlertsPanel({ panel }: AlertsPanelProps) {
  const router = useRouter();
  const config = (panel.config || {}) as AlertsPanelConfig;
  const {
    sourceId: configSourceId,
    showResolved = false,
    maxItems = 20,
    showSourceName = !configSourceId,
    clickUrlColumn,
  } = config;

  // Inherit the dashboard-level source filter unless the panel sets its own.
  const { filters } = useDashboardFilters();
  const { values: variableValues } = useDashboardVariables();
  const sourceId = resolveScopeSourceId({
    panelSourceId: configSourceId,
    filters,
    variableValues,
  });

  const statusFilter = showResolved
    ? ["open", "acknowledged", "resolved"]
    : ["open", "acknowledged"];

  // Branch on data source: connection SQL rows vs built-in alerts system.
  const panelData = usePanelData({ panel });
  const useConnection = panelData.sourceType === "connection";

  const builtIn = useAlerts({
    sourceId,
    status: statusFilter as AlertStatus[],
    limit: maxItems,
    enabled: !useConnection,
    // Poll so alerts that fire after the panel mounts actually appear.
    // SWR dedupes by cache key, so other panels asking for the same
    // sourceId share this single fetch — cheap.
    refreshInterval: 5000,
  });

  const connectionRows = panelData.connectionMeta?.rows as
    | ConnectionAlertRow[]
    | undefined;

  const connectionAlerts: Alert[] = useMemo(() => {
    if (!useConnection || !connectionRows) return [];
    return connectionRows
      .map((row, i) => rowToAlert(row, i))
      .filter((a) => (showResolved ? true : a.status !== "resolved"))
      .slice(0, maxItems);
  }, [useConnection, connectionRows, showResolved, maxItems]);

  const alerts = useConnection ? connectionAlerts : builtIn.alerts;
  const isLoading = useConnection
    ? panelData.isLoading && connectionAlerts.length === 0
    : builtIn.isLoading;

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search.trim()) return alerts;
    const q = search.toLowerCase();
    return alerts.filter(
      (a) =>
        a.metric?.toLowerCase().includes(q) ||
        a.source_id?.toLowerCase().includes(q) ||
        a.severity?.toLowerCase().includes(q),
    );
  }, [alerts, search]);

  const handleAlertClick = (alertId: string) => {
    if (useConnection && clickUrlColumn && connectionRows) {
      const match = connectionRows.find((r) => String(r.id ?? "") === alertId);
      const url = match
        ? (match as Record<string, unknown>)[clickUrlColumn]
        : null;
      if (typeof url === "string" && url) {
        router.push(url);
        return;
      }
    }
    router.push(`/alerts?selected=${alertId}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-4 gap-2">
        <AlertTriangle className="h-8 w-8 text-muted-foreground/40" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">No alerts</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            {sourceId
              ? "This device is operating normally"
              : "All systems operational"}
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
        total={alerts.length}
      />

      <div className="flex-1 overflow-auto min-h-0">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
            No matches for &ldquo;{search}&rdquo;
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filtered.map((alert) => {
              const status =
                STATUS_META[alert.status as AlertStatus] ?? STATUS_META.open;
              const triggerDesc =
                alert.trigger_type === "event"
                  ? "New event"
                  : `${alert.bound ?? ""} limit violation`.trim();

              const valueText =
                typeof alert.value === "number"
                  ? alert.value.toFixed(2)
                  : String(alert.value);
              const chips: LogRowChip[] = [
                {
                  key:
                    alert.threshold != null
                      ? `${valueText} / ${alert.threshold}`
                      : valueText,
                },
              ];
              if (showSourceName && alert.source_id) {
                chips.unshift({ key: alert.source_id });
              }

              return (
                <LogRow
                  key={alert.id}
                  dotClassName={
                    SEVERITY_DOT[alert.severity as LimitSeverity] ??
                    SEVERITY_DOT.info
                  }
                  pulse={alert.status === "open"}
                  title={alert.metric}
                  description={triggerDesc}
                  chips={chips}
                  trailing={
                    <span
                      className={cn(
                        "text-[10px] shrink-0 capitalize",
                        status.color,
                      )}
                    >
                      {status.label}
                    </span>
                  }
                  timestamp={alert.triggered_at}
                  onClick={() => handleAlertClick(alert.id)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
