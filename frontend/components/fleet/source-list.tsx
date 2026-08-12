"use client";

import { useState, useMemo } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Server, Plus, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { EntityActions } from "@/components/ui/entity-actions";
import { useRole } from "@/hooks/use-role";
import { cn } from "@/lib/utils";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { usePrefetch } from "@/hooks/use-prefetch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ExtendedSource {
  id: string;
  slug: string;
  name: string | null;
  source_type?: "device" | "connection";
  device_type: string | null;
  status: "online" | "offline" | "pending" | "error" | "unknown";
  last_seen_at: string | null;
  metadata?: Record<string, unknown> | null;
  location?: string | null;
  _isRegistered?: boolean;
  recording?: boolean;
  metricCount?: number;
  openAlerts?: { count: number; critical: boolean };
}

interface SourceListProps {
  sources: ExtendedSource[];
  isLoading: boolean;
  onSourceClick: (id: string) => void;
  onDeleteSource: (id: string) => void;
  onAddSource?: (slug: string, platform?: string | null) => void;
  onOpenAddDevice?: () => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
}

export function SourceList({
  sources,
  isLoading,
  onSourceClick,
  onDeleteSource,
  onAddSource,
  onOpenAddDevice,
  selectedIds,
  onSelectionChange,
}: SourceListProps) {
  const selectable = !!onSelectionChange;
  const { role } = useRole();
  const prefetch = usePrefetch();
  const [contextMenuSourceId, setContextMenuSourceId] = useState<string | null>(
    null,
  );
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });

  const sortedSources = useMemo(
    () =>
      [...sources].sort((a, b) => {
        const aUnregisteredOnline = !a._isRegistered && a.status === "online";
        const bUnregisteredOnline = !b._isRegistered && b.status === "online";
        if (aUnregisteredOnline && !bUnregisteredOnline) return -1;
        if (!aUnregisteredOnline && bUnregisteredOnline) return 1;
        if (a._isRegistered && !b._isRegistered) return -1;
        if (!a._isRegistered && b._isRegistered) return 1;
        return 0;
      }),
    [sources],
  );

  const { activeIndex, activeRef } = useListNavigation({
    items: sortedSources,
    onOpen: (source) => onSourceClick(source.id),
    enabled: !isLoading && sortedSources.length > 0,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <EmptyState
        icon={Server}
        title="No devices yet"
        description="Add a device and see its data in seconds"
        className="h-full"
        action={{
          label: "Add Device",
          onClick: () => onOpenAddDevice?.(),
          shortcut: "A",
        }}
      />
    );
  }

  const allSelected =
    selectable &&
    sortedSources.length > 0 &&
    sortedSources.every((s) => selectedIds?.has(s.id));

  const someSelected =
    selectable &&
    !allSelected &&
    sortedSources.some((s) => selectedIds?.has(s.id));

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(sortedSources.map((s) => s.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectionChange(next);
  };

  return (
    <>
      <Table className="w-full">
        <TableHeader className="bg-muted/50 sticky top-0">
          <TableRow>
            {selectable && (
              <TableHead className="w-10 px-3 py-2">
                <Checkbox
                  checked={
                    allSelected ? true : someSelected ? "indeterminate" : false
                  }
                  onCheckedChange={handleSelectAll}
                />
              </TableHead>
            )}
            <TableHead className="text-left text-[10px] font-medium text-muted-foreground px-3 py-2">
              Status
            </TableHead>
            <TableHead className="text-left text-[10px] font-medium text-muted-foreground px-3 py-2">
              Device
            </TableHead>
            <TableHead className="text-left text-[10px] font-medium text-muted-foreground px-3 py-2">
              Alerts
            </TableHead>
            <TableHead className="text-left text-[10px] font-medium text-muted-foreground px-3 py-2">
              Last Seen
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedSources.map((source, index) => {
            const isUnregistered = source._isRegistered === false;
            const isClickable = true; // All sources are clickable — unregistered ones navigate to setup
            const isSelected = selectedIds?.has(source.id);
            const isActive = activeIndex === index;
            return (
              <TableRow
                key={source.id + index}
                ref={
                  isActive
                    ? (activeRef as React.Ref<HTMLTableRowElement>)
                    : undefined
                }
                tabIndex={isClickable ? 0 : -1}
                onClick={() => isClickable && onSourceClick(source.id)}
                onMouseEnter={() =>
                  prefetch(`/devices/${source.slug}`, [
                    `/api/sources/${source.slug}`,
                    `/api/devices/${source.slug}/schema`,
                  ])
                }
                onFocus={() =>
                  prefetch(`/devices/${source.slug}`, [
                    `/api/sources/${source.slug}`,
                    `/api/devices/${source.slug}/schema`,
                  ])
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenuPosition({ x: e.clientX, y: e.clientY });
                  setContextMenuSourceId(source.id);
                }}
                className={cn(
                  "border-b border-border/50 transition-colors",
                  isSelected
                    ? "bg-primary/10"
                    : isActive
                      ? "bg-accent/50 cursor-pointer"
                      : isUnregistered
                        ? "bg-primary/5 hover:bg-primary/10"
                        : "hover:bg-muted/50 cursor-pointer",
                )}
              >
                {selectable && (
                  <TableCell className="w-10 px-3 py-2">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => handleSelectOne(source.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                )}
                <TableCell className="px-3 py-2 w-10">
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      source.status === "online"
                        ? "bg-green-500"
                        : "bg-muted-foreground/30",
                    )}
                  />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate max-w-[200px]">
                        {source.name || source.slug}
                      </div>
                      {source.name && (
                        <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
                          {source.slug}
                        </div>
                      )}
                    </div>
                    {isUnregistered && (
                      <>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium shrink-0">
                          New
                        </span>
                        {onAddSource && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-5 text-[10px] px-2 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddSource(source.slug, source.device_type);
                            }}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2">
                  {source.openAlerts && source.openAlerts.count > 0 ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                        source.openAlerts.critical
                          ? "bg-red-500/10 text-red-500"
                          : "bg-amber-500/10 text-amber-500",
                      )}
                    >
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {source.openAlerts.count}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="px-3 py-2">
                  <span className="text-[10px] text-muted-foreground">
                    {source.last_seen_at
                      ? formatDistanceToNow(new Date(source.last_seen_at), {
                          addSuffix: true,
                        })
                      : "Never"}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {contextMenuSourceId &&
        (() => {
          const source = sortedSources.find(
            (s) => s.id === contextMenuSourceId,
          );
          if (!source) return null;
          return (
            <EntityActions
              entityType="device"
              entity={{ id: source.id, name: source.name || source.slug }}
              role={role}
              handlers={{
                "action-view-device": () => onSourceClick(source.id),
                "action-delete-device": () => onDeleteSource(source.id),
              }}
              open={true}
              onOpenChange={(open) => {
                if (!open) setContextMenuSourceId(null);
              }}
              anchorPosition={contextMenuPosition}
            />
          );
        })()}
    </>
  );
}
