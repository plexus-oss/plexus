"use client";

/**
 * SATCAT Hook
 *
 * Fetches satellite catalog metadata (object type, launch info, orbit class,
 * decay status) from CelesTrak's SATCAT via the `/api/tle/satcat` proxy. Free
 * public data keyed by NORAD catalog number — no external connection required.
 *
 * Fetches are conditional on `enabled` — callers should only enable when the
 * data is actually visible (e.g. the detail sheet is open).
 */

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

export interface SatcatRecord {
  object_name: string;
  object_type: "PAYLOAD" | "ROCKET BODY" | "DEBRIS" | "UNKNOWN";
  norad_id: number;
  intl_designator: string | null;
  country: string | null;
  launch_date: string | null;
  launch_site: string | null;
  decay_date: string | null;
  rcs_size: "SMALL" | "MEDIUM" | "LARGE" | null;
  period: number | null;
  apogee: number | null;
  perigee: number | null;
  inclination: number | null;
}

interface UseSatcatOptions {
  /** Only fetch when true. Use this to defer fetches until the sheet is visible. */
  enabled?: boolean;
}

export function useSatcat(noradId: number | null, options?: UseSatcatOptions) {
  const shouldFetch = options?.enabled ?? true;

  const { data, isLoading } = useSWR<SatcatRecord>(
    shouldFetch && noradId ? `/api/tle/satcat?norad_id=${noradId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 300000 },
  );

  return {
    satcatInfo: data ?? null,
    isLoadingSatcat: isLoading,
  };
}
