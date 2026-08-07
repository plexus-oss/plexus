"use client";

/**
 * Registers a panel's timestamps with the dashboard interaction context so
 * the shared time scrubber knows what points exist. Side-effect only.
 */

import { useEffect, useMemo } from "react";
import type { TelemetryData } from "@/components/dashboard/telemetry-provider";
import { useDashboardInteraction } from "@/components/dashboard/dashboard-interaction-context";

export function useRegisterPanelTimestamps(
  panelId: string,
  data: TelemetryData,
): void {
  const { registerPanelTimestamps, unregisterPanelTimestamps } =
    useDashboardInteraction();

  const timestamps = useMemo(() => {
    const ts: number[] = [];
    for (const points of Object.values(data)) {
      for (const p of points) ts.push(new Date(p.timestamp).getTime());
    }
    return ts;
  }, [data]);

  useEffect(() => {
    if (timestamps.length > 0) {
      registerPanelTimestamps(panelId, timestamps);
    }
    return () => unregisterPanelTimestamps(panelId);
  }, [panelId, timestamps, registerPanelTimestamps, unregisterPanelTimestamps]);
}
