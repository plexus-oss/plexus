"use client";

import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FileDrop } from "./file-drop";
import type { ConfiguratorProps } from "./types";

const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;

export function ImageConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  const imageUrl = draft.config.imageUrl as string | undefined;
  const caption = draft.config.imageCaption as string | undefined;
  const [filename, setFilename] = useState<string | undefined>();

  useEffect(() => {
    onValidChange(!!imageUrl);
  }, [imageUrl, onValidChange]);

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Image
        </Label>
        <div className="mt-1.5">
          <FileDrop
            accept="image/*"
            icon={ImageIcon}
            label="Drop image"
            hint="PNG, JPG, WebP — up to 4MB"
            urlPlaceholder="…or paste an image URL"
            maxBytes={MAX_INLINE_IMAGE_BYTES}
            readAs="dataURL"
            onChange={(value, meta) => {
              if (meta.source === "url" && value) {
                onChange({
                  ...draft,
                  config: { ...draft.config, imageUrl: value },
                });
                setFilename(undefined);
              } else if (value) {
                onChange({
                  ...draft,
                  config: { ...draft.config, imageUrl: value },
                });
                setFilename(meta.filename);
              } else {
                onChange({
                  ...draft,
                  config: { ...draft.config, imageUrl: undefined },
                });
                setFilename(undefined);
              }
            }}
            currentValue={imageUrl}
            currentLabel={
              filename ??
              (imageUrl?.startsWith("data:") ? "Inline image" : imageUrl)
            }
          />
        </div>
      </div>

      {imageUrl && (
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Caption (optional)
          </Label>
          <Input
            value={caption ?? ""}
            onChange={(e) =>
              onChange({
                ...draft,
                config: {
                  ...draft.config,
                  imageCaption: e.target.value || undefined,
                },
              })
            }
            className="h-7 text-[11px] mt-1.5"
            placeholder="e.g. Power slice schematic v2"
          />
        </div>
      )}
    </div>
  );
}
