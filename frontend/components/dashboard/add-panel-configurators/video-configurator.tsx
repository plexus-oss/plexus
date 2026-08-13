"use client";

/**
 * VideoConfigurator — two modes:
 *
 *   • Live camera — pick a camera from an online device (streams over the
 *     realtime websocket).
 *   • Embed / URL — point at an MP4/WebM, a YouTube/Vimeo link, or any
 *     generic embed URL. Stored as `config.videoUrl`; the panel detects
 *     the kind and renders an <iframe> or <video> accordingly.
 *
 * Mirrors the option set in config-sections/video-config.tsx so the modal
 * and the post-create sidebar stay in sync.
 */

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Video, Link2 } from "lucide-react";
import { SourcePicker } from "@/components/dashboard/source-picker";
import type { ConfiguratorProps } from "./types";

type VideoMode = "camera" | "embed";

export function VideoConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  const metrics = draft.metrics ?? [];
  const videoUrl = (draft.config.videoUrl as string | undefined) ?? "";

  // A "camera" is a metric whose key contains ":$camera:". The
  // DataSourceSelector emits these inline with other metrics.
  const cameraCount = metrics.filter((m) => m.includes(":$camera:")).length;

  // Mode is local UI state, seeded from whatever the draft already carries.
  const [mode, setMode] = useState<VideoMode>(videoUrl ? "embed" : "camera");

  const valid = mode === "embed" ? videoUrl.trim() !== "" : cameraCount > 0;
  useEffect(() => {
    onValidChange(valid);
  }, [valid, onValidChange]);

  const setConfig = (updates: Record<string, unknown>) =>
    onChange({ ...draft, config: { ...draft.config, ...updates } });

  // Switching modes clears the other side's binding so the panel's source
  // is unambiguous (the panel prioritizes videoUrl over the live camera).
  const switchMode = (next: VideoMode) => {
    if (next === mode) return;
    if (next === "embed") {
      onChange({ ...draft, metrics: [] });
    } else {
      setConfig({ videoUrl: undefined });
    }
    setMode(next);
  };

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex gap-1 p-0.5 rounded-md bg-muted/60 w-fit">
        {(
          [
            ["camera", "Live camera", Video],
            ["embed", "Embed / URL", Link2],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchMode(value)}
            className={
              "flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors " +
              (mode === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {mode === "camera" ? (
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Camera
          </Label>
          <p className="text-[10px] text-muted-foreground mb-2">
            Pick a camera from one of your online devices.
          </p>
          <SourcePicker
            dataSource={draft.dataSource ?? { type: "realtime" }}
            selectedMetrics={metrics}
            onDataSourceChange={(ds) =>
              onChange((prev) => ({ ...prev, dataSource: ds }))
            }
            onMetricsChange={(m) =>
              onChange((prev) => ({ ...prev, metrics: m }))
            }
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Video URL
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Loop an MP4 / WebM, or embed YouTube / Vimeo. Anything else is
            loaded as a generic embed.
          </p>
          <Input
            value={videoUrl}
            onChange={(e) =>
              setConfig({ videoUrl: e.target.value || undefined })
            }
            placeholder="https://… .mp4   or   youtu.be/abc123"
            className="h-7 text-[11px]"
          />
          {videoUrl && (
            <div className="space-y-1.5 pt-1">
              <Label className="flex items-center gap-2 text-[11px]">
                <Checkbox
                  checked={(draft.config.autoplay as boolean) !== false}
                  onCheckedChange={(c) => setConfig({ autoplay: c === true })}
                  className="h-3 w-3"
                />
                Autoplay
              </Label>
              <Label className="flex items-center gap-2 text-[11px]">
                <Checkbox
                  checked={(draft.config.loop as boolean) !== false}
                  onCheckedChange={(c) => setConfig({ loop: c === true })}
                  className="h-3 w-3"
                />
                Loop
              </Label>
              <Label className="flex items-center gap-2 text-[11px]">
                <Checkbox
                  checked={(draft.config.muted as boolean) !== false}
                  onCheckedChange={(c) => setConfig({ muted: c === true })}
                  className="h-3 w-3"
                />
                Muted
              </Label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
