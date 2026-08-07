"use client";

/**
 * ImagePanel — a static image with optional caption.
 *
 * Source can be either a public URL or a data: URL (the configurator
 * reads a dropped file as a data URL for v1; switch to Supabase Storage
 * once images get heavy).
 */

import { Image as ImageIcon } from "lucide-react";
import type { Panel, TimeRange } from "@/lib/types/dashboard";

interface ImagePanelProps {
  panel: Panel;
  timeRange?: TimeRange;
}

export function ImagePanel({ panel }: ImagePanelProps) {
  const url = panel.config.imageUrl as string | undefined;
  const caption = panel.config.imageCaption as string | undefined;
  const fit = (panel.config.imageFit as "contain" | "cover" | undefined) ?? "contain";

  if (!url) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-center gap-3 p-8 bg-background/40">
        <div className="rounded-full p-3 bg-muted/40 border border-border">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="text-[11px] text-muted-foreground max-w-[24ch]">
          No image. Edit the panel and upload one in the sidebar.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative bg-background/40 flex items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={caption ?? "image"}
        className={
          fit === "cover"
            ? "absolute inset-0 w-full h-full object-cover"
            : "max-w-full max-h-full object-contain"
        }
      />
      {caption && (
        <div className="absolute bottom-2 left-2 right-2 px-2 py-1 rounded bg-background/95 backdrop-blur-sm border border-border text-[10px] text-muted-foreground">
          {caption}
        </div>
      )}
    </div>
  );
}
