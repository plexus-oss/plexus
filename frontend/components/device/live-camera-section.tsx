"use client";

import { useSyncExternalStore } from "react";
import { Camera, Play, Square } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";
import type { CameraInfo, VideoFrameStore } from "@/hooks/use-plexus-realtime";

// Per-camera frame subscription — only this component re-renders when its camera gets a frame.
// VideoFrameStore.setFrame spreads the previous data so unchanged camera references are preserved,
// meaning useSyncExternalStore's Object.is check skips re-renders for unrelated cameras.
function useCameraFrame(store: VideoFrameStore, frameKey: string) {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot()[frameKey],
    () => store.getSnapshot()[frameKey],
  );
}

function CameraRowItem({
  camera,
  videoFrameStore,
  wsSourceId,
  isSourceOnline,
  isActive,
  onStart,
  onStop,
}: {
  camera: CameraInfo;
  videoFrameStore: VideoFrameStore;
  wsSourceId: string | undefined;
  isSourceOnline: boolean;
  isActive: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const frameKey = wsSourceId ? `${wsSourceId}:${camera.camera_id}` : "";
  const currentFrame = useCameraFrame(videoFrameStore, frameKey);

  return (
    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "p-2 rounded-lg",
            camera.available ? "bg-green-500/10" : "bg-muted",
          )}
        >
          <Camera
            className={cn(
              "h-4 w-4",
              camera.available ? "text-green-500" : "text-muted-foreground",
            )}
          />
        </div>
        <div>
          <p className="text-sm font-medium">
            {camera.name || camera.camera_id}
          </p>
          <p className="text-xs text-muted-foreground">
            {camera.resolution[0]}x{camera.resolution[1]} @ {camera.frame_rate}
            fps
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isActive && currentFrame && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            Live
          </span>
        )}
        <Button
          size="sm"
          variant={isActive ? "outline" : "default"}
          disabled={!isSourceOnline || !camera.available}
          onClick={isActive ? onStop : onStart}
          className="h-7 text-xs"
        >
          {isActive ? (
            <>
              <Square className="h-3 w-3 mr-1" />
              Stop
            </>
          ) : (
            <>
              <Play className="h-3 w-3 mr-1" />
              Start
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function CameraPreviewItem({
  cameraId,
  videoFrameStore,
  wsSourceId,
}: {
  cameraId: string;
  videoFrameStore: VideoFrameStore;
  wsSourceId: string | undefined;
}) {
  const frameKey = wsSourceId ? `${wsSourceId}:${cameraId}` : "";
  const currentFrame = useCameraFrame(videoFrameStore, frameKey);
  if (!currentFrame) return null;

  return (
    <div className="mt-4 rounded-lg overflow-hidden bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element -- live base64 data: URL video frame, next/image is inappropriate */}
      <img
        src={`data:image/jpeg;base64,${currentFrame.frame}`}
        alt={`Camera ${cameraId}`}
        className="w-full h-auto object-contain"
      />
      <div className="px-3 py-2 bg-black/80 text-white/70 text-xs flex items-center justify-between">
        <span>{cameraId}</span>
        <span>
          {currentFrame.width}x{currentFrame.height}
        </span>
      </div>
    </div>
  );
}

export function LiveCameraSection({
  videoFrameStore,
  cameras,
  wsSourceId,
  isSourceOnline,
  activeCameraIds,
  setActiveCameraIds,
  startCamera,
  stopCamera,
}: {
  videoFrameStore: VideoFrameStore;
  cameras: CameraInfo[];
  wsSourceId: string | undefined;
  isSourceOnline: boolean;
  activeCameraIds: Set<string>;
  setActiveCameraIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  startCamera: (
    sourceId: string,
    cameraId: string,
    frameRate?: number,
  ) => unknown;
  stopCamera: (sourceId: string, cameraId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader>Cameras</SectionHeader>
      <Card className="p-4">
        <div className="space-y-3">
          {cameras.map((camera) => (
            <CameraRowItem
              key={camera.camera_id}
              camera={camera}
              videoFrameStore={videoFrameStore}
              wsSourceId={wsSourceId}
              isSourceOnline={isSourceOnline}
              isActive={activeCameraIds.has(camera.camera_id)}
              onStart={() => {
                if (!wsSourceId) return;
                startCamera(wsSourceId, camera.camera_id, camera.frame_rate);
                setActiveCameraIds((prev) =>
                  new Set(prev).add(camera.camera_id),
                );
              }}
              onStop={() => {
                if (!wsSourceId) return;
                stopCamera(wsSourceId, camera.camera_id);
                setActiveCameraIds((prev) => {
                  const next = new Set(prev);
                  next.delete(camera.camera_id);
                  return next;
                });
              }}
            />
          ))}
          {Array.from(activeCameraIds).map((cameraId) => (
            <CameraPreviewItem
              key={cameraId}
              cameraId={cameraId}
              videoFrameStore={videoFrameStore}
              wsSourceId={wsSourceId}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
