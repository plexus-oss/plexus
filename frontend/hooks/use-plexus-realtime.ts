"use client";

/**
 * Plexus Realtime Hook — authenticated variant.
 *
 * Thin wrapper over the shared <AuthenticatedRealtimeProvider>. Registers
 * this consumer's metric subscription with the provider and exposes
 * stream/camera command helpers. The socket, stores, and source list
 * come from context so all consumers on a page share one connection.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import { useGatewayConnection } from "@/context/gateway-connection-provider";
import type {
  StreamHandle,
  CameraHandle,
  UsePlexusRealtimeOptions,
} from "@/hooks/realtime/types";

export type {
  TelemetryPoint,
  TelemetryData,
  TelemetryStore,
} from "@/hooks/realtime/telemetry-store";
export type { VideoFrame, VideoFrameData, VideoFrameStore } from "@/hooks/realtime/video-store";
export type {
  ConnectionState,
  SensorInfo,
  CameraInfo,
  SourceStatus,
  StreamHandle,
  CameraHandle,
} from "@/hooks/realtime/types";

export function usePlexusRealtime(
  metrics: string[] = [],
  options: UsePlexusRealtimeOptions = {},
) {
  const { autoStream = false, subscribeCameras } = options;

  // Stabilize recordingPreferences: a `= {}` destructuring default allocates a
  // fresh object on every render, which churns the autoStream effect's deps
  // and drives an infinite setStreamConfig loop when the provider re-renders.
  const userRecordingPreferences = options.recordingPreferences;
  const recordingPreferences = useMemo(
    () => userRecordingPreferences ?? {},
    [userRecordingPreferences],
  );

  const gw = useGatewayConnection();
  const {
    telemetryStore,
    videoFrameStore,
    sources,
    connectionState,
    isConnected,
    isPageVisible,
    error,
    streamConfigs,
    setStreamConfig,
    subscribe,
    send,
    reconnect,
    reconnectAttempt,
    maxReconnectAttempts,
  } = gw;

  // Stable consumer ID for this hook instance.
  const consumerId = useId();

  const metricsKey = useMemo(() => [...new Set(metrics)].sort().join(","), [metrics]);
  const camerasKey = useMemo(
    () => [...new Set(subscribeCameras ?? [])].sort().join(","),
    [subscribeCameras],
  );

  const stableMetrics = useMemo(
    () => metricsKey.split(",").filter(Boolean),
    [metricsKey],
  );
  const stableCameras = useMemo(
    () => camerasKey.split(",").filter(Boolean),
    [camerasKey],
  );

  // Register subscription with provider; auto-unsubscribes on unmount or re-sub.
  useEffect(() => {
    return subscribe(consumerId, {
      metrics: stableMetrics,
      cameras: stableCameras,
    });
  }, [consumerId, subscribe, stableMetrics, stableCameras]);

  // Keep a fresh metrics ref for command helpers so they dispatch with the
  // current subscription list even if the hook's metrics arg hasn't changed.
  const metricsRef = useRef(stableMetrics);
  useEffect(() => {
    metricsRef.current = stableMetrics;
  });

  // Per-consumer tracking — which streams/cameras this hook instance started,
  // so its unmount cleanup stops the ones it owns without affecting others.
  const activeStreamsRef = useRef<Map<string, StreamHandle>>(new Map());
  const activeCamerasRef = useRef<Map<string, CameraHandle>>(new Map());
  const autoStartedSourcesRef = useRef<Set<string>>(new Set());

  // autoStream: start a stream for each newly-online source this consumer
  // cares about. Cleans up on unmount/disable. stableMetrics is a dep on
  // purpose: the device only emits the metrics named in its last
  // start_stream, so when the subscription union changes (a panel is added
  // or edited) the cleanup stops every auto-started stream and the re-run
  // restarts them with the updated metric list — otherwise new panels stay
  // empty until a full page reload re-issues start_stream.
  useEffect(() => {
    if (!autoStream || !isConnected) return;

    // Capture the stable ref Set so the cleanup closure uses the same instance
    // it observed during this effect run (satisfies react-hooks/exhaustive-deps).
    const autoStartedSources = autoStartedSourcesRef.current;

    for (const source of sources) {
      if (source.status !== "online") continue;
      if (autoStartedSources.has(source.source_id)) continue;

      const shouldRecord = recordingPreferences[source.source_id] ?? false;

      send({
        type: "start_stream",
        source_id: source.source_id,
        metrics: stableMetrics,
        interval_ms: 100,
        store: shouldRecord,
      });

      setStreamConfig(source.source_id, {
        intervalMs: 100,
        isStreaming: true,
        store: shouldRecord,
      });

      autoStartedSources.add(source.source_id);
    }

    // Drop auto-started markers for sources that went offline — so when they
    // come back online we re-start instead of assuming we're still streaming.
    const onlineSourceIds = new Set(
      sources.filter((s) => s.status === "online").map((s) => s.source_id),
    );
    for (const sourceId of autoStartedSources) {
      if (!onlineSourceIds.has(sourceId)) {
        autoStartedSources.delete(sourceId);
      }
    }

    return () => {
      for (const sourceId of autoStartedSources) {
        send({ type: "stop_stream", source_id: sourceId, stream_id: "*" });
      }
      autoStartedSources.clear();
    };
  }, [autoStream, isConnected, sources, stableMetrics, recordingPreferences, send, setStreamConfig]);

  const startStream = useCallback(
    (
      sourceId: string,
      streamMetrics?: string[],
      intervalMs = 100,
      storeFlag = false,
    ): StreamHandle => {
      const streamId = `stream_${Date.now()}`;

      send({
        type: "start_stream",
        source_id: sourceId,
        metrics: streamMetrics || metricsRef.current,
        interval_ms: intervalMs,
        store: storeFlag,
      });

      setStreamConfig(sourceId, {
        intervalMs,
        isStreaming: true,
        store: storeFlag,
      });

      const handle: StreamHandle = {
        streamId,
        sourceId,
        stop: () => {
          send({ type: "stop_stream", source_id: sourceId, stream_id: streamId });
          activeStreamsRef.current.delete(streamId);
          setStreamConfig(sourceId, { isStreaming: false, store: false });
        },
      };

      activeStreamsRef.current.set(streamId, handle);
      return handle;
    },
    [send, setStreamConfig],
  );

  const stopAllStreams = useCallback(
    (sourceId: string) => {
      send({ type: "stop_stream", source_id: sourceId, stream_id: "*" });
      for (const [id, handle] of activeStreamsRef.current) {
        if (handle.sourceId === sourceId) {
          activeStreamsRef.current.delete(id);
        }
      }
      setStreamConfig(sourceId, { isStreaming: false, store: false });
    },
    [send, setStreamConfig],
  );

  const configureSensor = useCallback(
    (sourceId: string, sensor: string, config: Record<string, unknown>) => {
      send({ type: "configure", source_id: sourceId, sensor, config });
    },
    [send],
  );

  const updateStreamConfig = useCallback(
    (sourceId: string, intervalMs: number, storeFlag?: boolean) => {
      const shouldStore = storeFlag ?? streamConfigs[sourceId]?.store ?? false;
      send({ type: "stop_stream", source_id: sourceId, stream_id: "*" });
      send({
        type: "start_stream",
        source_id: sourceId,
        metrics: metricsRef.current,
        interval_ms: intervalMs,
        store: shouldStore,
      });
      setStreamConfig(sourceId, {
        intervalMs,
        isStreaming: true,
        store: shouldStore,
      });
    },
    [send, setStreamConfig, streamConfigs],
  );

  const getStreamConfig = useCallback(
    (sourceId: string) =>
      streamConfigs[sourceId] || {
        intervalMs: 100,
        isStreaming: false,
        store: false,
      },
    [streamConfigs],
  );

  const setRecording = useCallback(
    (sourceId: string, storeFlag: boolean) => {
      const config = streamConfigs[sourceId];
      if (!config?.isStreaming) {
        setStreamConfig(sourceId, { store: storeFlag });
        return;
      }
      send({ type: "stop_stream", source_id: sourceId, stream_id: "*" });
      send({
        type: "start_stream",
        source_id: sourceId,
        metrics: metricsRef.current,
        interval_ms: config.intervalMs,
        store: storeFlag,
      });
      setStreamConfig(sourceId, { store: storeFlag });
    },
    [send, setStreamConfig, streamConfigs],
  );

  const startCamera = useCallback(
    (sourceId: string, cameraId: string, frameRate = 10): CameraHandle => {
      const key = `${sourceId}:${cameraId}`;
      send({
        type: "start_camera",
        source_id: sourceId,
        camera_id: cameraId,
        frame_rate: frameRate,
      });
      const handle: CameraHandle = {
        cameraId,
        sourceId,
        stop: () => {
          send({
            type: "stop_camera",
            source_id: sourceId,
            camera_id: cameraId,
          });
          activeCamerasRef.current.delete(key);
        },
      };
      activeCamerasRef.current.set(key, handle);
      return handle;
    },
    [send],
  );

  const stopCamera = useCallback(
    (sourceId: string, cameraId: string) => {
      const key = `${sourceId}:${cameraId}`;
      send({
        type: "stop_camera",
        source_id: sourceId,
        camera_id: cameraId,
      });
      activeCamerasRef.current.delete(key);
    },
    [send],
  );

  const stopAllCameras = useCallback(
    (sourceId: string) => {
      for (const [key, handle] of activeCamerasRef.current) {
        if (handle.sourceId === sourceId) {
          send({
            type: "stop_camera",
            source_id: sourceId,
            camera_id: handle.cameraId,
          });
          activeCamerasRef.current.delete(key);
        }
      }
    },
    [send],
  );

  return {
    telemetryStore,
    videoFrameStore,
    sources,

    connectionState,
    isConnected,
    isPageVisible,
    error,

    reconnect,
    reconnectAttempt,
    maxReconnectAttempts,

    startStream,
    stopAllStreams,
    configureSensor,
    updateStreamConfig,
    getStreamConfig,
    setRecording,
    streamConfigs,

    startCamera,
    stopCamera,
    stopAllCameras,
    send,
  };
}
