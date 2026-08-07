"use client";

import { useMemo, useState } from "react";
import { usePanelData } from "@/hooks/use-panel-data";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { useFormattedTime } from "@/hooks/use-formatted-time";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import { PanelRestrictedState } from "@/components/dashboard/panels/restricted-state";
import { PanelFilterBar } from "@/components/dashboard/panels/panel-filter-bar";
import { DataGrid, type Column } from "@/components/ui/charts/data-grid";

interface DataGridPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

const NUMERIC_TYPES = new Set([
  "number",
  "UInt32",
  "UInt64",
  "Int32",
  "Int64",
  "Float32",
  "Float64",
]);
const TIMESTAMP_TYPES = new Set(["DateTime", "DateTime64"]);

export function DataGridPanel({ panel, timeRange }: DataGridPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { formatTime } = useFormattedTime();

  const {
    data,
    isLoading,
    error,
    restricted,
    refresh,
    sourceType,
    metrics: displayedMetrics,
    connectionMeta,
  } = usePanelData({ panel, timeRange });

  const useConnection = sourceType === "connection";

  const { columns, rows } = useMemo(() => {
    if (useConnection && connectionMeta) {
      if (connectionMeta.rows.length === 0) return { columns: [], rows: [] };
      const cols: Column[] = connectionMeta.columns.map((col) => {
        const isNumeric = NUMERIC_TYPES.has(col.type);
        const isTimestamp = TIMESTAMP_TYPES.has(col.type);
        return {
          id: col.name,
          label: col.name,
          type: isNumeric ? "number" : isTimestamp ? "timestamp" : "text",
          alignment: isNumeric ? "right" : "left",
        };
      });
      return { columns: cols, rows: connectionMeta.rows };
    }

    if (!data || Object.keys(data).length === 0) {
      return { columns: [], rows: [] };
    }

    const cols: Column[] = [
      { id: "timestamp", label: "Time", type: "text", alignment: "left" },
      ...displayedMetrics.map((m) => ({
        id: m,
        label: m.includes(":") ? m.split(":")[1] : m,
        type: "number" as const,
        alignment: "right" as const,
      })),
    ];

    const timestampSet = new Set<string>();
    for (const m of displayedMetrics) {
      for (const p of data[m] || []) timestampSet.add(p.timestamp);
    }
    const timestamps = Array.from(timestampSet).sort().reverse();

    const metricMaps = new Map<string, Map<string, unknown>>();
    for (const m of displayedMetrics) {
      const lookup = new Map<string, unknown>();
      for (const p of data[m] || []) lookup.set(p.timestamp, p.value);
      metricMaps.set(m, lookup);
    }

    const rowData = timestamps.map((ts) => {
      const row: Record<string, unknown> = {
        timestamp: formatTime(new Date(ts)),
        _rawTimestamp: ts,
      };
      for (const m of displayedMetrics) {
        row[m] = metricMaps.get(m)!.get(ts) ?? null;
      }
      return row;
    });

    return { columns: cols, rows: rowData };
  }, [useConnection, connectionMeta, data, displayedMetrics, formatTime]);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => {
        const val = row[col.id];
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(q);
      }),
    );
  }, [rows, columns, searchQuery]);

  const totalRows = rows.length;

  if (isLoading && rows.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Access-scope denial is an expected state for scoped viewers, not an error.
  if (restricted) {
    return <PanelRestrictedState />;
  }

  if (error) {
    return (
      <PanelEmptyState
        reason="query_error"
        debugInfo={{
          sourceType: useConnection ? "connection" : "realtime",
          errorMessage: error instanceof Error ? error.message : String(error),
        }}
        onRetry={refresh}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <PanelEmptyState
        reason="no_data"
        debugInfo={{
          sourceType: useConnection ? "connection" : "realtime",
          rowCount: connectionMeta?.rowCount ?? 0,
          queryTimeMs: connectionMeta?.executionTimeMs,
          columns: connectionMeta?.columns.map((c) => c.name),
        }}
        onRetry={refresh}
      />
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <PanelFilterBar
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Filter rows"
        count={filteredRows.length}
        total={totalRows}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        <DataGrid
          columns={columns}
          data={filteredRows}
          width="100%"
          height="100%"
          rowHeight={28}
          headerHeight={28}
          sortable
          virtualScrolling
          highlightOnHover
          alternateRows={false}
        />
      </div>

      <div className="shrink-0 flex items-center justify-between px-2.5 h-6 border-t border-border/40 text-[11px] text-muted-foreground/60">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1">
            <span className="h-1 w-1 rounded-full bg-emerald-500/70" />
            <span className="lowercase tracking-tight">
              {useConnection ? "sql" : "realtime"}
            </span>
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span className="tabular-nums">
            {columns.length} {columns.length === 1 ? "col" : "cols"}
          </span>
        </div>
        {connectionMeta && connectionMeta.executionTimeMs > 0 && (
          <span className="tabular-nums text-muted-foreground/50">
            {connectionMeta.executionTimeMs}
            <span className="text-muted-foreground/30 ml-0.5">ms</span>
          </span>
        )}
      </div>
    </div>
  );
}
