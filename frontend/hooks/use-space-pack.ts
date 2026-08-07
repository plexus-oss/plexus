"use client";

import { useMemo } from "react";
import { useSources } from "@/hooks/use-sources";

/**
 * Whether this org's space/orbital surface should be offered (satellite
 * sources, orbital panel types). Auto-detected from the org's own sources —
 * no flag infrastructure: if you have satellite sources, you see orbital
 * tools; if not, they stay out of the way. Renderers never check this
 * (existing dashboards always render).
 */
export function useSpacePack(): boolean {
  const { devices } = useSources();
  return useMemo(
    () => devices.some((d) => d.device_type === "satellite"),
    [devices],
  );
}
