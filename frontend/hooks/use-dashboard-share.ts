import useSWR from "swr";
import { useCallback } from "react";
import type {
  DashboardShareLink,
  DashboardPermission,
  DashboardViewAnalytics,
  ShareLinkAccess,
} from "@/lib/db/types";
import { toast } from "@/lib/toast-utils";
import { fetcher } from "@/lib/fetcher";

export interface ShareLinkWithUrl extends DashboardShareLink {
  url: string;
}

interface ShareData {
  shareLinks: DashboardShareLink[];
  permissions: DashboardPermission[];
}

/**
 * Hook for managing dashboard share links and permissions
 */
export function useDashboardShare(dashboardId: string) {
  const { data, error, isLoading, mutate } = useSWR<ShareData>(
    dashboardId ? `/api/dashboards/${dashboardId}/share` : null,
    fetcher
  );

  const createShareLink = useCallback(
    async (options?: {
      name?: string;
      accessLevel?: ShareLinkAccess;
      expiresAt?: string;
      maxViews?: number;
      password?: string;
    }): Promise<ShareLinkWithUrl> => {
      try {
        const res = await fetch(`/api/dashboards/${dashboardId}/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "link",
            ...options,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create share link");
        }

        const result = await res.json();
        await mutate();
        return result.shareLink;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to create share link"
        );
        throw error;
      }
    },
    [dashboardId, mutate]
  );

  const revokeShareLink = useCallback(
    async (linkId: string) => {
      try {
        const res = await fetch(
          `/api/dashboards/${dashboardId}/share?linkId=${linkId}`,
          {
            method: "DELETE",
          }
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to revoke share link");
        }

        await mutate();
        toast.success("Share link revoked");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to revoke share link"
        );
        throw error;
      }
    },
    [dashboardId, mutate]
  );

  const updateShareLink = useCallback(
    async (
      linkId: string,
      updates: {
        name?: string | null;
        expiresAt?: string | null;
        maxViews?: number | null;
      }
    ) => {
      try {
        const res = await fetch(`/api/dashboards/${dashboardId}/share`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            linkId,
            ...updates,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to update share link");
        }

        await mutate();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update share link"
        );
        throw error;
      }
    },
    [dashboardId, mutate]
  );

  const inviteUser = useCallback(
    async (email: string, accessLevel: ShareLinkAccess = "view") => {
      try {
        const res = await fetch(`/api/dashboards/${dashboardId}/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "permission",
            email,
            accessLevel,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to invite user");
        }

        const result = await res.json();
        await mutate();
        toast.success(`Invited ${email}`);
        return result.permission;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to invite user"
        );
        throw error;
      }
    },
    [dashboardId, mutate]
  );

  /** Grant access to an org member or an external email. */
  const addGrant = useCallback(
    async (
      grantee: { userId?: string; email?: string },
      accessLevel: ShareLinkAccess = "view",
    ) => {
      try {
        const res = await fetch(`/api/dashboards/${dashboardId}/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "permission",
            ...grantee,
            accessLevel,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to grant access");
        }
        const result = await res.json();
        await mutate();
        return result.permission;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to grant access",
        );
        throw error;
      }
    },
    [dashboardId, mutate],
  );

  const removePermission = useCallback(
    async (permissionId: string) => {
      try {
        const res = await fetch(
          `/api/dashboards/${dashboardId}/share?permissionId=${permissionId}`,
          {
            method: "DELETE",
          }
        );

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to remove permission");
        }

        await mutate();
        toast.success("Access removed");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to remove permission"
        );
        throw error;
      }
    },
    [dashboardId, mutate]
  );

  const updatePermission = useCallback(
    async (permissionId: string, accessLevel: ShareLinkAccess) => {
      try {
        const res = await fetch(`/api/dashboards/${dashboardId}/share`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            permissionId,
            accessLevel,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to update permission");
        }

        await mutate();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update permission"
        );
        throw error;
      }
    },
    [dashboardId, mutate]
  );

  return {
    shareLinks: data?.shareLinks || [],
    permissions: data?.permissions || [],
    isLoading,
    error,
    createShareLink,
    revokeShareLink,
    updateShareLink,
    inviteUser,
    addGrant,
    removePermission,
    updatePermission,
    refresh: mutate,
  };
}

/**
 * Hook for fetching dashboard view analytics
 */
export function useDashboardAnalytics(dashboardId: string, days: number = 30) {
  const { data, error, isLoading, mutate } = useSWR<{
    analytics: DashboardViewAnalytics;
  }>(
    dashboardId ? `/api/dashboards/${dashboardId}/analytics?days=${days}` : null,
    fetcher,
    {
      refreshInterval: 60000, // Refresh every minute
    }
  );

  return {
    analytics: data?.analytics,
    isLoading,
    error,
    refresh: mutate,
  };
}
