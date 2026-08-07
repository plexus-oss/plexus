"use client";

/**
 * FileDrop — shared drop-zone primitive used by configurators that need
 * an inline file upload (Schematic SVG, 3D Model GLB, Image).
 *
 * Reads the file as text or as a data URL and hands the result to the
 * caller. Renders the empty state, the filled state with replace/clear,
 * and an optional URL-paste fallback below.
 */

import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface FileDropProps {
  /** Accept attribute, e.g. ".svg,image/svg+xml" */
  accept: string;
  /** lucide icon shown in the empty state. */
  icon: LucideIcon;
  /** Empty-state primary label. */
  label: string;
  /** Empty-state secondary hint. */
  hint?: string;
  /** Optional placeholder for the URL paste input. Hides the input when omitted. */
  urlPlaceholder?: string;
  /** Maximum file size in bytes; default 50MB. */
  maxBytes?: number;
  /** How to read the file. */
  readAs: "text" | "dataURL";
  /**
   * Called once a file is read or a URL is pasted. For "text" reads the
   * caller gets the raw text; for "dataURL" they get a data: URL string.
   * For pasted URLs the caller gets the URL string as-is.
   */
  onChange: (
    value: string | null,
    meta: { source: "file" | "url"; filename?: string },
  ) => void;
  /** Current value — shown as filename/url + replace/clear when set. */
  currentValue?: string;
  /** Optional one-line display of the current value (e.g. filename). */
  currentLabel?: string;
}

export function FileDrop({
  accept,
  icon: Icon,
  label,
  hint,
  urlPlaceholder,
  maxBytes = 50 * 1024 * 1024,
  readAs,
  onChange,
  currentValue,
  currentLabel,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");

  const readFile = (file: File) => {
    setError(null);
    if (file.size > maxBytes) {
      setError(`File too large (>${Math.round(maxBytes / 1024 / 1024)}MB).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        onChange(result, { source: "file", filename: file.name });
      }
    };
    reader.onerror = () => {
      setError("Could not read file.");
    };
    if (readAs === "text") reader.readAsText(file);
    else reader.readAsDataURL(file);
  };

  if (currentValue) {
    return (
      <div className="space-y-2">
        <div className="rounded border border-border bg-muted/20 px-2 py-2 flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-foreground/70 shrink-0" />
          <div className="flex-1 truncate text-[11px]">
            {currentLabel ?? "Loaded"}
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] flex-1"
            onClick={() => onChange(null, { source: "file" })}
          >
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] flex-1"
            onClick={() => inputRef.current?.click()}
          >
            Replace
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) readFile(f);
        }}
        className={
          "w-full rounded-md border border-dashed transition-colors flex flex-col items-center justify-center gap-2 px-4 py-8 " +
          (dragging
            ? "border-foreground/40 bg-muted/40"
            : "border-border bg-muted/20 hover:bg-muted/30 hover:border-border/60")
        }
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">{label}</span>
        {hint && (
          <span className="text-[10px] text-muted-foreground">{hint}</span>
        )}
      </button>
      {urlPlaceholder !== undefined && (
        <div className="flex gap-1.5">
          <Input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder={urlPlaceholder}
            className="h-7 text-[11px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && urlDraft.trim()) {
                e.preventDefault();
                onChange(urlDraft.trim(), { source: "url" });
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={!urlDraft.trim()}
            onClick={() => onChange(urlDraft.trim(), { source: "url" })}
          >
            Load
          </Button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) readFile(f);
          e.target.value = "";
        }}
      />
      {error && (
        <p className="text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}
