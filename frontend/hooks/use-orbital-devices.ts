"use client";

/**
 * Orbital Devices Hook
 *
 * Wraps useSources() to expose devices with `norad_id` in metadata
 * as Satellite display shapes. TLE operations use /api/tle/* routes.
 * CRUD goes through useSources() directly.
 */

import { useMemo, useCallback } from "react";
import { toast } from "sonner";
import { useSources } from "@/hooks/use-sources";
import { sourceToSatellite } from "@/lib/satellites/convert";

export function useOrbitalDevices() {
  const { devices, isLoading, error, refresh } = useSources({ type: "device" });

  // Filter to satellite devices and map to Satellite shape
  const orbitalDevices = useMemo(() => {
    return devices
      .filter((d) => d.device_type === "satellite")
      .map(sourceToSatellite);
  }, [devices]);

  // Bulk refresh stale TLEs
  const refreshTles = useCallback(async (): Promise<{ refreshed: number }> => {
    const res = await fetch("/api/tle/refresh", { method: "POST" });
    const result = await res.json();

    if (!res.ok) {
      const msg = result.message || result.error || "Failed to refresh TLEs";
      toast.error(msg);
      throw new Error(msg);
    }

    if (result.refreshed > 0) {
      toast.success(`Refreshed ${result.refreshed} satellite TLE(s)`);
      await refresh();
    } else {
      toast.info("All TLEs are up to date");
    }

    return result;
  }, [refresh]);

  return {
    orbitalDevices,
    isLoading,
    error,
    refreshTles,
  };
}
