"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { VideoFrameStore } from "@/hooks/use-plexus-realtime";

export interface CameraHandle {
  cameraId: string;
  sourceId: string;
  stop: () => void;
}

export interface VideoContextValue {
  /**
   * Stable reference to the video frame store. Panels subscribe via
   * useRealtimeVideo(videoFrameStore) so only individual panels re-render
   * on incoming frames — the provider itself is not a subscriber.
   */
  videoFrameStore: VideoFrameStore;
  isConnected: boolean;
  /** Send message to gateway WebSocket */
  send?: (message: Record<string, unknown>) => void;
  /** Start camera stream - only available on authenticated dashboards */
  startCamera?: (sourceId: string, cameraId: string, frameRate?: number) => CameraHandle;
  /** Stop camera stream - only available on authenticated dashboards */
  stopCamera?: (sourceId: string, cameraId: string) => void;
  /**
   * Register a panel's camera. Returns a cleanup that unregisters on unmount.
   * Aggregated at the provider level: one consolidated `subscribe` (routing)
   * + `start_camera` / `stop_camera` (device commands) per unique camera,
   * preventing last-writer-wins races when multiple panels share a dashboard.
   */
  registerCamera?: (panelId: string, sourceId: string, cameraId: string, frameRate?: number) => () => void;
  /** Whether this is a read-only shared view (no camera control) */
  isSharedView: boolean;
}

export const VideoContext = createContext<VideoContextValue | null>(null);

export function useVideo(): VideoContextValue {
  const ctx = useContext(VideoContext);
  if (!ctx) {
    throw new Error("useVideo must be used within a VideoContext provider");
  }
  return ctx;
}

/**
 * Check if VideoContext is available (for components that can work with or without it)
 */
export function useOptionalVideo(): VideoContextValue | null {
  return useContext(VideoContext);
}

interface VideoProviderProps {
  children: ReactNode;
  value: VideoContextValue;
}

export function VideoProvider({ children, value }: VideoProviderProps) {
  return <VideoContext.Provider value={value}>{children}</VideoContext.Provider>;
}
