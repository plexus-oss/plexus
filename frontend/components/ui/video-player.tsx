"use client";

import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface VideoPlayerProps {
  url: string;
  className?: string;
  onClose?: () => void;
  /** Seek to this offset (seconds) once metadata loads — used for replay sync. */
  startTime?: number;
  autoPlay?: boolean;
  /** Fill the parent (object-contain) instead of the default 16:9 card. */
  fill?: boolean;
}

export function VideoPlayer({ url, className, onClose, startTime, autoPlay, fill }: VideoPlayerProps) {
  const [error, setError] = useState<string | null>(null);

  const videoEl = (extraClass?: string) => (
    <video
      src={url}
      controls
      playsInline
      autoPlay={autoPlay}
      className={cn(extraClass)}
      onLoadedMetadata={(e) => {
        if (startTime && startTime > 0) {
          const v = e.currentTarget;
          // Clamp to duration so an over-shot offset doesn't seek past the end.
          v.currentTime = Number.isFinite(v.duration)
            ? Math.min(startTime, Math.max(0, v.duration - 0.1))
            : startTime;
        }
      }}
      onError={(e) => {
        const v = e.currentTarget;
        const code = v.error?.code;
        const msgs: Record<number, string> = {
          1: "Fetch aborted",
          2: "Network error",
          3: "Decode error — file may be corrupted or unsupported format",
          4: "Format not supported",
        };
        setError(msgs[code ?? 0] ?? `Media error ${code}`);
      }}
    />
  );

  if (onClose) {
    return (
      <div className="absolute inset-0 z-30 bg-black flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 bg-black/80">
          <span className="text-xs text-white/70">Recording playback</span>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        {error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-white/60 p-4">
            <AlertTriangle className="h-6 w-6 text-yellow-500" />
            <span className="text-xs text-center">{error}</span>
            <span className="text-[10px] text-white/30 break-all">{url}</span>
          </div>
        ) : (
          videoEl("flex-1 w-full object-contain")
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("w-full rounded-lg bg-muted aspect-video flex flex-col items-center justify-center gap-2 text-muted-foreground", className)}>
        <AlertTriangle className="h-6 w-6 text-yellow-500" />
        <span className="text-sm">{error}</span>
        <span className="text-[10px] text-muted-foreground/50 break-all max-w-xs text-center">{url}</span>
      </div>
    );
  }

  if (fill) {
    return videoEl(cn("h-full w-full bg-black object-contain", className));
  }

  return videoEl(cn("w-full rounded-lg bg-black aspect-video", className));
}
