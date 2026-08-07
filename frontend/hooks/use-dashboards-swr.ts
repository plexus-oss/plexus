import useSWR from "swr";
import { useCallback } from "react";
import type {
  DashboardListItem,
  Dashboard,
  CreateDashboardRequest,
  UpdateDashboardRequest,
} from "@/lib/types/dashboard";
import { toast } from "@/lib/toast-utils";
import { failFrom, optimisticMutation } from "./use-resource";

type DashboardList = { dashboards: DashboardListItem[] };

// Use the global SWR fetcher (from swr-provider) which properly throws on
// non-ok responses. The old local fetcher silently swallowed errors, so SWR
// never knew a request failed and would cache error bodies as valid data.

const SWR_KEY = "/api/dashboards";

/**
 * Hook for fetching dashboard list
 */
export function useDashboardsSwr() {
  const { data, error, isLoading, mutate } = useSWR<DashboardList>(SWR_KEY);

  const createDashboard = useCallback(
    async (req: CreateDashboardRequest) => {
      try {
        const res = await fetch("/api/dashboards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create dashboard");
        }

        const result = await res.json();
        const newDashboard: DashboardListItem = result.dashboard;

        // Patch the cache from the response; realtime invalidation covers
        // cross-client freshness, so no extra refetch.
        await mutate(
          (current) => ({
            dashboards: [...(current?.dashboards || []), newDashboard],
          }),
          { revalidate: false },
        );

        return newDashboard;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to create dashboard",
        );
        throw error;
      }
    },
    [mutate],
  );

  const deleteDashboard = useCallback(
    async (id: string) => {
      try {
        // Atomic optimistic removal: the item disappears immediately, SWR
        // rolls back if the DELETE fails, and concurrent revalidations can't
        // resurrect it mid-request. Callers can fire-and-forget this
        // mutation to navigate instantly.
        await mutate(
          ...optimisticMutation<DashboardList>(
            (current) => ({
              dashboards: (current?.dashboards || []).filter(
                (d) => d.id !== id,
              ),
            }),
            async () => {
              const res = await fetch(`/api/dashboards/${id}`, {
                method: "DELETE",
              });
              if (!res.ok) await failFrom(res, "Failed to delete dashboard");
            },
          ),
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to delete dashboard",
        );
        throw error;
      }
    },
    [mutate],
  );

  const duplicateDashboard = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/dashboards/${id}/duplicate`, {
          method: "POST",
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to duplicate dashboard");
        }

        const result = await res.json();
        const newDashboard: DashboardListItem = result.dashboard;

        // Patch the cache from the response — no refetch needed.
        await mutate(
          (current) => ({
            dashboards: [...(current?.dashboards || []), newDashboard],
          }),
          { revalidate: false },
        );

        return newDashboard;
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to duplicate dashboard",
        );
        throw error;
      }
    },
    [mutate],
  );

  const updateDashboard = useCallback(
    async (id: string, req: UpdateDashboardRequest) => {
      try {
        const res = await fetch(`/api/dashboards/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to update dashboard");
        }

        const result = await res.json();
        const updated: DashboardListItem = result.dashboard;

        // Patch the cache from the response — no refetch needed.
        await mutate(
          (current) => ({
            dashboards: (current?.dashboards || []).map((d) =>
              d.id === id ? { ...d, ...updated } : d,
            ),
          }),
          { revalidate: false },
        );

        return updated;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update dashboard",
        );
        throw error;
      }
    },
    [mutate],
  );

  return {
    dashboards: data?.dashboards || [],
    isLoading,
    error,
    createDashboard,
    deleteDashboard,
    duplicateDashboard,
    updateDashboard,
    mutate,
  };
}

/**
 * Hook for fetching a single dashboard
 */
export function useDashboardSwr(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ dashboard: Dashboard }>(
    id ? `/api/dashboards/${id}` : null,
  );

  const updateDashboard = useCallback(
    async (req: UpdateDashboardRequest) => {
      if (!id) return;

      try {
        const res = await fetch(`/api/dashboards/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to update dashboard");
        }

        const result = await res.json();
        await mutate({ dashboard: result.dashboard }, { revalidate: false });
        return result.dashboard;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update dashboard",
        );
        throw error;
      }
    },
    [id, mutate],
  );

  return {
    dashboard: data?.dashboard,
    isLoading,
    error,
    updateDashboard,
    mutate,
  };
}

// =============================================================================
// Dashboard Ancestors Hook
// =============================================================================

export interface BreadcrumbItem {
  id: string;
  name: string;
  icon: string | null;
  icon_url: string | null;
}

/**
 * Hook for fetching dashboard ancestor chain (for breadcrumbs)
 */
export function useDashboardAncestorsSwr(
  dashboardId: string | null,
  parentId: string | null,
) {
  const { data, error, isLoading } = useSWR<{ ancestors: BreadcrumbItem[] }>(
    parentId ? `/api/dashboards/${dashboardId}/ancestors` : null,
  );

  return {
    ancestors: data?.ancestors ?? [],
    isLoading,
    error,
  };
}
