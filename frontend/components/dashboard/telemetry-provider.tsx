"use client";

import {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useState,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  usePlexusRealtime,
  type ConnectionState,
  type SourceStatus,
} from "@/hooks/use-plexus-realtime";
import { useRealtimeData } from "@/hooks/realtime/use-realtime-data";
import type { TimeRange } from "@/lib/types/dashboard";
import { useTelemetryHistorical } from "@/hooks/use-telemetry-historical";
import { VideoProvider, type VideoContextValue } from "./video-context";
import { createTelemetryBatcher, TelemetryBatchContext, type TelemetryBatcher } from "@/hooks/use-telemetry-batch";
import { normalizeMetrics } from "@/lib/normalize-metrics";

/**
 * Telemetry data point structure
 */
export interface TelemetryPoint {
  timestamp: string;
  /** Raw value (raw resolution) or bucket AVERAGE (downsampled/rollup resolutions). */
  value: number;
  /**
   * Per-bucket totals of the raw events behind a downsampled point, forwarded
   * from the server's AdaptivePoint (lib/db/clickhouse.ts). Absent on realtime
   * WS points and legacy payloads — consumers must fall back to
   * `sum ?? value` / `count ?? 1` (see lib/panels/aggregate.ts). Without these,
   * summing `value` across downsampled points counts buckets, not events.
   */
  sum?: number;
  count?: number;
  /**
   * Per-bucket extremes on downsampled/rollup resolutions, forwarded from the
   * server's AdaptivePoint. Absent on raw-tier, realtime WS, and legacy
   * payloads. Charts use these to draw the bucket envelope so spikes inside a
   * bucket aren't erased by the average (see use-chart-series).
   */
  min?: number;
  max?: number;
  source_id?: string | null;
}

/**
 * Telemetry data keyed by metric
 */
export type TelemetryData = Record<string, TelemetryPoint[]>;

/**
 * Subscription info for tracking which panels need which metrics
 */
interface Subscription {
  id: string;
  metrics: string[];
}

export type { ConnectionState };

// ============================================================================
// SPLIT CONTEXTS: Separate frequently-changing data from stable controls
// This prevents re-renders of components that only use control functions
// ============================================================================

/**
 * Data context - stable reference to the MergedDataStore plus connection metadata.
 * Components subscribe to the store directly via useSyncExternalStore rather than
 * receiving computed data through context, so this context value rarely changes.
 */
interface TelemetryDataContextValue {
  store: MergedDataStore;
  isLoading: boolean;
  error: Error | undefined;
  connectionState: ConnectionState;
  isRealtimeConnected: boolean;
}

/**
 * Control context - stable functions that rarely change
 * Components using only this won't re-render on data updates
 */
interface TelemetryControlContextValue {
  subscribe: (id: string, metrics: string[]) => () => void;
  refresh: () => void;
}

/**
 * Sources context - changes on source_status events; kept separate so
 * panels subscribed only to subscribe/refresh are not re-rendered.
 */
interface TelemetrySourcesContextValue {
  sources: SourceStatus[];
}

// Create separate contexts (exported for SharedTelemetryProvider)
export const TelemetryDataContext = createContext<TelemetryDataContextValue | null>(
  null
);
export const TelemetryControlContext =
  createContext<TelemetryControlContextValue | null>(null);
export const TelemetrySourcesContext =
  createContext<TelemetrySourcesContextValue | null>(null);

// Export types
export type { TelemetryDataContextValue, TelemetryControlContextValue, TelemetrySourcesContextValue };

interface TelemetryProviderProps {
  children: ReactNode;
  timeRange?: TimeRange | null;
  /** Auto-refresh interval in ms (0 = off). Passed to SWR for periodic re-fetching. */
  refreshInterval?: number;
  /**
   * Whether to auto-start device streaming when sources come online.
   * Default true (dashboards own their stream). Pass false when a parent
   * component already owns the stream (e.g. the device detail page) so the
   * provider only listens without issuing duplicate start commands.
   */
  autoStream?: boolean;
  /** @deprecated No longer used — kept for API compatibility. */
  throttleMs?: number;
}

// ============================================================================
// MERGED DATA STORE
// External store for merged historical + realtime data, used with
// useSyncExternalStore so the provider can expose a stable getData callback.
// ============================================================================

export interface MergedDataStore {
  subscribe: (callback: () => void) => () => void;
  getSnapshot: () => TelemetryData;
  update: (data: TelemetryData) => void;
}

export function createMergedDataStore(): MergedDataStore {
  let currentData: TelemetryData = {};
  const subscribers = new Set<() => void>();

  return {
    subscribe: (callback) => {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    getSnapshot: () => currentData,
    update: (data) => {
      currentData = data;
      subscribers.forEach((cb) => cb());
    },
  };
}

/**
 * TelemetryProvider - Shares telemetry data across multiple panels
 *
 * Performance optimizations:
 * - Split contexts to prevent unnecessary re-renders
 * - RAF-synchronized data updates (syncs to display refresh rate)
 * - Stable control function references
 */
export function TelemetryProvider({
  children,
  timeRange,
  refreshInterval = 0,
  autoStream = true,
}: TelemetryProviderProps) {
  const [subscriptions, setSubscriptions] = useState<Map<string, Subscription>>(
    new Map()
  );

  // Throttled data store for batching updates. Lazy useState initializer keeps
  // a single stable instance for the component's lifetime without reading a ref
  // during render.
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

  // Connect to Plexus WebSocket server for realtime updates.
  // autoStream defaults to true (devices stream automatically when online);
  // pages that already own the stream pass false to avoid duplicate commands.
  const {
    telemetryStore,
    videoFrameStore,
    sources,
    connectionState,
    isConnected,
    send,
    startCamera,
    stopCamera,
  } = usePlexusRealtime(allMetrics, { autoStream });

  // Subscribe to telemetry store at provider level to merge with historical data.
  // Video store is NOT subscribed here — panels call useRealtimeVideo(videoFrameStore)
  // directly so only the rendering panel re-renders on incoming frames.
  const realtimeData = useRealtimeData(telemetryStore);

  // SWR for initial historical data. Once the realtime WS is connected and
  // delivering points, the stream itself keeps the tail fresh — an additional
  // periodic historical re-fetch just re-merges the whole window, creating
  // fresh array references and invalidating every downstream memo on each
  // poll. Suspend the poll while WS is healthy; SWR still revalidates on
  // reconnect or focus so no data is lost.
  const effectiveHistoricalRefreshInterval = isConnected ? 0 : refreshInterval;
  const {
    data: historicalData,
    error,
    isLoading,
    mutate,
  } = useTelemetryHistorical({
    metrics: allMetrics,
    timeRange: timeRange?.value || "15m",
    refreshInterval: effectiveHistoricalRefreshInterval,
    // Row cap applies to the whole aggregated response (newest rows win);
    // scale with the metric union so absolute windows aren't tail-truncated.
    limit: Math.min(Math.max(allMetrics.length, 1) * 2000, 50_000),
  });

  // Merge and update throttled store when data changes
  useEffect(() => {
    const historical = historicalData?.data || {};
    const realtime = realtimeData;

    const noRealtimeData = Object.keys(realtime).length === 0;

    // Fast path: no realtime data, just use historical
    if (noRealtimeData) {
      store.update(historical);
      return;
    }

    const merged: TelemetryData = {};
    const allMetricKeys = new Set([...allMetrics]);

    for (const metric of allMetricKeys) {
      const historicalPoints = historical[metric] || [];
      const realtimePoints = realtime[metric] || [];

      // Fast paths
      if (realtimePoints.length === 0) {
        merged[metric] = historicalPoints;
        continue;
      }
      if (historicalPoints.length === 0) {
        merged[metric] = realtimePoints;
        continue;
      }

      // Merge: historical is already sorted, realtime appended after
      // Only dedupe timestamps that overlap
      const lastHistTs = historicalPoints.length > 0
        ? historicalPoints[historicalPoints.length - 1].timestamp
        : "";
      const newRealtime = realtimePoints.filter((p) => p.timestamp > lastHistTs);
      if (newRealtime.length > 0) {
        merged[metric] = [...historicalPoints, ...newRealtime];
      } else {
        // Overlap exists, dedupe via Map
        const pointMap = new Map<string, TelemetryPoint>();
        for (const point of historicalPoints) {
          pointMap.set(point.timestamp, point);
        }
        for (const point of realtimePoints) {
          pointMap.set(point.timestamp, point);
        }
        merged[metric] = Array.from(pointMap.values());
        merged[metric].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
      }
    }

    store.update(merged);
  }, [historicalData, realtimeData, allMetrics, store]);

  // ============================================================================
  // STABLE CONTROL FUNCTIONS (won't cause re-renders when called)
  // ============================================================================

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

  // ============================================================================
  // CONTEXT VALUES
  // ============================================================================

  // Data context value — stable reference to the store plus connection metadata.
  // Panels subscribe to store.subscribe directly (useSyncExternalStore in the hook)
  // so this object only changes when connection state or loading state changes,
  // not on every telemetry batch.
  const dataContextValue = useMemo<TelemetryDataContextValue>(
    () => ({
      store,
      isLoading,
      error,
      connectionState,
      isRealtimeConnected: isConnected,
    }),
    [store, isLoading, error, connectionState, isConnected]
  );

  // Control context value — fully stable: only subscribe + refresh.
  // sources is deliberately excluded; it lives in TelemetrySourcesContext.
  const controlContextValue = useMemo<TelemetryControlContextValue>(
    () => ({ subscribe, refresh }),
    [subscribe, refresh]
  );

  const sourcesContextValue = useMemo<TelemetrySourcesContextValue>(
    () => ({ sources }),
    [sources]
  );

  // Camera subscription registry: panelId → { sourceId, cameraId, frameRate }
  // Aggregated here so all panels share one `subscribe` + `start_camera` message
  // to the gateway, avoiding last-writer-wins races when multiple VideoPanel
  // instances mount simultaneously.
  type CameraEntry = { sourceId: string; cameraId: string; frameRate: number };
  const [cameraRegistry, setCameraRegistry] = useState<Map<string, CameraEntry>>(new Map());

  const registerCamera = useCallback(
    (panelId: string, sourceId: string, cameraId: string, frameRate = 10) => {
      setCameraRegistry((prev) => {
        const next = new Map(prev);
        next.set(panelId, { sourceId, cameraId, frameRate });
        return next;
      });
      return () => {
        setCameraRegistry((prev) => {
          const next = new Map(prev);
          next.delete(panelId);
          return next;
        });
      };
    },
    []
  );

  // Tracks the camera set from the previous effect run so we can diff additions
  // and removals and send targeted start_camera / stop_camera device commands.
  const prevCameraSetRef = useRef<Map<string, CameraEntry>>(new Map());

  useEffect(() => {
    if (!isConnected || !send) {
      // On disconnect, reset so reconnect re-sends start_camera for all cameras.
      prevCameraSetRef.current = new Map();
      return;
    }

    // Deduplicate by sourceId:cameraId — multiple panels can share a camera.
    const current = new Map<string, CameraEntry>();
    for (const entry of cameraRegistry.values()) {
      const key = `${entry.sourceId}:${entry.cameraId}`;
      if (!current.has(key)) current.set(key, entry);
    }

    const prev = prevCameraSetRef.current;

    // Tell device to start streaming newly-added cameras, or to re-negotiate
    // when frameRate changes on an existing camera.
    for (const [key, entry] of current) {
      const p = prev.get(key);
      if (!p || p.frameRate !== entry.frameRate) {
        send({ type: "start_camera", source_id: entry.sourceId, camera_id: entry.cameraId, frame_rate: entry.frameRate });
      }
    }

    // Tell device to stop streaming cameras that are no longer needed.
    for (const [key, entry] of prev) {
      if (!current.has(key)) {
        send({ type: "stop_camera", source_id: entry.sourceId, camera_id: entry.cameraId });
      }
    }

    prevCameraSetRef.current = current;

    // Consolidated subscribe for gateway routing — always reflects current set.
    // max_fps is the ceiling the gateway applies per-camera (time-based throttle);
    // we send the max of all current frameRates since BrowserConn holds one value.
    const cameraIds = Array.from(new Set([...current.values()].map((e) => e.cameraId)));
    const maxFps = current.size === 0
      ? 0
      : Math.max(...[...current.values()].map((e) => e.frameRate));
    send({ type: "subscribe", cameras: cameraIds, max_fps: maxFps });
  }, [cameraRegistry, isConnected, send]);

  // Video context value - provides video frame store and camera control.
  // videoFrameStore is a stable reference — panels subscribe directly via
  // useRealtimeVideo(videoFrameStore) so this memo only invalidates when
  // connection state or camera control functions change, not on each frame.
  const videoContextValue = useMemo<VideoContextValue>(
    () => ({
      videoFrameStore,
      isConnected,
      send,
      startCamera,
      stopCamera,
      registerCamera,
      isSharedView: false,
    }),
    [videoFrameStore, isConnected, send, startCamera, stopCamera, registerCamera]
  );

  // Batch query context for N+1 prevention. Lazy useState initializer gives a
  // stable batcher instance without a render-time ref read.
  const [batcher] = useState<TelemetryBatcher>(() => createTelemetryBatcher());

  return (
    <TelemetryBatchContext.Provider value={batcher}>
      <TelemetrySourcesContext.Provider value={sourcesContextValue}>
        <TelemetryControlContext.Provider value={controlContextValue}>
          <TelemetryDataContext.Provider value={dataContextValue}>
            <VideoProvider value={videoContextValue}>
              {children}
            </VideoProvider>
          </TelemetryDataContext.Provider>
        </TelemetryControlContext.Provider>
      </TelemetrySourcesContext.Provider>
    </TelemetryBatchContext.Provider>
  );
}

// ============================================================================
// HOOKS - Use these for better performance
// ============================================================================

/**
 * Hook to get telemetry control functions only
 * Components using this won't re-render on data updates
 */
export function useTelemetryControl() {
  const context = useContext(TelemetryControlContext);
  if (!context) {
    throw new Error(
      "useTelemetryControl must be used within a TelemetryProvider"
    );
  }
  return context;
}

/**
 * Hook to access the raw TelemetryDataContext (store + connection metadata).
 * Prefer useTelemetryData for panel-level data subscriptions.
 */
export function useTelemetryDataContext() {
  const context = useContext(TelemetryDataContext);
  if (!context) {
    throw new Error(
      "useTelemetryDataContext must be used within a TelemetryProvider"
    );
  }
  return context;
}

// Stable fallbacks for useSyncExternalStore when no context is present
const noopSubscribe = () => () => {};
const emptySnapshot = (): TelemetryData => ({});

/**
 * Hook to use telemetry data within a TelemetryProvider.
 * Subscribes directly to the MergedDataStore via useSyncExternalStore so
 * only this panel re-renders when the store updates — the provider and
 * sibling panels are not involved in the render chain.
 */
export function useTelemetryFromProvider(metrics: string[], panelId: string) {
  const dataContext = useContext(TelemetryDataContext);
  const controlContext = useContext(TelemetryControlContext);

  const safeMetrics = metrics || [];
  const metricsKey = safeMetrics.join(",");
  const stableMetrics = useMemo(() => safeMetrics, [metricsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const subscribe = controlContext?.subscribe;

  useEffect(() => {
    if (!subscribe) return;
    if (!stableMetrics || stableMetrics.length === 0) return;
    return subscribe(panelId, stableMetrics);
  }, [subscribe, panelId, stableMetrics]);

  // Subscribe directly to the store. When the store updates, only this hook's
  // component re-renders — the provider does not participate.
  const allData = useSyncExternalStore(
    dataContext?.store.subscribe ?? noopSubscribe,
    dataContext?.store.getSnapshot ?? emptySnapshot,
    dataContext?.store.getSnapshot ?? emptySnapshot,
  );

  const data = useMemo(() => {
    const result: TelemetryData = {};
    for (const metric of stableMetrics) {
      if (allData[metric]) {
        result[metric] = allData[metric];
      }
    }
    return result;
  }, [allData, stableMetrics]);

  if (!dataContext || !controlContext) {
    return {
      data: {},
      isLoading: false,
      error: undefined,
      refresh: () => {},
      connectionState: "disconnected" as ConnectionState,
      isRealtimeConnected: false,
    };
  }

  return {
    data,
    isLoading: dataContext.isLoading,
    error: dataContext.error,
    refresh: controlContext.refresh,
    connectionState: dataContext.connectionState,
    isRealtimeConnected: dataContext.isRealtimeConnected,
  };
}

/**
 * Hook to consume telemetry data. Requires a TelemetryProvider ancestor —
 * returns an empty result with `isRealtimeConnected: false` if none is present.
 */
export function useTelemetryData(
  metrics: string[],
  _timeRange: TimeRange | undefined | null,
  options?: {
    panelId?: string;
  }
) {
  const [defaultPanelId] = useState(
    () => `panel-${Math.random().toString(36).slice(2)}`
  );
  const panelId = options?.panelId || defaultPanelId;
  return useTelemetryFromProvider(metrics, panelId);
}

/**
 * Hook to get connection state from TelemetryProvider
 */
export function useTelemetryConnectionState(): ConnectionState {
  const context = useContext(TelemetryDataContext);
  return context?.connectionState ?? "disconnected";
}

/**
 * Hook to get connected sources. Re-renders on source_status events only —
 * isolated from the fully-stable TelemetryControlContext.
 */
export function useSourceControl() {
  const context = useContext(TelemetrySourcesContext);

  if (!context) {
    throw new Error("useSourceControl must be used within a TelemetryProvider");
  }

  return {
    sources: context.sources,
  };
}

