"use client";

import type { DashboardIconAsset } from "@/lib/db/types";
import { toast } from "@/lib/toast-utils";
import { useResource } from "./use-resource";

const SWR_KEY = "/api/org/icon-library";

/**
 * Hook for the org-wide dashboard icon library: previously uploaded icon
 * images that can be reused across dashboards. The SWR provider clears
 * /api/* cache entries on org switch, so no extra org handling is needed.
 *
 * List + delete come from the canonical `useResource` CRUD hook
 * (docs/STANDARDS.md §4) with optimistic removal; upload stays bespoke
 * because it posts FormData rather than JSON.
 */
export function useOrgIconsSwr(enabled = true) {
  const r = useResource<DashboardIconAsset, never, never>({
    path: SWR_KEY,
    listKey: "icons",
    itemKey: "icon",
    label: "image",
    enabled,
    toast,
  });

  const uploadIcon = async (file: File): Promise<DashboardIconAsset> => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(SWR_KEY, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to upload image");
      }

      const result = await res.json();
      const asset: DashboardIconAsset = result.icon;

      await r.refresh(
        (current) => ({ icons: [asset, ...(current?.icons || [])] }),
        { revalidate: true },
      );

      return asset;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload image",
      );
      throw error;
    }
  };

  return {
    icons: r.items,
    error: r.error,
    isLoading: r.isLoading,
    uploadIcon,
    deleteIcon: r.remove,
  };
}
