/**
 * Video Frame Store
 *
 * Keeps the latest frame per camera key (source_id:camera_id).
 * Used with useSyncExternalStore.
 */

export interface VideoFrame {
  source_id: string;
  camera_id: string;
  frame: string; // Base64 encoded JPEG
  width: number;
  height: number;
  timestamp: number;
  // Thermal camera fields — present when video_type === "thermal"
  video_type?: "normal" | "thermal";
  sensor_width?: number;
  sensor_height?: number;
  temp_min?: number;
  temp_max?: number;
  temps?: number[]; // flat Celsius array, length sensor_width × sensor_height
}

// Key format: "source_id:camera_id"
export type VideoFrameData = Record<string, VideoFrame>;

type VideoSubscriber = () => void;

export interface VideoFrameStore {
  subscribe: (callback: VideoSubscriber) => () => void;
  getSnapshot: () => VideoFrameData;
  setFrame: (frame: VideoFrame) => void;
  clear: () => void;
}

const STALE_FRAME_MS = 30_000; // 30 seconds

export function createVideoFrameStore(): VideoFrameStore {
  let data: VideoFrameData = {};
  const subscribers = new Set<VideoSubscriber>();

  // Notify synchronously. Video frames arrive from the WebSocket message
  // handler which processes one message at a time — no batching needed.
  const notify = () => {
    subscribers.forEach((cb) => cb());
  };

  const subscribe = (callback: VideoSubscriber) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  };

  const getSnapshot = () => data;

  const setFrame = (frame: VideoFrame) => {
    const key = `${frame.source_id}:${frame.camera_id}`;
    // Evict stale cameras before adding
    const now = Date.now();
    for (const [k, v] of Object.entries(data)) {
      if (k !== key && now - v.timestamp > STALE_FRAME_MS) {
        delete data[k];
      }
    }
    data = { ...data, [key]: frame };
    notify();
  };

  const clear = () => {
    data = {};
    notify();
  };

  return { subscribe, getSnapshot, setFrame, clear };
}
