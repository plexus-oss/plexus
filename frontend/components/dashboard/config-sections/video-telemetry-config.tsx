"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Video } from "lucide-react";

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function VideoTelemetryConfig({ config, onChange, metrics = [] }: Props) {
  const cameraMetric = metrics.find((m) => m.includes(":$camera:"));
  const telemetryCount = metrics.filter((m) => !m.includes(":$camera:")).length;

  return (
    <div className="px-3 py-2 border-b border-border space-y-3">
      {cameraMetric ? (
        (() => {
          const markerIdx = cameraMetric.indexOf(":$camera:");
          const sourceId = cameraMetric.substring(0, markerIdx);
          const cameraId = cameraMetric.substring(markerIdx + ":$camera:".length);
          return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1.5 rounded">
              <Video className="h-3.5 w-3.5" />
              <span>{sourceId}</span>
              <span className="text-foreground font-medium">{cameraId}</span>
            </div>
          );
        })()
      ) : (
        <p className="text-[10px] text-muted-foreground">
          Select a camera from the Data Source above
        </p>
      )}

      {telemetryCount > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {telemetryCount} metric{telemetryCount !== 1 ? "s" : ""} will overlay on video
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
            onChange={(e) => onChange({ frameRate: parseInt(e.target.value) || 10 })}
            className="h-7 text-xs w-20"
          />
          <span className="text-[10px] text-muted-foreground">fps</span>
        </div>
      </div>
    </div>
  );
}
