"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFormattedTime } from "@/hooks/use-formatted-time";
import type { DataRow, SortState, TableColumn, TelemetryData } from "@/lib/types/table";
import { formatPanelValue, type ValueNotation } from "@/lib/dashboard/format-value";

interface DataTableProps {
  data: TelemetryData;
  metrics: string[];
  decimals?: number;
  notation?: ValueNotation;
  colors?: string[];
  hoveredTimestamp?: string | null;
  onHover?: (timestamp: string | null) => void;
  enableExport?: boolean;
  onExport?: () => void;
}

export function DataTable({
  data,
  metrics,
  decimals = 2,
  notation,
  colors = [],
  hoveredTimestamp,
  onHover,
  enableExport = false,
  onExport,
}: DataTableProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const { formatTime } = useFormattedTime();
  const [sortState, setSortState] = useState<SortState>({
    columnId: null,
    direction: null,
  });

  const { columns, rows } = useMemo(() => {
    if (!data || Object.keys(data).length === 0) {
      return { columns: [] as TableColumn[], rows: [] as DataRow[] };
    }

    const cols: TableColumn[] = [
      { id: "time", label: "Time", width: 100, editable: false, sortable: true },
      ...metrics.map((metric) => ({
        id: metric,
        label: metric,
        width: 100,
        editable: false,
        sortable: true,
      })),
    ];

    const timestampMap = new Map<string, DataRow>();
    for (const metric of metrics) {
      const points = data[metric] || [];
      for (const point of points) {
        const existing =
          timestampMap.get(point.timestamp) ||
          ({
            id: point.id || point.timestamp,
            timestamp: point.timestamp,
            time: formatTime(point.timestamp),
          } as DataRow);
        existing[metric] = point.value;
        timestampMap.set(point.timestamp, existing);
      }
    }

    const tableRows = Array.from(timestampMap.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return { columns: cols, rows: tableRows };
  }, [data, metrics, formatTime]);

  const sortedRows = useMemo(() => {
    if (!sortState.columnId || !sortState.direction) return rows;
    return [...rows].sort((a, b) => {
      if (sortState.columnId === "time") {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        return sortState.direction === "asc" ? aTime - bTime : bTime - aTime;
      }
      const aVal = a[sortState.columnId!];
      const bVal = b[sortState.columnId!];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortState.direction === "asc" ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal ?? "");
      const bStr = String(bVal ?? "");
      return sortState.direction === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [rows, sortState]);

  const handleSort = useCallback((columnId: string) => {
    setSortState((prev) => {
      if (prev.columnId !== columnId) return { columnId, direction: "asc" };
      if (prev.direction === "asc") return { columnId, direction: "desc" };
      return { columnId: null, direction: null };
    });
  }, []);

  const formatValue = useCallback(
    (value: unknown) => {
      if (value === null || value === undefined) return "-";
      if (typeof value === "number")
        return formatPanelValue(value, decimals, notation) ?? String(value);
      return String(value);
    },
    [decimals, notation]
  );

  useEffect(() => {
    if (!hoveredTimestamp || !tableRef.current) return;
    const rowIdx = sortedRows.findIndex((r) => r.timestamp === hoveredTimestamp);
    if (rowIdx === -1) return;
    const rowElement = tableRef.current.querySelector(`[data-row-idx="${rowIdx}"]`);
    if (rowElement) {
      rowElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [hoveredTimestamp, sortedRows]);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-muted-foreground border-t border-border">
        No data available
      </div>
    );
  }

  const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);

  return (
    <div
      ref={tableRef}
      className="h-full overflow-auto border-t border-border relative"
    >
      <div style={{ minWidth: totalWidth }}>
        <div className="sticky top-0 z-10 flex border-b border-border bg-muted/80 backdrop-blur-sm">
          {columns.map((col) => {
            const isSorted = sortState.columnId === col.id;
            const sortDirection = isSorted ? sortState.direction : null;
            return (
              <div
                key={col.id}
                style={{ width: col.width, minWidth: col.width }}
                className={cn(
                  "h-8 px-2 flex items-center justify-between text-xs font-medium text-muted-foreground border-r border-border last:border-r-0 select-none",
                  col.sortable &&
                    "cursor-pointer hover:text-foreground hover:bg-muted transition-colors"
                )}
                onClick={() => col.sortable && handleSort(col.id)}
              >
                <span className="truncate">{col.label}</span>
                {col.sortable && (
                  <span className="ml-1 text-[10px] opacity-60">
                    {sortDirection === "asc" ? "↑" : sortDirection === "desc" ? "↓" : "⇅"}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div>
          {sortedRows.map((row, rowIndex) => {
            const isHighlighted = hoveredTimestamp === row.timestamp;
            return (
              <div
                key={row.id}
                data-row-idx={rowIndex}
                className={cn(
                  "flex border-b border-border group transition-colors",
                  isHighlighted
                    ? "bg-zinc-200/70 dark:bg-zinc-700/70"
                    : rowIndex % 2 === 1
                    ? "bg-muted/30"
                    : "bg-transparent",
                  !isHighlighted && "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                )}
                onMouseEnter={() => onHover?.(row.timestamp)}
                onMouseLeave={() => onHover?.(null)}
              >
                {columns.map((col, colIdx) => (
                  <div
                    key={col.id}
                    style={{ width: col.width, minWidth: col.width }}
                    className="h-8 px-2 flex items-center text-xs border-r border-border"
                  >
                    {col.id === "time" ? (
                      <span
                        className={cn(
                          "truncate font-mono text-[11px]",
                          isHighlighted ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {row.time}
                      </span>
                    ) : (
                      <span
                        className="truncate font-mono"
                        style={{
                          color:
                            isHighlighted && colors[colIdx - 1]
                              ? colors[colIdx - 1]
                              : undefined,
                        }}
                      >
                        {formatValue(row[col.id])}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {enableExport && onExport && (
        <div className="sticky bottom-0 left-0 right-0 flex items-center justify-between gap-2 p-2 bg-background/80 backdrop-blur-sm border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={onExport}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </Button>
        </div>
      )}
    </div>
  );
}
