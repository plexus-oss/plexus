"use client";

import { useState } from "react";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { getAnnotationColor } from "./colors";
import { formatRelDuration } from "./format";
import type { Annotation } from "@/lib/db/types";

type FilterType = "all" | "points" | "regions";

interface AnnotationsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  annotations: Annotation[];
  onEdit: (annotation: Annotation) => void;
  onDelete: (id: string) => void;
}

export function AnnotationsPanel({
  open,
  onOpenChange,
  annotations,
  onEdit,
  onDelete,
}: AnnotationsPanelProps) {
  const [filter, setFilter] = useState<FilterType>("all");

  const filtered = annotations.filter((a) => {
    if (filter === "points") return !a.timestamp_end;
    if (filter === "regions") return !!a.timestamp_end;
    return true;
  });

  const pointCount = annotations.filter((a) => !a.timestamp_end).length;
  const regionCount = annotations.filter((a) => !!a.timestamp_end).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-80 sm:max-w-sm p-0">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b border-border">
            <SheetHeader>
              <div className="flex items-center gap-2">
                <SheetTitle className="text-sm font-medium">
                  Annotations
                </SheetTitle>
                {annotations.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-5">
                    {annotations.length}
                  </Badge>
                )}
              </div>
              <SheetDescription className="text-xs">
                Mark events on your telemetry timeline
              </SheetDescription>
            </SheetHeader>

            {/* Filter tabs */}
            {annotations.length > 0 && (
              <div className="flex gap-1 mt-3">
                {(
                  [
                    { id: "all", label: "All", count: annotations.length },
                    { id: "points", label: "Points", count: pointCount },
                    { id: "regions", label: "Regions", count: regionCount },
                  ] as const
                ).map((tab) => (
                  <Button
                    key={tab.id}
                    variant={filter === tab.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilter(tab.id)}
                    className="h-6 text-[10px] px-2"
                  >
                    {tab.label}
                    {tab.count > 0 && (
                      <span className="ml-1 opacity-60">{tab.count}</span>
                    )}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-auto">
            {filtered.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No annotations"
                description={
                  filter !== "all"
                    ? "No matching annotations"
                    : "Press A or click Annotate on a chart, then click for a point or drag for a range."
                }
                className="h-full"
              />
            ) : (
              <div className="divide-y divide-border/50">
                {filtered.map((annotation) => {
                  const colors = getAnnotationColor(annotation.color);
                  const isRegion = !!annotation.timestamp_end;

                  return (
                    <div
                      key={annotation.id}
                      className="group flex items-start gap-2.5 px-4 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => onEdit(annotation)}
                    >
                      {/* Color dot */}
                      <div
                        className={cn(
                          "mt-1 h-2 w-2 rounded-full shrink-0",
                          colors.dot,
                        )}
                      />

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">
                            {annotation.label}
                          </span>
                          {isRegion && (
                            <Badge
                              variant="outline"
                              className="text-[9px] h-4 px-1 shrink-0"
                            >
                              Range
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {formatDistanceToNow(
                            new Date(annotation.timestamp_start),
                            { addSuffix: true },
                          )}
                          {isRegion &&
                            annotation.timestamp_end &&
                            ` \u00b7 lasted ${formatRelDuration(
                              new Date(annotation.timestamp_end).getTime() -
                                new Date(annotation.timestamp_start).getTime(),
                            )}`}
                        </div>
                        {annotation.notes && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                            {annotation.notes}
                          </div>
                        )}
                      </div>

                      {/* Actions (hover reveal) */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(annotation);
                          }}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(annotation.id);
                          }}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
