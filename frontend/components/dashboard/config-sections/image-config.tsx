"use client";

import { useRef, useState } from "react";
import { Upload, AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB — beyond this, data URLs get unwieldy in JSONB

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}

export function ImageConfig({ config, onChange }: Props) {
  const imageUrl = config.imageUrl as string | undefined;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please pick an image file.");
      return;
    }
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      setError(`Image is larger than ${MAX_INLINE_IMAGE_BYTES / 1024 / 1024}MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        onChange({ imageUrl: result });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <section className="px-3 py-3 border-b border-border space-y-2">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Image
        </Label>
        {imageUrl ? (
          <div className="space-y-2">
            <div className="rounded border border-border bg-muted/20 p-1 max-h-36 overflow-hidden flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="preview"
                className="max-h-32 object-contain"
              />
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] flex-1"
                onClick={() => onChange({ imageUrl: undefined })}
              >
                Clear
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] flex-1"
                onClick={() => fileInputRef.current?.click()}
              >
                Replace
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-20 rounded-md border border-dashed border-border bg-muted/20 hover:bg-muted/30 hover:border-border/60 transition-colors flex flex-col items-center justify-center gap-1.5"
          >
            <Upload className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              Upload PNG / JPG / WebP
            </span>
          </button>
        )}
        <Input
          value={(imageUrl?.startsWith("data:") ? "" : imageUrl) ?? ""}
          onChange={(e) =>
            onChange({ imageUrl: e.target.value || undefined })
          }
          placeholder="…or paste an image URL"
          className="h-7 text-[11px]"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) await handleFile(file);
            e.target.value = "";
          }}
        />
        {error && (
          <p className="text-[11px] text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {error}
          </p>
        )}
      </section>

      <section className="px-3 py-3 border-b border-border space-y-2">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Display
        </Label>
        <div>
          <Label className="text-[10px] text-muted-foreground">Caption</Label>
          <Input
            value={(config.imageCaption as string) ?? ""}
            onChange={(e) =>
              onChange({ imageCaption: e.target.value || undefined })
            }
            placeholder="Optional"
            className="h-7 text-[11px] mt-0.5"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Fit</Label>
          <Select
            value={(config.imageFit as string) ?? "contain"}
            onValueChange={(v) => onChange({ imageFit: v })}
          >
            <SelectTrigger className="h-7 text-[11px] mt-0.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contain" className="text-xs">
                Contain (fit to box)
              </SelectItem>
              <SelectItem value="cover" className="text-xs">
                Cover (fill box, crop edges)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>
    </>
  );
}
