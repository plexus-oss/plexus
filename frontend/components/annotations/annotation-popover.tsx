"use client";

import { useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ANNOTATION_COLORS,
  type AnnotationColor,
} from "./colors";
import { formatRelDuration } from "./format";

export type { AnnotationColor } from "./colors";

interface AnnotationPopoverProps {
  /** Position to anchor the popover (screen coordinates) */
  x: number;
  y: number;
  /** Pre-fill for editing an existing annotation */
  initialLabel?: string;
  initialColor?: string;
  initialNotes?: string;
  /** Timestamps for display (read-only) */
  timestamp?: string;
  timestampEnd?: string;
  /** Show delete button (only for existing annotations) */
  showDelete?: boolean;
  /** Called on save (Enter key) */
  onSave: (label: string, color: AnnotationColor, notes: string) => void;
  /** Called on delete */
  onDelete?: () => void;
  /** Called on dismiss (Escape or click outside) */
  onDismiss: () => void;
}

function formatPopoverTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

const kbdClass =
  "rounded border border-border bg-muted px-1 py-px font-mono text-[9px]";

export function AnnotationPopover({
  x,
  y,
  initialLabel = "",
  initialColor = "amber",
  initialNotes = "",
  timestamp,
  timestampEnd,
  showDelete = false,
  onSave,
  onDelete,
  onDismiss,
}: AnnotationPopoverProps) {
  const [label, setLabel] = useState(initialLabel);
  const [notes, setNotes] = useState(initialNotes);
  const [color, setColor] = useState<AnnotationColor>(
    ANNOTATION_COLORS.some((c) => c.id === initialColor)
      ? (initialColor as AnnotationColor)
      : "amber",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Virtual anchor at the click point. PopoverContent portals to
  // document.body, escaping CSS transform containment from
  // react-grid-layout, and Radix handles viewport collision.
  const virtualRef = useMemo(
    () => ({
      current: { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) },
    }),
    [x, y],
  );

  const handleSave = () => {
    if (label.trim()) {
      onSave(label.trim(), color, notes.trim());
    }
  };

  const durationMs =
    timestamp && timestampEnd
      ? new Date(timestampEnd).getTime() - new Date(timestamp).getTime()
      : null;

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-[300px] p-0 overflow-hidden"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="p-3 space-y-2">
          <Input
            ref={inputRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
            placeholder="Add annotation…"
            className="h-7 text-xs"
            maxLength={500}
          />

          {timestamp && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="font-mono">
                {formatPopoverTimestamp(timestamp)}
                {timestampEnd &&
                  ` — ${formatPopoverTimestamp(timestampEnd)}`}
              </span>
              {durationMs !== null && (
                <span className="text-muted-foreground/70">
                  {formatRelDuration(durationMs)}
                </span>
              )}
              {timestampEnd && (
                <Badge variant="outline" className="text-[9px] h-4 px-1">
                  Range
                </Badge>
              )}
            </div>
          )}

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
            placeholder="Notes (optional)"
            className="min-h-[48px] text-xs resize-none"
            rows={2}
            maxLength={2000}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={c.id}
                  onClick={() => setColor(c.id)}
                  className={cn(
                    "h-4 w-4 rounded-full transition-all",
                    c.dot,
                    color === c.id
                      ? "ring-2 ring-ring ring-offset-2 ring-offset-popover"
                      : "opacity-40 hover:opacity-80",
                  )}
                />
              ))}
            </div>

            {showDelete && onDelete && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete annotation"
                onClick={onDelete}
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/50 bg-muted/30 px-3 py-1.5">
          <div className="text-[10px] text-muted-foreground">
            <kbd className={kbdClass}>{"↵"}</kbd> save
            {" · "}
            <kbd className={kbdClass}>esc</kbd> cancel
          </div>
          <Button
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={!label.trim()}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
