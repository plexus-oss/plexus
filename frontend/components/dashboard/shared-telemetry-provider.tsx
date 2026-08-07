"use client";

import {
  useMemo,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type { TimeRange } from "@/lib/types/dashboard";
import type { ConnectionState, SourceStatus } from "@/hooks/use-plexus-realtime";
import { useTelemetryHistorical } from "@/hooks/use-telemetry-historical";
import { usePlexusRealtimeShared } from "@/hooks/use-plexus-realtime-shared";
import { useRealtimeData } from "@/hooks/realtime/use-realtime-data";
import { SharedRealtimeProvider } from "@/context/gateway-connection-provider";
import {
  TelemetryDataContext,
  TelemetryControlContext,
  TelemetrySourcesContext,
  type TelemetryData,
  createMergedDataStore,
  type MergedDataStore,
} from "./telemetry-provider";
import { VideoProvider, type VideoContextValue } from "./video-context";
import { normalizeMetrics } from "@/lib/normalize-metrics";

interface SharedTelemetryProviderProps {
  children: ReactNode;
  shareToken: string;
  /** Organization ID for WebSocket connection */
  orgId?: string | null;
  timeRange?: TimeRange | null;
  /** Password for password-protected share links */
  password?: string;
}

/**
 * Subscription info for tracking which panels need which metrics
 */
interface Subscription {
  id: string;
  metrics: string[];
}

/**
 * SharedTelemetryProvider - Provides telemetry data for shared dashboards
 *
 * Uses the public /api/shared/[token]/telemetry endpoint to fetch historical data
 * without requiring authentication. When orgId is provided, also connects to
 * gateway WebSocket for real-time streaming updates.
 *
 * This provider uses the same TelemetryContext as TelemetryProvider,
 * so all existing panel components work without modification.
 */
export function SharedTelemetryProvider({
  children,
  shareToken,
  orgId,
  timeRange,
  password,
}: SharedTelemetryProviderProps) {
  // Mount the singleton gateway connection for shared views at this layer —
  // shareToken + orgId resolve here (from /api/shared/[token]) rather than at
  // the route layout, so this is the earliest point we can open the socket.
  return (
    <SharedRealtimeProvider shareToken={shareToken} enabled={!!orgId}>
      <SharedTelemetryProviderInner
        shareToken={shareToken}
        orgId={orgId}
        timeRange={timeRange}
        password={password}
      >
        {children}
      </SharedTelemetryProviderInner>
    </SharedRealtimeProvider>
  );
}

function SharedTelemetryProviderInner({
  children,
  shareToken,
  orgId,
  timeRange,
  password,
}: SharedTelemetryProviderProps) {
  const [subscriptions, setSubscriptions] = useState<Map<string, Subscription>>(
    new Map()
  );

  // Stable external store for merged data — panels subscribe directly.
  // useState lazy initializer creates it exactly once with a stable reference.
  const [store] = useState<MergedDataStore>(() => createMergedDataStore());

  // Aggregate all unique metrics from subscriptions
  const allMetrics = useMemo(() => {
    const metricsSet = new Set<string>();
    for (const sub of subscriptions.values()) {
      for (const metric of sub.metrics) {
        metricsSet.add(metric);
      }
    }
    return normalizeMetrics(Array.from(metricsSet));
  }, [subscriptions]);

  // Real-time WebSocket connection (only when orgId is available)
  const {
    telemetryStore,
    videoFrameStore,
    isConnected: isRealtimeConnected,
    sources,
  } = usePlexusRealtimeShared(
    orgId ?? null,
    shareToken,
    allMetrics,
    { enabled: !!orgId }
  );

  const realtimeData = useRealtimeData(telemetryStore);

  // SWR for fetching data - poll every 30 seconds for shared dashboards
  const {
    data: historicalData,
    error,
    isLoading,
    mutate,
  } = useTelemetryHistorical({
    metrics: allMetrics,
    timeRange: timeRange?.value || "15m",
    shareToken,
    password,
    refreshInterval: 30000,
    // The server's default row cap applies to the WHOLE aggregated response
    // (newest rows win) — a dashboard's ~20-metric union at 5 Hz overflows
    // 1000 rows in seconds and silently loses the oldest points, which
    // truncated absolute-window views to their tail. Scale with metric count.
    limit: Math.min(Math.max(allMetrics.length, 1) * 2000, 50_000),
  });

  // Merge historical + realtime data into the external store.
  // Panels subscribe to the store directly via useSyncExternalStore.
  useEffect(() => {
    const historical = historicalData?.data || {};
    const hasRealtimeData = Object.keys(realtimeData).length > 0;

    if (!hasRealtimeData) {
      store.update(historical);
      return;
    }

    const merged: TelemetryData = {};
    const allMetricKeys = new Set([...allMetrics, ...Object.keys(realtimeData)]);

    for (const metric of allMetricKeys) {
      const historicalPoints = historical[metric] || [];
      const realtimePoints = realtimeData[metric] || [];

      if (realtimePoints.length > 0) {
        const lastHistTs = historicalPoints.length > 0
          ? historicalPoints[historicalPoints.length - 1].timestamp
          : "";
        const newRealtimePoints = realtimePoints.filter(
          (p) => p.timestamp > lastHistTs
        );
        merged[metric] = [...historicalPoints, ...newRealtimePoints];
      } else {
        merged[metric] = historicalPoints;
      }
    }

    store.update(merged);
  }, [historicalData, allMetrics, realtimeData, store]);

  // Subscribe to metrics
  const subscribe = useCallback((id: string, metrics: string[]) => {
    setSubscriptions((prev) => {
      const next = new Map(prev);
      next.set(id, { id, metrics });
      return next;
    });

    return () => {
      setSubscriptions((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    };
  }, []);

  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);

  // Data context value — stable store reference + connection metadata.
  // Panels subscribe to store.subscribe directly, so this object rarely changes.
  const dataContextValue = useMemo(
    () => ({
      store,
      isLoading,
      error,
      connectionState: (isLoading ? "connecting" : "connected") as ConnectionState,
      isRealtimeConnected,
    }),
    [store, isLoading, error, isRealtimeConnected]
  );

  // Control context value — fully stable: only subscribe + refresh.
  const controlContextValue = useMemo(
    () => ({ subscribe, refresh }),
    [subscribe, refresh]
  );

  const sourcesContextValue = useMemo(
    () => ({ sources: sources as SourceStatus[] }),
    [sources]
  );

  // Video context value - read-only for shared dashboards (no camera control).
  // videoFrameStore is stable; panels subscribe directly via useRealtimeVideo.
  const videoContextValue = useMemo<VideoContextValue>(
    () => ({
      videoFrameStore,
      isConnected: isRealtimeConnected,
      isSharedView: true,
    }),
    [videoFrameStore, isRealtimeConnected]
  );

  return (
    <TelemetrySourcesContext.Provider value={sourcesContextValue}>
      <TelemetryControlContext.Provider value={controlContextValue}>
        <TelemetryDataContext.Provider value={dataContextValue}>
          <VideoProvider value={videoContextValue}>
            {children}
          </VideoProvider>
        </TelemetryDataContext.Provider>
      </TelemetryControlContext.Provider>
    </TelemetrySourcesContext.Provider>
  );
}
