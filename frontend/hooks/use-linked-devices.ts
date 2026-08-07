/**
 * Reverse lookup: which devices are linked to a given connection?
 *
 * Scans device metadata client-side. Uses the same SWR-cached
 * useSources() data — no additional API calls.
 */

import { useMemo } from "react";
import { useSources } from "./use-sources";
import type { LinkedConnection } from "@/lib/db/types";

interface LinkedDeviceEntry {
  device: {
    id: string;
    slug: string;
    name: string | null;
    device_type: string | null;
  };
  link: LinkedConnection;
}

/** Pure utility — use in non-hook contexts (e.g., data-source-selector) */
export function getLinkedDevicesForConnection(
  devices: Array<{
    id: string;
    slug: string;
    name: string | null;
    device_type: string | null;
    metadata: unknown;
  }>,
  connectionId: string,
): LinkedDeviceEntry[] {
  const results: LinkedDeviceEntry[] = [];

  for (const device of devices) {
    const meta = device.metadata as Record<string, unknown> | null;
    if (!meta) continue;

    const linked = meta.linked_connections;
    const links: LinkedConnection[] = Array.isArray(linked)
      ? (linked as LinkedConnection[])
      : [];

    const match = links.find((l) => l.connection_id === connectionId);
    if (match) {
      results.push({ device, link: match });
    }
  }

  return results;
}

/** Hook — returns devices linked to a specific connection */
export function useLinkedDevices(connectionId: string | null) {
  const { devices, isLoading } = useSources({ type: "device" });

  const linkedDevices = useMemo(() => {
    if (!connectionId || !devices.length) return [];
    return getLinkedDevicesForConnection(devices, connectionId);
  }, [devices, connectionId]);

  return { linkedDevices, isLoading };
}
