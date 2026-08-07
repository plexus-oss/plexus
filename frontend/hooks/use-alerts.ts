/**
 * Alerts Hook
 *
 * SWR-based hook for managing alerts with CRUD operations.
 */

import useSWR from "swr";
import { toast } from "sonner";
import type {
  Alert,
  AlertEvent,
  AlertStatus,
  LimitSeverity,
  AlertTriggerType,
  VerdictStats,
} from "@/lib/db/types";
import { fetcher } from "@/lib/fetcher";

export interface AlertFilters {
  status?: AlertStatus | AlertStatus[];
  severity?: LimitSeverity | LimitSeverity[];
  sourceId?: string | string[];
  triggerType?: AlertTriggerType;
  limit?: number;
  offset?: number;
  refreshInterval?: number;
  enabled?: boolean;
}

export interface AckOptions {
  silent?: boolean;
}

export interface UseAlertsResult {
  alerts: Alert[];
  counts: Record<AlertStatus, number>;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
  acknowledgeAlert: (
    alertId: string,
    options?: AckOptions,
  ) => Promise<Alert | null>;
  acknowledgeAll: () => Promise<number>;
  resolveAlert: (
    alertId: string,
    resolutionNotes?: string,
  ) => Promise<Alert | null>;
  reopenAlert: (alertId: string) => Promise<Alert | null>;
  deleteAlert: (alertId: string) => Promise<boolean>;
  addComment: (alertId: string, message: string) => Promise<boolean>;
}

export interface UseAlertDetailResult {
  alert: Alert | null;
  events: AlertEvent[];
  verdictStats: VerdictStats | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * Hook for fetching and managing alerts list
 */
export function useAlerts(filters?: AlertFilters): UseAlertsResult {
  // Build query string from filters
  const params = new URLSearchParams();
  if (filters?.status) {
    params.set(
      "status",
      Array.isArray(filters.status) ? filters.status.join(",") : filters.status,
    );
  }
  if (filters?.severity) {
    params.set(
      "severity",
      Array.isArray(filters.severity)
        ? filters.severity.join(",")
        : filters.severity,
    );
  }
  if (filters?.sourceId) {
    const sourceIds = Array.isArray(filters.sourceId)
      ? filters.sourceId.filter(Boolean)
      : [filters.sourceId];
    if (sourceIds.length > 0) {
      params.set("sourceId", sourceIds.join(","));
    }
  }
  if (filters?.triggerType) {
    params.set("triggerType", filters.triggerType);
  }
  if (filters?.limit) {
    params.set("limit", String(filters.limit));
  }
  if (filters?.offset) {
    params.set("offset", String(filters.offset));
  }

  const queryString = params.toString();
  const url = `/api/alerts${queryString ? `?${queryString}` : ""}`;

  // If enabled is explicitly false, pass null to skip fetching
  const shouldFetch = filters?.enabled !== false;

  const { data, error, mutate, isLoading } = useSWR<{
    alerts: Alert[];
    counts: Record<AlertStatus, number>;
  }>(shouldFetch ? url : null, fetcher, {
    refreshInterval: filters?.refreshInterval ?? 0,
  });

  const acknowledgeAlert = async (
    alertId: string,
    options: AckOptions = {},
  ): Promise<Alert | null> => {
    const { silent = false } = options;

    const emptyCounts: Record<AlertStatus, number> = {
      open: 0,
      acknowledged: 0,
      resolved: 0,
    };
    const optimistic = (
      current: { alerts: Alert[]; counts: Record<AlertStatus, number> } | undefined,
    ) => {
      const base = current ?? { alerts: [], counts: emptyCounts };
      const target = base.alerts.find((a) => a.id === alertId);
      const wasOpen = target?.status === "open";
      return {
        alerts: base.alerts.filter((a) => a.id !== alertId),
        counts: {
          ...base.counts,
          open: Math.max(0, base.counts.open - (wasOpen ? 1 : 0)),
          acknowledged: base.counts.acknowledged + (wasOpen ? 1 : 0),
        },
      };
    };

    try {
      const result = await mutate(
        async () => {
          const res = await fetch(`/api/alerts/${alertId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "acknowledge" }),
          });
          if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || "Failed to acknowledge alert");
          }
          // Let SWR revalidate from the server for the cache; the response
          // shape of this PATCH endpoint is different from the list endpoint.
          return undefined;
        },
        {
          optimisticData: optimistic,
          rollbackOnError: true,
          populateCache: false,
          revalidate: true,
        },
      );
      if (!silent) toast.success("Alert acknowledged");
      // result here is the revalidated list payload; return the updated alert
      // if it still exists (it won't in the dropdown's open-only view).
      return result?.alerts.find((a) => a.id === alertId) ?? null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to acknowledge alert";
      if (!silent) toast.error(message);
      return null;
    }
  };

  const acknowledgeAll = async (): Promise<number> => {
    const emptyCounts: Record<AlertStatus, number> = {
      open: 0,
      acknowledged: 0,
      resolved: 0,
    };
    const optimistic = (
      current: { alerts: Alert[]; counts: Record<AlertStatus, number> } | undefined,
    ) => {
      const base = current ?? { alerts: [], counts: emptyCounts };
      const openCount = base.alerts.filter((a) => a.status === "open").length;
      return {
        alerts: base.alerts.filter((a) => a.status !== "open"),
        counts: {
          ...base.counts,
          open: 0,
          acknowledged: base.counts.acknowledged + openCount,
        },
      };
    };

    try {
      let count = 0;
      await mutate(
        async () => {
          const res = await fetch("/api/alerts/acknowledge-all", {
            method: "POST",
          });
          if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.error || "Failed to acknowledge alerts");
          }
          const data = await res.json();
          count = data.count ?? 0;
          return undefined;
        },
        {
          optimisticData: optimistic,
          rollbackOnError: true,
          populateCache: false,
          revalidate: true,
        },
      );
      if (count > 0) {
        toast.success(
          count === 1 ? "1 alert marked as read" : `${count} alerts marked as read`,
        );
      }
      return count;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to acknowledge alerts";
      toast.error(message);
      return 0;
    }
  };

  const resolveAlert = async (
    alertId: string,
    resolutionNotes?: string,
  ): Promise<Alert | null> => {
    try {
      const res = await fetch(`/api/alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve",
          resolution_notes: resolutionNotes,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to resolve alert");
      }

      const { alert } = await res.json();
      toast.success("Alert resolved");
      mutate();
      return alert;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to resolve alert";
      toast.error(message);
      return null;
    }
  };

  const reopenAlert = async (alertId: string): Promise<Alert | null> => {
    try {
      const res = await fetch(`/api/alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen" }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to reopen alert");
      }

      const { alert } = await res.json();
      toast.success("Alert reopened");
      mutate();
      return alert;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to reopen alert";
      toast.error(message);
      return null;
    }
  };

  const deleteAlert = async (alertId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/alerts/${alertId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete alert");
      }

      toast.success("Alert deleted");
      mutate();
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete alert";
      toast.error(message);
      return false;
    }
  };

  const addComment = async (
    alertId: string,
    message: string,
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "comment", message }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to add comment");
      }

      toast.success("Comment added");
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to add comment";
      toast.error(message);
      return false;
    }
  };

  return {
    alerts: data?.alerts || [],
    counts: data?.counts || { open: 0, acknowledged: 0, resolved: 0 },
    isLoading,
    error: error || null,
    refresh: () => mutate(),
    acknowledgeAlert,
    acknowledgeAll,
    resolveAlert,
    reopenAlert,
    deleteAlert,
    addComment,
  };
}

/**
 * Hook for fetching a single alert with its event timeline
 */
export function useAlertDetail(alertId: string | null): UseAlertDetailResult {
  const { data, error, mutate, isLoading } = useSWR<{
    alert: Alert;
    events: AlertEvent[];
    verdict_stats?: VerdictStats;
  }>(alertId ? `/api/alerts/${alertId}` : null, fetcher);

  return {
    alert: data?.alert || null,
    events: data?.events || [],
    verdictStats: data?.verdict_stats || null,
    isLoading,
    error: error || null,
    refresh: () => mutate(),
  };
}
