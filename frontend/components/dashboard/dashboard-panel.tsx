"use client";

import { memo, ReactNode, useState } from "react";
import { GripVertical, Pencil, Filter, Trash2 } from "lucide-react";
import type { Panel } from "@/lib/types/dashboard";
import { useDashboardFilters } from "@/components/dashboard/dashboard-state-context";
import { cn } from "@/lib/utils";

interface DashboardPanelProps {
  panel: Panel;
  children: ReactNode;
  isEditing?: boolean;
  isSelected?: boolean;
  onEditClick?: () => void;
  onRemove?: () => void;
  hidePanelTitle?: boolean;
}

export const DashboardPanel = memo(function DashboardPanel({
  panel,
  children,
  isEditing = false,
  isSelected = false,
  onEditClick,
  onRemove,
  hidePanelTitle = false,
}: DashboardPanelProps) {
  const { filters: dashboardFilters } = useDashboardFilters();
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Count active filters (simple 2-level: dashboard inherited, panel overrides same-field)
  const panelFilterCount = (panel.config.filters || []).filter(
    (f) => f.enabled !== false
  ).length;
  const panelFilterFields = new Set(
    (panel.config.filters || []).map((f) => f.field)
  );
  const inheritedFilterCount = (dashboardFilters || []).filter(
    (f) =>
      f.enabled !== false &&
      !panelFilterFields.has(f.field)
  ).length;
  const totalFilterCount = panelFilterCount + inheritedFilterCount;
  const hasOverrides = panelFilterCount > 0;

  // Dashboard-link cards render their OWN material surface (border, elevation,
  // rounded corners). In view mode, skip the panel chrome so we don't double-box
  // it; edit mode keeps the chrome for the drag/edit affordances.
  if (panel.type === "dashboard" && !isEditing) {
    return <div className="h-full">{children}</div>;
  }

  return (
    <div
      className={cn(
        "h-full flex flex-col bg-card rounded-lg overflow-hidden group",
        "border border-border",
        isSelected && "ring-2 ring-primary/20 border-primary/30",
      )}
    >
      <div className="flex-1 min-h-0 relative">
        {/* Floating title bar. The bar only fully hides when titles are hidden
            AND we're not editing — in edit mode the controls must stay reachable
            (otherwise hidePanelTitles dashboards like the fleet have no way to
            edit/remove a panel). The title TEXT hides independently. */}
        <div className={cn(
          "absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-2",
          hidePanelTitle && !isEditing && "hidden",
        )}>
          <div className={cn("flex items-center gap-1.5", hidePanelTitle && "hidden")}>
            <span className="text-[11px] font-medium text-muted-foreground">
              {panel.title}
            </span>

            {/* Filter badge — visible on hover */}
            {totalFilterCount > 0 && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium opacity-0 group-hover:opacity-100 transition-opacity",
                  hasOverrides
                    ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                )}
                title={
                  hasOverrides
                    ? `${panelFilterCount} panel filter${panelFilterCount !== 1 ? "s" : ""}${inheritedFilterCount > 0 ? `, ${inheritedFilterCount} inherited` : ""}`
                    : `${inheritedFilterCount} dashboard filter${inheritedFilterCount !== 1 ? "s" : ""}`
                }
              >
                <Filter className="h-2.5 w-2.5" />
                {totalFilterCount}
              </span>
            )}
          </div>

          {isEditing && (
            <div className="flex items-center gap-1 rounded-md bg-background/70 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditClick?.();
                }}
                title="Edit panel"
                className="p-1 rounded hover:bg-muted/50 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground/70" />
              </button>
              <div
                className="panel-drag-handle cursor-move p-1 rounded hover:bg-muted/50 transition-colors"
                title="Drag to move"
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/70" />
              </div>
              {onRemove && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirmRemove) {
                      onRemove();
                    } else {
                      setConfirmRemove(true);
                      window.setTimeout(() => setConfirmRemove(false), 2500);
                    }
                  }}
                  title={confirmRemove ? "Click again to remove" : "Remove panel"}
                  className={cn(
                    "p-1 rounded transition-colors",
                    confirmRemove ? "bg-red-500/20" : "hover:bg-muted/50",
                  )}
                >
                  <Trash2
                    className={cn(
                      "h-3.5 w-3.5",
                      confirmRemove ? "text-red-500" : "text-muted-foreground/70",
                    )}
                  />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Content with top padding for title */}
        <div className="h-full pt-7">{children}</div>
      </div>
    </div>
  );
});
