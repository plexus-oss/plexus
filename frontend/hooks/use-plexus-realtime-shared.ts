"use client";

/**
 * Plexus Realtime Hook for Shared Dashboards.
 *
 * Thin wrapper over the shared <SharedRealtimeProvider>. Registers this
 * consumer's metric subscription with the provider and returns the
 * read-only surface — shared views don't command devices.
 */

import { useEffect, useId, useMemo } from "react";
import { useGatewayConnection } from "@/context/gateway-connection-provider";

export type { TelemetryPoint, TelemetryData, TelemetryStore } from "@/hooks/realtime/telemetry-store";
export type { VideoFrame, VideoFrameData, VideoFrameStore } from "@/hooks/realtime/video-store";
export type { ConnectionState, SourceStatus } from "@/hooks/realtime/types";

interface UsePlexusRealtimeSharedOptions {
  /** Optional extra gate — the provider already checks shareToken presence. */
  enabled?: boolean;
}

export function usePlexusRealtimeShared(
  _orgId: string | null,
  _shareToken: string,
  metrics: string[] = [],
  options: UsePlexusRealtimeSharedOptions = {},
) {
  // orgId and shareToken are read from the SharedRealtimeProvider context now;
  // they stay in the signature for API compat with existing call sites.
  const { enabled = true } = options;

  const gw = useGatewayConnection();
  const consumerId = useId();

  const metricsKey = useMemo(() => [...new Set(metrics)].sort().join(","), [metrics]);
  const stableMetrics = useMemo(
    () => metricsKey.split(",").filter(Boolean),
    [metricsKey],
  );

  useEffect(() => {
    if (!enabled) return;
    return gw.subscribe(consumerId, {
      metrics: stableMetrics,
      cameras: [],
    });
  }, [enabled, consumerId, gw, stableMetrics]);

  return {
    telemetryStore: gw.telemetryStore,
    videoFrameStore: gw.videoFrameStore,
    sources: gw.sources,
    connectionState: gw.connectionState,
    isConnected: gw.isConnected,
    isPageVisible: gw.isPageVisible,
    error: gw.error,
    reconnect: gw.reconnect,
  };
}
