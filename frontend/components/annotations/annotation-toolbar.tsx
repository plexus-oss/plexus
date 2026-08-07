"use client";

import { Eye, EyeOff, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnnotationModeType } from "@/hooks/use-annotation-mode";

interface AnnotationToolbarProps {
  mode: AnnotationModeType;
  setMode: (mode: AnnotationModeType) => void;
  annotationCount: number;
  onShowPanel: () => void;
  /** Runtime show/hide for markers; toggle hidden when undefined */
  annotationsVisible?: boolean;
  onToggleVisibility?: () => void;
  canToggleVisibility?: boolean;
}

const buttonClass = (active: boolean) =>
  cn(
    "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors",
    active
      ? "text-foreground bg-muted"
      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
  );

export function AnnotationToolbar({
  mode,
  setMode,
  annotationCount,
  onShowPanel,
  annotationsVisible = true,
  onToggleVisibility,
  canToggleVisibility = false,
}: AnnotationToolbarProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setMode(mode === "off" ? "on" : "off")}
        className={buttonClass(mode !== "off")}
        title="Annotate (A)"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Annotate</span>
      </button>
      {annotationCount > 0 && canToggleVisibility && onToggleVisibility && (
        <button
          onClick={onToggleVisibility}
          className={cn(
            buttonClass(false),
            !annotationsVisible && "text-muted-foreground/60",
          )}
          title={annotationsVisible ? "Hide annotations" : "Show annotations"}
          aria-label={
            annotationsVisible ? "Hide annotations" : "Show annotations"
          }
          aria-pressed={!annotationsVisible}
        >
          {annotationsVisible ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      {annotationCount > 0 && (
        <button
          onClick={onShowPanel}
          className={cn(buttonClass(false), "tabular-nums")}
          title="View annotations"
        >
          <span>{annotationCount}</span>
        </button>
      )}
    </div>
  );
}

/** Annotation mode indicator badge shown inside the panel */
export function AnnotationModeIndicator({
  mode,
  onClose,
}: {
  mode: AnnotationModeType;
  onClose: () => void;
}) {
  if (mode === "off") return null;

  return (
    <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 bg-popover/90 text-muted-foreground text-[10px] px-2.5 py-1 rounded-full border border-border/50 shadow-sm">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-foreground/40 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-foreground/60" />
      </span>
      <span>
        <span className="text-foreground/80">Click</span> point
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span>
        <span className="text-foreground/80">Drag</span> range
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span>
        <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[9px]">
          Esc
        </kbd>{" "}
        exit
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Exit annotation mode"
        className="ml-0.5 hover:text-foreground transition-colors"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}
