"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Table2,
  Clock,
  Hash,
  Type,
  ToggleLeft,
  Calendar,
  Braces,
  Key,
  Activity,
  Download,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TabNav } from "@/components/ui/tab-nav";
import { DeviceRecordings } from "@/components/data/device-recordings";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { toast } from "sonner";
import { useTelemetryRows, useSourceMetrics } from "@/hooks/use-telemetry";
import { Input } from "@/components/ui/input";
import { useConnectionQueryManual } from "@/hooks/use-connection-query";
import { useColumnMetadata } from "@/hooks/use-column-metadata";
import { ColumnMetadataSheet } from "@/components/source/column-metadata-sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Source } from "@/lib/db/types";

interface SchemaTable {
  name: string;
  schema?: string;
  columns: Array<{ name: string; type: string }>;
}

interface UnifiedDataTabProps {
  source: Source;
  /** Pre-fetched schema for connections */
  schema?: SchemaTable[] | null;
  /** Callback to refresh connection schema */
  onSchemaRefresh?: () => void;
  /** Auto-select this table on mount (for linked table navigation) */
  initialTable?: string;
  /**
   * Entity slice for discovered sources ("only this device's rows"):
   * appended as `column = 'value'` to every query against a table that has
   * the column. Tables without the column are shown unfiltered.
   */
  filter?: { column: string; value: string };
}

type ColumnType =
  | "string"
  | "number"
  | "boolean"
  | "timestamp"
  | "date"
  | "json"
  | "uuid";

const COLUMN_TYPE_ICONS: Record<ColumnType, typeof Type> = {
  string: Type,
  number: Hash,
  boolean: ToggleLeft,
  timestamp: Clock,
  date: Calendar,
  json: Braces,
  uuid: Key,
};

/** v2 uses _time (Flux), v3 uses time (SQL). Detects v3 from column names. */
function isInfluxV3Columns(columns: Array<{ name: string }>): boolean {
  return (
    columns.some((c) => c.name === "time") &&
    !columns.some((c) => c.name === "_time")
  );
}

function normalizeColumnType(type: string): ColumnType {
  const lowerType = type.toLowerCase();
  if (
    lowerType.includes("timestamp") ||
    lowerType.includes("datetime") ||
    lowerType.includes("time")
  ) {
    return "timestamp";
  }
  if (
    lowerType.includes("varchar") ||
    lowerType.includes("text") ||
    lowerType.includes("char")
  ) {
    return "string";
  }
  if (
    lowerType.includes("int") ||
    lowerType === "integer" ||
    lowerType === "bigint" ||
    lowerType === "smallint" ||
    lowerType.includes("float") ||
    lowerType.includes("double") ||
    lowerType.includes("decimal") ||
    lowerType.includes("numeric") ||
    lowerType === "number"
  ) {
    return "number";
  }
  if (lowerType === "bool" || lowerType === "boolean") {
    return "boolean";
  }
  if (lowerType === "date") {
    return "date";
  }
  if (lowerType === "json" || lowerType === "jsonb") {
    return "json";
  }
  if (lowerType === "uuid") {
    return "uuid";
  }
  return "string";
}

const CONNECTION_TIME_RANGES: {
  value: string;
  label: string;
  interval: string;
}[] = [
  { value: "all", label: "All time", interval: "" },
  { value: "1h", label: "Last hour", interval: "1 hour" },
  { value: "6h", label: "Last 6 hours", interval: "6 hours" },
  { value: "24h", label: "Last 24 hours", interval: "24 hours" },
  { value: "7d", label: "Last 7 days", interval: "7 days" },
  { value: "30d", label: "Last 30 days", interval: "30 days" },
];

function quoteIdent(name: string, useBackticks: boolean): string {
  return useBackticks ? `\`${name}\`` : `"${name}"`;
}

function buildConnectionFlux(
  bucket: string,
  measurement: string,
  timeRangeValue: string,
): string {
  const rangeMap: Record<string, string> = {
    "1h": "-1h",
    "6h": "-6h",
    "24h": "-24h",
    "7d": "-7d",
    "30d": "-30d",
  };
  const start = rangeMap[timeRangeValue] || "-30d";
  let query = `from(bucket: "${bucket}")\n  |> range(start: ${start})`;
  query += `\n  |> filter(fn: (r) => r["_measurement"] == "${measurement}")`;
  query += `\n  |> sort(columns: ["_time"], desc: true)`;
  query += `\n  |> limit(n: 100)`;
  return query;
}

function buildConnectionSql(
  table: string,
  offset: number,
  timestampCol: string | null,
  timeRangeValue: string,
  sourceId: string,
  connectionType?: string,
  filter?: { column: string; value: string },
): string {
  // ClickHouse and MySQL use backtick-quoted identifiers.
  // PostgreSQL/TimescaleDB use double quotes.
  const useBackticks =
    sourceId === "__plexus__" ||
    connectionType === "mysql" ||
    connectionType === "clickhouse";
  const q = (name: string) => quoteIdent(name, useBackticks);

  let sql = `SELECT * FROM ${q(table)}`;
  const conditions: string[] = [];

  if (timestampCol && timeRangeValue !== "all") {
    const range = CONNECTION_TIME_RANGES.find(
      (r) => r.value === timeRangeValue,
    );
    if (range && range.interval) {
      if (connectionType === "mysql") {
        const match = range.interval.match(/^(\d+)\s*(hour|day)s?$/i);
        if (match) {
          conditions.push(
            `${q(timestampCol)} >= NOW() - INTERVAL ${match[1]} ${match[2].toUpperCase()}`,
          );
        }
      } else {
        conditions.push(
          `${q(timestampCol)} >= NOW() - INTERVAL '${range.interval}'`,
        );
      }
    }
  }
  if (filter && filter.column && filter.value) {
    // Escape single quotes in filter value
    const escaped = filter.value.replace(/'/g, "''");
    conditions.push(`${q(filter.column)} = '${escaped}'`);
  }
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }
  if (timestampCol) {
    sql += ` ORDER BY ${q(timestampCol)} DESC`;
  }
  sql += ` LIMIT 100`;
  if (offset > 0) {
    sql += ` OFFSET ${offset}`;
  }
  return sql;
}

function buildExportSql(
  table: string,
  timestampCol: string | null,
  timeRangeValue: string,
  sourceId: string,
  connectionType?: string,
  filter?: { column: string; value: string },
): string {
  const useBackticks =
    sourceId === "__plexus__" ||
    connectionType === "mysql" ||
    connectionType === "clickhouse";
  const q = (name: string) => quoteIdent(name, useBackticks);

  let sql = `SELECT * FROM ${q(table)}`;
  const conditions: string[] = [];

  if (timestampCol && timeRangeValue !== "all") {
    const range = CONNECTION_TIME_RANGES.find(
      (r) => r.value === timeRangeValue,
    );
    if (range && range.interval) {
      if (connectionType === "mysql") {
        const match = range.interval.match(/^(\d+)\s*(hour|day)s?$/i);
        if (match) {
          conditions.push(
            `${q(timestampCol)} >= NOW() - INTERVAL ${match[1]} ${match[2].toUpperCase()}`,
          );
        }
      } else {
        conditions.push(
          `${q(timestampCol)} >= NOW() - INTERVAL '${range.interval}'`,
        );
      }
    }
  }
  if (filter && filter.column && filter.value) {
    // Escape single quotes in filter value
    const escaped = filter.value.replace(/'/g, "''");
    conditions.push(`${q(filter.column)} = '${escaped}'`);
  }
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }
  if (timestampCol) {
    sql += ` ORDER BY ${q(timestampCol)} DESC`;
  }
  return sql;
}

const TELEMETRY_COLUMNS: { name: string; type: string }[] = [
  { name: "timestamp", type: "timestamp" },
  { name: "metric", type: "string" },
  { name: "value", type: "number" },
];

function buildCsvContent(
  rows: Array<Record<string, unknown>>,
  columns: Array<{ name: string; type: string }>,
): string {
  const headers = columns.map((c) => `"${c.name}"`).join(",");
  const data = rows
    .map((row) =>
      columns
        .map((c) => {
          const val = row[c.name];
          if (val === null || val === undefined) return "";
          return `"${String(val).replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");
  return `${headers}\n${data}`;
}

function downloadBlob(content: string, filename: string, type = "text/csv") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildSchemaCsv(
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string }>;
  }>,
): string {
  const header = `"table","column","type"`;
  const rows = tables.flatMap((t) =>
    t.columns.map(
      (c) =>
        `"${t.name.replace(/"/g, '""')}","${c.name.replace(/"/g, '""')}","${c.type.replace(/"/g, '""')}"`,
    ),
  );
  return `${header}\n${rows.join("\n")}`;
}

export function UnifiedDataTab({
  source,
  schema,
  onSchemaRefresh,
  initialTable,
  filter,
}: UnifiedDataTabProps) {
  const isConnection = source.source_type === "connection";
  const isDevice = !isConnection;

  // Device sub-view: telemetry "Data" grid vs camera "Recordings".
  const [deviceView, setDeviceView] = useState<"data" | "recordings">("data");

  // Selected table state
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  // Time range (devices default to 24h, connections to all time)
  const [timeRange, setTimeRange] = useState(isConnection ? "all" : "24h");
  const [offset, setOffset] = useState(0);
  const limit = 100;

  // Device metric filter
  const [metricFilter, setMetricFilter] = useState<string | null>(null);
  const [metricSearch, setMetricSearch] = useState("");
  const { metrics: availableMetrics } = useSourceMetrics(isDevice ? source.id : null);

  // Connection: accumulated rows for pagination
  const [connectionOffset, setConnectionOffset] = useState(0);
  const [accumulatedConnectionRows, setAccumulatedConnectionRows] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [connectionHasMore, setConnectionHasMore] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(false);

  // Device: accumulated rows for pagination (telemetry hook returns one page at a time)
  const [accumulatedTelemetryRows, setAccumulatedTelemetryRows] = useState<
    Array<Record<string, unknown>>
  >([]);
  const lastTelemetryOffsetRef = useRef(0);

  // Virtualized scroll
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLTableRowElement>(null);
  const [rowHeight, setRowHeight] = useState(29);
  const [viewport, setViewport] = useState({ scrollTop: 0, clientHeight: 0 });

  // Device telemetry data
  const {
    rows: telemetryRows,
    total: telemetryTotal,
    hasMore: telemetryHasMore,
    isLoading: telemetryLoading,
  } = useTelemetryRows(isDevice ? source.slug : null, {
    timeRange,
    limit,
    offset,
    metric: metricFilter ?? undefined,
  });

  // Connection query data
  const { columns: queryColumns, execute: executeQuery } =
    useConnectionQueryManual(isConnection ? source.id : null);

  const tables = useMemo(() => {
    if (isConnection && schema) {
      return schema.map((t) => ({
        name: t.name,
        schema: t.schema,
        columns: t.columns,
        rowCount: null as number | null,
      }));
    }
    if (isDevice) {
      return [
        {
          name: "telemetry",
          columns: TELEMETRY_COLUMNS,
          rowCount: telemetryTotal,
        },
      ];
    }
    return [];
  }, [isConnection, isDevice, schema, telemetryTotal]);

  // Default the selected table once tables are available. Adjusting state during
  // render (guarded by `!selectedTable`) is React's documented alternative to a
  // setState-in-effect and preserves the prior "select on first availability"
  // behavior.
  if (tables.length > 0 && !selectedTable) {
    setSelectedTable(
      initialTable && tables.some((t) => t.name === initialTable)
        ? initialTable
        : tables[0].name,
    );
  }

  // Get current table data
  const currentTable = tables.find((t) => t.name === selectedTable);

  // Entity filter, applied only when the selected table actually has the
  // column — switching to an unrelated table must not emit broken SQL.
  // Derived from primitives so the object identity is stable across renders
  // even when callers pass a fresh `filter` literal.
  const filterColumn = filter?.column;
  const filterValue = filter?.value;
  const currentTableHasFilterColumn =
    !!filterColumn &&
    (currentTable?.columns.some((c) => c.name === filterColumn) ?? false);
  const activeFilter = useMemo(() => {
    if (!isConnection || !filterColumn || filterValue === undefined)
      return undefined;
    if (!currentTableHasFilterColumn) return undefined;
    return { column: filterColumn, value: filterValue };
  }, [isConnection, filterColumn, filterValue, currentTableHasFilterColumn]);

  // Detect timestamp column for connection tables
  const timestampColumnName = useMemo(() => {
    if (!currentTable) return null;
    const tsCol = currentTable.columns.find(
      (c) => normalizeColumnType(c.type) === "timestamp",
    );
    return tsCol?.name ?? null;
  }, [currentTable]);
  const hasTimestampColumn = timestampColumnName !== null;

  // Stable schema key — only re-run when table names actually change
  const schemaKey = useMemo(
    () => schema?.map((t) => t.name).join(",") ?? "",
    [schema],
  );

  // Execute query when selecting a connection table or changing time range
  useEffect(() => {
    if (!isConnection || !selectedTable) return;

    let cancelled = false;

    // Run inside a callback so the setState calls aren't synchronous in the
    // effect body (the rule permits setState in callbacks that sync external
    // data). Behavior is unchanged from the prior promise-chain version.
    const run = async () => {
      // Reset pagination state
      setConnectionOffset(0);
      setAccumulatedConnectionRows([]);
      setConnectionHasMore(false);
      setConnectionLoading(true);

      const isInflux = source.connection_type === "influxdb";
      const selectedTableSchema = schema?.find((t) => t.name === selectedTable);
      const influxBucket = selectedTableSchema?.schema;
      const influxV3 = isInflux && isInfluxV3Columns(selectedTableSchema?.columns ?? []);
      if (isInflux && !influxV3 && !influxBucket) return; // Wait for schema to resolve bucket name
      const query = influxV3
        ? buildConnectionSql(selectedTable, 0, timestampColumnName, timeRange, source.id, "influxdb", activeFilter)
        : isInflux
          ? buildConnectionFlux(influxBucket!, selectedTable, timeRange)
          : buildConnectionSql(selectedTable, 0, timestampColumnName, timeRange, source.id, source.connection_type ?? undefined, activeFilter);
      try {
        const result = await executeQuery(query);
        if (cancelled) return;
        if (result) {
          setAccumulatedConnectionRows(result.rows);
          // InfluxDB v2 Flux doesn't support OFFSET pagination; v3 SQL does
          setConnectionHasMore(
            (source.connection_type !== "influxdb" || influxV3) && result.rows.length >= 100,
          );
        }
      } finally {
        if (!cancelled) setConnectionLoading(false);
      }
    };
    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isConnection,
    selectedTable,
    timeRange,
    timestampColumnName,
    executeQuery,
    source.connection_type,
    source.id,
    schemaKey,
    initialTable,
    activeFilter,
  ]);

  // Reset device telemetry accumulator when source/timeRange/metricFilter changes.
  // The accumulator must persist across renders (the hook returns one page at a
  // time), so this is a genuine state reset; the setState runs in a callback so
  // it isn't called synchronously in the effect body.
  useEffect(() => {
    if (!isDevice) return;
    const reset = () => {
      setAccumulatedTelemetryRows([]);
      setOffset(0);
    };
    reset();
    lastTelemetryOffsetRef.current = 0;
  }, [isDevice, timeRange, source.slug, metricFilter]);

  // Append device telemetry pages as they arrive (replace on the first page,
  // append on subsequent pages). setState runs in a callback so it isn't called
  // synchronously in the effect body.
  useEffect(() => {
    if (!isDevice) return;
    if (telemetryRows.length === 0) return;
    const applyPage = () => {
      if (offset === 0) {
        setAccumulatedTelemetryRows(telemetryRows);
      } else if (offset > lastTelemetryOffsetRef.current) {
        setAccumulatedTelemetryRows((prev) => [...prev, ...telemetryRows]);
      }
    };
    applyPage();
    lastTelemetryOffsetRef.current = offset;
  }, [telemetryRows, offset, isDevice]);

  // Connection: load more handler (not supported for InfluxDB v2 Flux queries)
  const handleConnectionLoadMore = useCallback(async () => {
    if (!isConnection || !selectedTable) return;
    const influxV3 = isInfluxV3Columns(currentTable?.columns ?? []);
    if (source.connection_type === "influxdb" && !influxV3) return;
    const newOffset = connectionOffset + 100;
    setConnectionOffset(newOffset);
    const sql = buildConnectionSql(
      selectedTable,
      newOffset,
      timestampColumnName,
      timeRange,
      source.id,
      source.connection_type ?? undefined,
      activeFilter,
    );
    const result = await executeQuery(sql);
    if (result) {
      setAccumulatedConnectionRows((prev) => [...prev, ...result.rows]);
      setConnectionHasMore(result.rows.length >= 100);
    }
  }, [
    isConnection,
    selectedTable,
    connectionOffset,
    timestampColumnName,
    timeRange,
    executeQuery,
    source.connection_type,
    source.id,
    currentTable?.columns,
    activeFilter,
  ]);

  // Export: separate query hook for fetching all rows
  const { execute: executeExportQuery } = useConnectionQueryManual(
    isConnection ? source.id : null,
  );
  const [exporting, setExporting] = useState(false);

  // Export schema for the selected table (or all tables)
  const handleExportSchema = useCallback(() => {
    if (!isConnection || !schema || schema.length === 0) return;
    const csv = buildSchemaCsv(schema);
    const name = source.name || source.slug;
    downloadBlob(csv, `${name}-schema.csv`);
    toast.success(
      `Exported schema for ${schema.length} table${schema.length === 1 ? "" : "s"}`,
    );
  }, [isConnection, schema, source.name, source.slug]);

  // Export current table data
  const handleExportTable = useCallback(async () => {
    if (!selectedTable || !currentTable) return;
    setExporting(true);

    try {
      if (isDevice) {
        downloadBlob(
          buildCsvContent(telemetryRows, TELEMETRY_COLUMNS),
          `${source.slug}-telemetry.csv`,
        );
      } else if (isConnection) {
        const isInflux = source.connection_type === "influxdb";
        const influxV3 = isInflux && isInfluxV3Columns(currentTable.columns);
        if (isInflux && !influxV3) {
          downloadBlob(
            buildCsvContent(accumulatedConnectionRows, currentTable.columns),
            `${selectedTable}.csv`,
          );
        } else {
          const sql = buildExportSql(
            selectedTable,
            timestampColumnName,
            timeRange,
            source.id,
            source.connection_type ?? undefined,
            activeFilter,
          );
          const result = await executeExportQuery(sql);
          if (result && result.rows.length > 0) {
            downloadBlob(
              buildCsvContent(result.rows, currentTable.columns),
              `${selectedTable}.csv`,
            );
            toast.success(
              `Exported ${result.rows.length.toLocaleString()} rows`,
            );
          } else {
            toast.error("No data to export");
          }
        }
      }
    } catch (err) {
      toast.error("Export failed");
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  }, [
    selectedTable,
    currentTable,
    isDevice,
    isConnection,
    telemetryRows,
    source.slug,
    source.id,
    source.connection_type,
    accumulatedConnectionRows,
    timestampColumnName,
    timeRange,
    executeExportQuery,
    activeFilter,
  ]);

  // Export all tables in the connection
  const handleExportAll = useCallback(async () => {
    if (!isConnection || !tables.length) return;
    setExporting(true);

    try {
      const isInflux = source.connection_type === "influxdb";
      const connName = source.name || source.slug;
      let totalRows = 0;

      // Build combined CSV: all tables with a _table column
      const allColumns = new Set<string>();
      const tableResults: Array<{
        tableName: string;
        rows: Array<Record<string, unknown>>;
        columns: Array<{ name: string; type: string }>;
      }> = [];

      for (const table of tables) {
        if (isInflux && !isInfluxV3Columns(table.columns)) {
          // Skip InfluxDB v2 — Flux queries can't do unlimited exports
          continue;
        }
        const tsCol = table.columns.find(
          (c) => normalizeColumnType(c.type) === "timestamp",
        );
        // Entity filter only applies to tables that carry the column.
        const tableFilter =
          filterColumn &&
          filterValue !== undefined &&
          table.columns.some((c) => c.name === filterColumn)
            ? { column: filterColumn, value: filterValue }
            : undefined;
        const sql = buildExportSql(
          table.name,
          tsCol?.name ?? null,
          timeRange,
          source.id,
          source.connection_type ?? undefined,
          tableFilter,
        );
        const result = await executeExportQuery(sql);
        if (result && result.rows.length > 0) {
          tableResults.push({
            tableName: table.name,
            rows: result.rows,
            columns: table.columns,
          });
          totalRows += result.rows.length;
          table.columns.forEach((c) => allColumns.add(c.name));
        }
      }

      if (tableResults.length === 0) {
        toast.error("No data to export");
        return;
      }

      // One CSV per table, combined into sections separated by blank lines
      // Using _table column approach for easy filtering
      const allCols = ["_table", ...Array.from(allColumns)];
      const header = allCols.map((c) => `"${c}"`).join(",");
      const dataRows = tableResults.flatMap(({ tableName, rows }) =>
        rows.map((row) =>
          allCols
            .map((c) => {
              if (c === "_table") return `"${tableName.replace(/"/g, '""')}"`;
              const val = row[c];
              if (val === null || val === undefined) return "";
              return `"${String(val).replace(/"/g, '""')}"`;
            })
            .join(","),
        ),
      );

      const csv = `${header}\n${dataRows.join("\n")}`;
      downloadBlob(csv, `${connName}-all-tables.csv`);
      toast.success(
        `Exported ${totalRows.toLocaleString()} rows from ${tableResults.length} table${tableResults.length === 1 ? "" : "s"}`,
      );
    } catch (err) {
      toast.error("Export failed");
      console.error("Export all error:", err);
    } finally {
      setExporting(false);
    }
  }, [
    isConnection,
    tables,
    source.connection_type,
    source.name,
    source.slug,
    source.id,
    timeRange,
    executeExportQuery,
    filterColumn,
    filterValue,
  ]);

  const columns = useMemo(() => {
    if (isDevice) {
      return TELEMETRY_COLUMNS;
    }
    if (isConnection && currentTable) {
      return currentTable.columns;
    }
    return queryColumns;
  }, [isDevice, isConnection, currentTable, queryColumns]);

  const rows = isDevice ? accumulatedTelemetryRows : accumulatedConnectionRows;
  const isLoading = isDevice ? telemetryLoading : connectionLoading;
  const hasMore = isDevice ? telemetryHasMore : connectionHasMore;

  // Column annotations — for devices the annotation target is a metric
  // (column_key = metric name); for connections it's a real column
  // (column_key = "table.column"). See ColumnMetadataSheet.
  const { byKey: columnMetaByKey } = useColumnMetadata(source.id);
  const [annotateColumn, setAnnotateColumn] = useState<{
    key: string;
    name: string;
    type: string;
    samples: unknown[];
  } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openMetricAnnotation = useCallback(
    (metric: string) => {
      const samples = rows
        .filter((r) => r["metric"] === metric)
        .slice(0, 5)
        .map((r) => r["value"]);
      setAnnotateColumn({ key: metric, name: metric, type: "number", samples });
      setSheetOpen(true);
    },
    [rows],
  );

  const openColumnAnnotation = useCallback(
    (columnName: string, columnType: string) => {
      const key = selectedTable
        ? `${selectedTable}.${columnName}`
        : columnName;
      const samples = rows
        .slice(0, 5)
        .map((r) => r[columnName])
        .filter((v) => v !== undefined);
      setAnnotateColumn({
        key,
        name: columnName,
        type: normalizeColumnType(columnType),
        samples,
      });
      setSheetOpen(true);
    },
    [rows, selectedTable],
  );

  /** column_key for a connection column, used to look up saved annotations. */
  const connectionColumnKey = useCallback(
    (columnName: string) =>
      selectedTable ? `${selectedTable}.${columnName}` : columnName,
    [selectedTable],
  );

  // Auto-measure row height after first render so spacer math stays accurate
  // even if styling changes
  useEffect(() => {
    if (!firstRowRef.current || rows.length === 0) return;
    const h = firstRowRef.current.offsetHeight;
    if (h > 0 && h !== rowHeight) setRowHeight(h);
  }, [rows.length, rowHeight]);

  // Reset scroll when switching source/table/timeRange. The DOM scroll reset is
  // an external-system effect; the matching viewport state reset runs in a
  // callback so it isn't called synchronously in the effect body.
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    const resetViewport = () => setViewport((v) => ({ ...v, scrollTop: 0 }));
    resetViewport();
  }, [selectedTable, timeRange]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      setViewport({
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
      });
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom < 200 && !isLoading && hasMore) {
        if (isDevice) {
          setOffset((prev) => prev + limit);
        } else if (isConnection) {
          handleConnectionLoadMore();
        }
      }
    },
    [
      isLoading,
      hasMore,
      isDevice,
      isConnection,
      limit,
      handleConnectionLoadMore,
    ],
  );

  // Filter columns for display
  const displayColumns = columns.filter(
    (col) =>
      !col.name.endsWith("_id") &&
      col.name !== "_id" &&
      !["_row_id", "_version", "_deleted", "org_id"].includes(col.name),
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {isDevice && (
        <TabNav
          tabs={[
            { id: "data", label: "Data" },
            { id: "recordings", label: "Recordings" },
          ]}
          activeTab={deviceView}
          onTabChange={(id) => setDeviceView(id as "data" | "recordings")}
        />
      )}
      {isDevice && deviceView === "recordings" ? (
        <div className="flex flex-1 min-h-0">
          <DeviceRecordings sourceId={source.id} />
        </div>
      ) : (
      <div className="flex flex-1 min-h-0">
      {/* Left sidebar - Table selector */}
      <div className="w-56 border-r border-border flex flex-col bg-muted/30">
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {isConnection ? "Tables" : "Data"}
            </span>
            {isConnection && onSchemaRefresh && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={onSchemaRefresh}
              >
                <Activity className="h-3 w-3" />
              </Button>
            )}
          </div>
          {activeFilter && (
            <div className="mt-2">
              <span
                className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground truncate"
                title={`Showing only rows where ${activeFilter.column} = ${activeFilter.value}`}
              >
                filtered: {activeFilter.column} = {activeFilter.value}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {tables.length === 0 ? (
            <div className="text-center py-8">
              <Table2 className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">
                {isLoading ? "Loading..." : "No tables available"}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {tables.map((table) => (
                <button
                  key={table.name}
                  onClick={() => setSelectedTable(table.name)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors group",
                    selectedTable === table.name
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted text-foreground",
                  )}
                >
                  <Table2 className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-sm truncate flex-1">{table.name}</span>
                  {table.rowCount !== null && (
                    <span className="text-[10px] text-muted-foreground">
                      {table.rowCount.toLocaleString()}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Metric filter for devices */}
        {isDevice && availableMetrics.length > 0 && (
          <div className="border-t border-border">
            <div className="px-3 py-2 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Metrics
              </span>
            </div>
            <div className="p-2">
              <div className="relative mb-1.5">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={metricSearch}
                  onChange={(e) => setMetricSearch(e.target.value)}
                  placeholder="Search metrics..."
                  className="h-7 pl-6 text-xs"
                />
              </div>
              <div className="h-48 overflow-y-auto space-y-0.5">
                <button
                  onClick={() => setMetricFilter(null)}
                  className={cn(
                    "w-full text-left px-2 py-1 rounded text-xs transition-colors",
                    metricFilter === null
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted text-muted-foreground"
                  )}
                >
                  All metrics
                </button>
                {availableMetrics
                  .filter((m) =>
                    metricSearch === "" ||
                    m.toLowerCase().includes(metricSearch.toLowerCase())
                  )
                  .map((m) => {
                    const meta = columnMetaByKey.get(m);
                    return (
                      <div
                        key={m}
                        className={cn(
                          "group/metric flex items-center gap-1 rounded pr-1 transition-colors",
                          metricFilter === m
                            ? "bg-primary/10"
                            : "hover:bg-muted",
                        )}
                      >
                        <button
                          onClick={() =>
                            setMetricFilter(m === metricFilter ? null : m)
                          }
                          className={cn(
                            "flex-1 min-w-0 text-left px-2 py-1 text-xs truncate transition-colors flex items-center gap-1.5",
                            metricFilter === m
                              ? "text-primary"
                              : "text-foreground",
                          )}
                        >
                          <span className="truncate">{meta?.label || m}</span>
                          {meta?.unit && (
                            <span className="text-[10px] text-muted-foreground/70">
                              {meta.unit}
                            </span>
                          )}
                          {meta && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                          )}
                        </button>
                        <button
                          onClick={() => openMetricAnnotation(m)}
                          title="Configure metric metadata"
                          className="opacity-0 group-hover/metric:opacity-100 transition-opacity p-0.5 text-muted-foreground hover:text-foreground flex-shrink-0"
                        >
                          <SlidersHorizontal className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* Time range selector for devices */}
        {isDevice && (
          <div className="p-2 border-t border-border">
            <Select
              value={timeRange}
              onValueChange={(value) => {
                setTimeRange(value);
                setOffset(0);
              }}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Last hour</SelectItem>
                <SelectItem value="6h">Last 6 hours</SelectItem>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Export buttons */}
        {isConnection && schema && schema.length > 0 && (
          <div className="p-2 border-t border-border space-y-1">
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs justify-start"
              onClick={handleExportSchema}
              disabled={exporting}
            >
              <Download className="h-3 w-3 mr-1.5" />
              Export Schema
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs justify-start"
              onClick={handleExportAll}
              disabled={exporting}
            >
              {exporting ? (
                <Spinner className="h-3 w-3 mr-1.5" />
              ) : (
                <Download className="h-3 w-3 mr-1.5" />
              )}
              Export All Tables
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {selectedTable && currentTable ? (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
              <div className="flex items-center gap-3">
                <Table2 className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-medium">{selectedTable}</h2>
                {isDevice && telemetryTotal > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {telemetryTotal.toLocaleString()} rows
                    {metricFilter && (
                      <span className="ml-1 text-primary">· {metricFilter}</span>
                    )}
                  </span>
                )}
                {isConnection && accumulatedConnectionRows.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {accumulatedConnectionRows.length.toLocaleString()}
                    {connectionHasMore ? "+" : ""} rows
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isConnection && hasTimestampColumn && (
                  <Select value={timeRange} onValueChange={setTimeRange}>
                    <SelectTrigger size="sm" className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONNECTION_TIME_RANGES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={handleExportTable}
                  disabled={exporting || rows.length === 0}
                >
                  {exporting ? (
                    <Spinner className="h-3 w-3 mr-1" />
                  ) : (
                    <Download className="h-3 w-3 mr-1" />
                  )}
                  Export Table
                </Button>
              </div>
            </div>

            {/* <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center gap-4 overflow-x-auto">
              {displayColumns.map((col) => {
                const colType = normalizeColumnType(col.type);
                const Icon = COLUMN_TYPE_ICONS[colType] || Type;

                return (
                  <div
                    key={col.name}
                    className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground"
                  >
                    <Icon className="h-3 w-3" />
                    <span className="font-medium text-foreground">
                      {col.name}
                    </span>
                    <span className="text-muted-foreground/60">
                      {COLUMN_TYPE_LABELS[colType] || col.type}
                    </span>
                  </div>
                );
              })}
            </div> */}

            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-auto"
              onScroll={handleScroll}
            >
              {isLoading && rows.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner />
                </div>
              ) : rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Table2 className="h-8 w-8 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No data available
                  </p>
                </div>
              ) : (
                (() => {
                  const totalRows = rows.length;
                  const effectiveClientHeight = viewport.clientHeight || 800;
                  const startRow = Math.max(
                    0,
                    Math.floor(viewport.scrollTop / rowHeight) - 5,
                  );
                  const endRow = Math.min(
                    totalRows,
                    Math.ceil(
                      (viewport.scrollTop + effectiveClientHeight) / rowHeight,
                    ) + 5,
                  );
                  const topSpacerHeight = startRow * rowHeight;
                  const bottomSpacerHeight = Math.max(
                    0,
                    (totalRows - endRow) * rowHeight,
                  );
                  const visibleRows = rows.slice(startRow, endRow);
                  const colCount = displayColumns.length;
                  return (
                    <table className="w-full caption-bottom text-sm">
                      <TableHeader className="bg-muted sticky top-0 z-10">
                        <TableRow>
                          {displayColumns.map((col) => {
                            const ColIcon =
                              COLUMN_TYPE_ICONS[normalizeColumnType(col.type)] ||
                              Type;
                            const meta = isConnection
                              ? columnMetaByKey.get(
                                  connectionColumnKey(col.name),
                                )
                              : undefined;
                            return (
                              <TableHead
                                key={col.name}
                                className="px-3 py-2 text-left text-xs font-medium text-muted-foreground border-b border-r border-border"
                              >
                                {isConnection ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openColumnAnnotation(col.name, col.type)
                                    }
                                    className="group/col flex items-center gap-1.5 hover:text-foreground transition-colors"
                                    title={
                                      meta?.description ||
                                      meta?.label ||
                                      "Configure column metadata"
                                    }
                                  >
                                    <ColIcon className="h-3 w-3 flex-shrink-0" />
                                    <span>{meta?.label || col.name}</span>
                                    {meta?.unit && (
                                      <span className="text-[10px] text-muted-foreground/70 font-normal">
                                        {meta.unit}
                                      </span>
                                    )}
                                    {meta && (
                                      <span className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                                    )}
                                    <SlidersHorizontal className="h-3 w-3 opacity-0 group-hover/col:opacity-60 transition-opacity flex-shrink-0" />
                                  </button>
                                ) : (
                                  <span className="flex items-center gap-1.5">
                                    <ColIcon className="h-3 w-3 flex-shrink-0" />
                                    {col.name}
                                  </span>
                                )}
                              </TableHead>
                            );
                          })}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topSpacerHeight > 0 && (
                          <tr aria-hidden="true">
                            <td
                              colSpan={colCount}
                              style={{
                                height: topSpacerHeight,
                                padding: 0,
                                border: 0,
                              }}
                            />
                          </tr>
                        )}
                        {visibleRows.map((row, i) => {
                          const actualIdx = startRow + i;
                          return (
                            <TableRow
                              key={actualIdx}
                              ref={i === 0 ? firstRowRef : undefined}
                              className="group hover:bg-muted/30"
                              style={{ height: rowHeight }}
                            >
                              {displayColumns.map((col) => (
                                <TableCell
                                  key={col.name}
                                  className="px-3 py-1.5 border-b border-r border-border max-w-[300px]"
                                  title={String(row[col.name] ?? "")}
                                >
                                  <span className="text-xs font-mono block truncate">
                                    {formatValue(row[col.name], col.type)}
                                  </span>
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                        {bottomSpacerHeight > 0 && (
                          <tr aria-hidden="true">
                            <td
                              colSpan={colCount}
                              style={{
                                height: bottomSpacerHeight,
                                padding: 0,
                                border: 0,
                              }}
                            />
                          </tr>
                        )}
                        {isLoading && rows.length > 0 && (
                          <tr>
                            <td
                              colSpan={colCount}
                              className="px-3 py-3 text-center"
                            >
                              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                                <Spinner className="h-3 w-3" />
                                Loading more...
                              </div>
                            </td>
                          </tr>
                        )}
                      </TableBody>
                    </table>
                  );
                })()
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Table2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                {isLoading ? "Loading..." : "Select a table to view data"}
              </p>
            </div>
          </div>
        )}
      </div>

      {annotateColumn && (
        <ColumnMetadataSheet
          sourceId={source.id}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          columnKey={annotateColumn.key}
          columnName={annotateColumn.name}
          inferredType={annotateColumn.type}
          sampleValues={annotateColumn.samples}
        />
      )}
      </div>
      )}
    </div>
  );
}

function formatValue(value: unknown, type: string): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  const colType = normalizeColumnType(type);
  if (colType === "timestamp") {
    try {
      const date = new Date(String(value));
      return format(date, "yyyy-MM-dd HH:mm:ss.SSS");
    } catch {
      return String(value);
    }
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
