/**
 * Shared types for the Plexus realtime system.
 */

export type ConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface SensorInfo {
  name: string;
  description: string;
  metrics: string[];
  sample_rate: number;
  prefix: string;
  available: boolean;
}

export interface CameraInfo {
  camera_id: string;
  name: string;
  description: string;
  resolution: [number, number];
  frame_rate: number;
  quality: number;
  available: boolean;
  video_type?: "normal" | "thermal";
}

export interface SourceStatus {
  source_id: string;
  status: "online" | "offline" | "idle" | "stale" | "error";
  platform?: string;
  sensors?: SensorInfo[];
  cameras?: CameraInfo[];
  lastSeenAt?: string;
  lastDataAt?: string;
}

export interface StreamHandle {
  streamId: string;
  sourceId: string;
  stop: () => void;
}

export interface CameraHandle {
  cameraId: string;
  sourceId: string;
  stop: () => void;
}

export interface UsePlexusRealtimeOptions {
  /** Maximum points to keep per metric */
  maxPoints?: number;
  /** Gateway host (defaults to env var or localhost) */
  host?: string;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Whether to enable WebSocket connection (default: true) */
  enabled?: boolean;
  /** Auto-start streaming when sources come online (default: false) */
  autoStream?: boolean;
  /** Recording preferences per source ID - true means persist to storage */
  recordingPreferences?: Record<string, boolean>;
  /** Camera IDs to subscribe to for video frames (passive receive) */
  subscribeCameras?: string[];
  /** Called on each reconnection attempt */
  onReconnecting?: (attempt: number) => void;
  /** Called when reconnection succeeds */
  onReconnected?: () => void;
}

/**
 * Calculate exponential backoff delay with jitter.
 * min(1000 * 2^attempt + random jitter, 30000)
 */
export function getBackoffDelay(attempt: number): number {
  const base = Math.min(1000 * Math.pow(2, attempt), 30000);
  const jitter = Math.random() * 1000;
  return base + jitter;
}

export function getGatewayHost(): string {
  if (typeof window !== "undefined") {
    if (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      return process.env.NEXT_PUBLIC_GATEWAY_HOST || "localhost:8080";
    }
  }
  return process.env.NEXT_PUBLIC_GATEWAY_HOST || "gateway.plexus.company";
}
