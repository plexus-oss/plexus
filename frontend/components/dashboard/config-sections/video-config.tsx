"use client";

import { useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Video, Circle } from "lucide-react";
import { useCameraVideoType } from "@/hooks/use-camera-video-type";

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function VideoConfig({ config, onChange, metrics = [] }: Props) {
  const cameraMetric = metrics.find((m) => m.includes(":$camera:"));
  const videoUrl = (config.videoUrl as string | undefined) ?? "";

  // Parse the selected camera (format: source_id:$camera:camera_id). camera_id
  // itself may contain colons, so split only on the marker.
  const camera = useMemo(() => {
    if (!cameraMetric) return null;
    const markerIdx = cameraMetric.indexOf(":$camera:");
    return {
      sourceId: cameraMetric.substring(0, markerIdx),
      cameraId: cameraMetric.substring(markerIdx + ":$camera:".length),
    };
  }, [cameraMetric]);

  // Thermal cameras are not recorded — we never store thermal video. Hide the
  // recording opt-in for them.
  const isThermal =
    useCameraVideoType(camera?.sourceId, camera?.cameraId) === "thermal";

  // If a camera that previously had recording enabled is now thermal, clear the
  // stale flag so the saved panel config never carries recording=on for a
  // thermal feed.
  useEffect(() => {
    if (isThermal && config.recordingEnabled) {
      onChange({ recordingEnabled: false });
    }
  }, [isThermal, config.recordingEnabled, onChange]);

  return (
    <>
      <section className="px-3 py-3 border-b border-border space-y-2">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Static Video URL
        </Label>
        <p className="text-[10px] text-muted-foreground">
          Loop an MP4 / WebM, or embed YouTube / Vimeo. Overrides the live
          camera when set — useful for reference footage and demos.
        </p>
        <Input
          value={videoUrl}
          onChange={(e) =>
            onChange({ videoUrl: e.target.value || undefined })
          }
          placeholder="https://… .mp4   or   youtu.be/abc123"
          className="h-7 text-[11px]"
        />
        {videoUrl && (
          <div className="space-y-1.5 pt-1">
            <Label className="flex items-center gap-2 text-[11px]">
              <Checkbox
                checked={(config.autoplay as boolean) !== false}
                onCheckedChange={(c) => onChange({ autoplay: c === true })}
                className="h-3 w-3"
              />
              Autoplay
            </Label>
            <Label className="flex items-center gap-2 text-[11px]">
              <Checkbox
                checked={(config.loop as boolean) !== false}
                onCheckedChange={(c) => onChange({ loop: c === true })}
                className="h-3 w-3"
              />
              Loop
            </Label>
            <Label className="flex items-center gap-2 text-[11px]">
              <Checkbox
                checked={(config.muted as boolean) !== false}
                onCheckedChange={(c) => onChange({ muted: c === true })}
                className="h-3 w-3"
              />
              Muted
            </Label>
          </div>
        )}
      </section>

      <section className="px-3 py-3 border-b border-border space-y-3">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Live Camera
        </Label>
        {camera ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1.5 rounded">
            <Video className="h-3.5 w-3.5" />
            <span>{camera.sourceId}</span>
            <span className="text-foreground font-medium">
              {camera.cameraId}
            </span>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Select a camera from the Data Source above (used when no static
            URL is configured).
          </p>
        )}
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Frame Rate
          </Label>
          <div className="flex items-center gap-2 mt-1.5">
            <Input
              type="number"
              min={1}
              max={60}
              value={(config.frameRate as number) ?? 10}
              onChange={(e) =>
                onChange({ frameRate: parseInt(e.target.value) || 10 })
              }
              className="h-7 text-xs w-20"
            />
            <span className="text-[10px] text-muted-foreground">fps</span>
          </div>
        </div>
      </section>

      {!isThermal && (
        <section className="px-3 py-3 border-b border-border space-y-2">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Circle className="h-3 w-3 text-red-500" />
            Recording
          </Label>
          <Label className="flex items-center gap-2 text-[11px]">
            <Checkbox
              checked={!!(config.recordingEnabled as boolean)}
              onCheckedChange={(c) => onChange({ recordingEnabled: c === true })}
              className="h-3 w-3"
            />
            Enable recording controls
          </Label>
          {!!(config.recordingEnabled) && (
            <p className="text-[10px] text-muted-foreground">
              Adds a record button overlay to this feed. Recordings are saved to
              cloud storage and available under Data → Recordings.
            </p>
          )}
        </section>
      )}
    </>
  );
}
