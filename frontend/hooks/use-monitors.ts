import useSWR from "swr";
import { useCallback } from "react";
import { fetcher } from "@/lib/fetcher";
import { toast } from "@/lib/toast-utils";

export interface Monitor {
  source_id: string;
  source_slug: string;
  source_name: string;
  metric: string;
  threshold: {
    id: string;
    min?: number | null;
    max?: number | null;
    severity: string;
    message?: string | null;
    notification_target_ids?: string[] | null;
  } | null;
  event: {
    id: string;
    severity: string;
    message: string | null;
    enabled: boolean;
    visualization: {
      panel_type: string;
      panel_config: Record<string, unknown>;
    } | null;
    notification_target_ids?: string[] | null;
  } | null;
  /** "Stream stopped" / data-stopped monitor — metric-less, source-level. */
  offline: {
    id: string;
    timeout_seconds: number;
    severity: string;
    enabled: boolean;
    notification_target_ids?: string[] | null;
  } | null;
  type: "threshold" | "event" | "both" | "offline";
  /** Connection monitor missing its table/time-column pin — the poller skips it. */
  unpinned?: boolean;
  /** Most recent poll outcome; null for offline monitors (tracked elsewhere). */
  health?: MonitorHealth | null;
  created_at: string;
}

export interface MonitorHealth {
  state: "working" | "skipped" | "failing" | "pending";
  reason: string | null;
  checked_at: string | null;
}

/**
 * A monitor's explicit notification targets, whichever record carries them
 * (PATCH keeps event/threshold in sync). null = default fan-out.
 */
export const monitorTargets = (m: Monitor): string[] | null =>
  m.event?.notification_target_ids ??
  m.threshold?.notification_target_ids ??
  m.offline?.notification_target_ids ??
  null;

export function useMonitors(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<{ monitors: Monitor[] }>(
    enabled ? "/api/monitors" : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    },
  );

  const createMonitor = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create monitor");
      }

      const result = await res.json();
      toast.success("Monitor created");
      mutate();
      return result;
    },
    [mutate],
  );

  const deleteMonitor = useCallback(
    async (sourceId: string, metric: string, offlineId?: string) => {
      try {
        const params = new URLSearchParams({
          source_id: sourceId,
          metric,
        });
        // Offline ("stream stopped") monitors are deleted by their unambiguous
        // rule id — their source_id is a slug that can be UUID-shaped, which
        // breaks slug/id resolution server-side.
        if (offlineId) params.set("offline_id", offlineId);
        const res = await fetch(`/api/monitors?${params.toString()}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete");
        toast.success("Monitor deleted");
        mutate();
      } catch {
        toast.error("Failed to delete monitor");
      }
    },
    [mutate],
  );

  /**
   * Update a monitor's notification targets in place (null = default
   * fan-out). Optimistically patches the cached monitor; rolls back and
   * rethrows on failure so the caller can surface the error.
   */
  const updateMonitorTargets = useCallback(
    async (monitor: Monitor, targetIds: string[] | null) => {
      const body: Record<string, unknown> = monitor.offline
        ? { offline_id: monitor.offline.id, notification_targets: targetIds }
        : {
            source_id: monitor.source_id,
            metric: monitor.metric,
            notification_targets: targetIds,
          };

      await mutate(
        async (current) => {
          const res = await fetch("/api/monitors", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Failed to update notifications");
          }
          return current;
        },
        {
          optimisticData: (current) => ({
            monitors: (current?.monitors ?? []).map((m: Monitor) => {
              const same = monitor.offline
                ? m.offline?.id === monitor.offline.id
                : m.source_id === monitor.source_id &&
                  m.metric === monitor.metric;
              if (!same) return m;
              return {
                ...m,
                threshold: m.threshold
                  ? { ...m.threshold, notification_target_ids: targetIds }
                  : null,
                event: m.event
                  ? { ...m.event, notification_target_ids: targetIds }
                  : null,
                offline: m.offline
                  ? { ...m.offline, notification_target_ids: targetIds }
                  : null,
              };
            }),
          }),
          rollbackOnError: true,
          populateCache: false,
          revalidate: true,
        },
      );
    },
    [mutate],
  );

  return {
    monitors: data?.monitors ?? [],
    isLoading,
    error,
    mutate,
    createMonitor,
    deleteMonitor,
    updateMonitorTargets,
  };
}
