"use client";

/**
 * Leaf-level subscription hooks for telemetry and video stores.
 *
 * These call useSyncExternalStore directly, so only the component that
 * renders the data re-renders at data rate — parent components that
 * manage connection state and source lists are unaffected.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { TelemetryStore, TelemetryData } from "./telemetry-store";
import type { VideoFrameStore, VideoFrameData, VideoFrame } from "./video-store";

export function useRealtimeData(store: TelemetryStore): TelemetryData {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useRealtimeVideo(store: VideoFrameStore): VideoFrameData {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// Per-key subscription. Returns only the frame for `key`, so panels don't
// re-render when a sibling camera produces a frame. If `fallbackPrefix` is
// provided and the primary key misses, scans for any key starting with that
// prefix — supports panels where cameraId isn't explicitly configured.
// Relies on the store preserving reference equality for untouched keys across
// snapshots (see video-store.setFrame).
export function useRealtimeVideoFrame(
  store: VideoFrameStore,
  key: string,
  fallbackPrefix?: string,
): VideoFrame | undefined {
  const getSnapshot = useCallback(() => {
    const data = store.getSnapshot();
    const direct = data[key];
    if (direct) return direct;
    if (!fallbackPrefix) return undefined;
    for (const k of Object.keys(data)) {
      if (k.startsWith(fallbackPrefix)) return data[k];
    }
    return undefined;
  }, [store, key, fallbackPrefix]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
