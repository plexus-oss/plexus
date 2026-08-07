"use client";

import { useState, useEffect, useCallback } from "react";
import { useAnnotations } from "@/hooks/use-annotations";
import type { Annotation } from "@/lib/db/types";
import type { AnnotationColor } from "@/components/annotations/colors";

export type AnnotationModeType = "off" | "on";

export interface PopoverState {
  x: number;
  y: number;
  timestamp: string;
  timestampEnd?: string;
  editingId?: string;
  initialLabel?: string;
  initialColor?: string;
  initialNotes?: string;
}

export interface PendingAnnotation {
  timestampStart: string;
  timestampEnd?: string;
  pxStart: number;
  pxEnd?: number;
}

interface UseAnnotationModeOptions {
  sourceId?: string | null;
  enabled?: boolean;
}

export function useAnnotationMode({
  sourceId,
  enabled = true,
}: UseAnnotationModeOptions) {
  const {
    annotations,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
  } = useAnnotations({
    sourceId: sourceId || undefined,
    enabled: enabled && !!sourceId,
  });

  const [mode, setMode] = useState<AnnotationModeType>("off");
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [pending, setPending] = useState<PendingAnnotation | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Keyboard shortcut: A cycles annotation modes, Escape cancels drag
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        popover
      )
        return;
      if (e.key === "Escape" && isDragging) {
        e.preventDefault();
        setIsDragging(false);
        setPending(null);
        return;
      }
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        setMode((prev) => {
          if (prev === "on") {
            setPending(null);
            setIsDragging(false);
          }
          return prev === "off" ? "on" : "off";
        });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [popover, isDragging]);

  const openPopover = useCallback(
    (x: number, y: number, timestamp: string, timestampEnd?: string) => {
      setPopover({ x, y, timestamp, timestampEnd });
    },
    [],
  );

  const openEditPopover = useCallback(
    (annotation: Annotation, x: number, y: number) => {
      setPopover({
        x,
        y,
        timestamp: annotation.timestamp_start,
        timestampEnd: annotation.timestamp_end || undefined,
        editingId: annotation.id,
        initialLabel: annotation.label,
        initialColor: annotation.color || "amber",
        initialNotes: annotation.notes || "",
      });
    },
    [],
  );

  const closePopover = useCallback(() => {
    setPopover(null);
    setPending(null);
    setMode("off");
  }, []);

  const handleSave = useCallback(
    (label: string, color: AnnotationColor, notes: string) => {
      if (!popover || !sourceId) return;
      if (popover.editingId) {
        updateAnnotation(popover.editingId, {
          label,
          color,
          notes: notes || null,
        });
      } else {
        createAnnotation({
          source_id: sourceId,
          timestamp_start: popover.timestamp,
          timestamp_end: popover.timestampEnd || null,
          label,
          color,
          notes: notes || null,
        });
      }
      setPopover(null);
      setPending(null);
      setMode("off");
    },
    [popover, sourceId, createAnnotation, updateAnnotation],
  );

  const handleDelete = useCallback(() => {
    if (!popover?.editingId) return;
    deleteAnnotation(popover.editingId);
    setPopover(null);
    setPending(null);
    setMode("off");
  }, [popover, deleteAnnotation]);

  const handlePanelEdit = useCallback(
    (annotation: Annotation) => {
      setPopover({
        x: window.innerWidth / 2,
        y: window.innerHeight / 3,
        timestamp: annotation.timestamp_start,
        timestampEnd: annotation.timestamp_end || undefined,
        editingId: annotation.id,
        initialLabel: annotation.label,
        initialColor: annotation.color || "amber",
        initialNotes: annotation.notes || "",
      });
      setShowPanel(false);
    },
    [],
  );

  return {
    annotations,
    mode,
    setMode,
    popover,
    showPanel,
    setShowPanel,
    openPopover,
    openEditPopover,
    closePopover,
    handleSave,
    handleDelete,
    handlePanelEdit,
    deleteAnnotation,
    pending,
    setPending,
    isDragging,
    setIsDragging,
  };
}
