"use client";

/**
 * ConnectionDataEditor — THE editor for connection-backed panels, add and
 * edit alike. Renders the one grammar (Show / Per / Split by) for every
 * visual-built panel — stored `builder` specs and legacy hint-reconstructed
 * panels the same way (lib/dashboard/derive-spec). `customQuery: true` is the
 * only mode switch: custom-SQL panels get a banner pointing at the Query
 * section plus a "Rebuild with visual controls" reset.
 *
 * Every control change re-materializes the SQL through the shared builder
 * (lib/dashboard/suggest); the spec never executes.
 */

import { useMemo, useState } from "react";
import { ChevronRight, Database, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import { useConnectionSchema } from "@/hooks/use-connection-schema";
import { useSources } from "@/hooks/use-sources";
import { detectTimeColumn } from "@/lib/dashboard/column-roles";
import {
  availableMeasures,
  joinCastNeeded,
  joinKeyScore,
  pivotCandidates,
  resolveJoinKey,
  selectedTableNames,
  tableByName,
  type BuilderColumn,
  type BuilderTable,
} from "@/lib/dashboard/connection-query-builder";
import { specFromDataSource } from "@/lib/dashboard/derive-spec";
import {
  materializeConnectionDataSource,
  type DraftBuilderSpec,
} from "@/lib/dashboard/suggest";
import type {
  BuilderTimeBucket,
  ConnectionDataSource,
  JoinSpec,
} from "@/lib/types/dashboard";
import { QuickChartControls } from "./add-panel-configurators/quick-chart-controls";
import { cn } from "@/lib/utils";

/** Connection types the SQL builder can drive. */
export const SQL_CONNECTION_TYPES = new Set([
  "postgres",
  "timescaledb",
  "mysql",
  "clickhouse",
]);

interface ConnectionDataEditorProps {
  dataSource: ConnectionDataSource;
  onChange: (next: ConnectionDataSource) => void;
  /** "table" (datagrid): raw rows, no Show/Per/Split controls. */
  variant?: "chart" | "table";
  /** Render a connection Select above the table picker (add-modal flow —
   *  the sidebar already has the SourcePicker for this). */
  showConnectionPicker?: boolean;
}

export function ConnectionDataEditor({
  dataSource,
  onChange,
  variant = "chart",
  showConnectionPicker = false,
}: ConnectionDataEditorProps) {
  const { connections } = useSources();
  const { tables, isLoading: schemaLoading } = useConnectionSchema(
    dataSource.sourceId || null,
  );
  const [tableSearch, setTableSearch] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(
    () => !!dataSource.joins?.length,
  );

  const connection = connections.find((c) => c.id === dataSource.sourceId);
  const isSqlConnection =
    dataSource.sourceId === "__plexus__" ||
    (connection?.connection_type != null &&
      SQL_CONNECTION_TYPES.has(connection.connection_type));

  const derived = useMemo(
    () => specFromDataSource(dataSource, tables),
    [dataSource, tables],
  );
  const spec = derived?.spec ?? null;
  const hasQuery = !!dataSource.query?.trim();

  const table = useMemo(
    () => (spec ? (tableByName(tables, spec.table) ?? null) : null),
    [tables, spec],
  );
  const tableNames = spec
    ? selectedTableNames(spec.table, spec.joins ?? [])
    : [];
  const timeCol =
    spec?.timeColumn ??
    (table ? detectTimeColumn(table.columns) : undefined);
  const measures = useMemo(
    () =>
      spec
        ? availableMeasures(tables, tableNames, spec.joins ?? [], timeCol, spec.groupBy)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, spec, timeCol],
  );
  const dimensions = useMemo(
    () =>
      spec
        ? pivotCandidates(tables, tableNames, spec.joins ?? [], timeCol)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, spec, timeCol],
  );

  /** Materialize a spec and push it, preserving fields we don't own. */
  const apply = (next: DraftBuilderSpec) => {
    const materialized = materializeConnectionDataSource(
      dataSource.sourceId,
      next,
      tables,
    );
    onChange({ ...dataSource, ...materialized });
  };

  /** Default spec when a table is (re)picked. */
  const specForTable = (t: BuilderTable): DraftBuilderSpec => {
    const tc = detectTimeColumn(t.columns);
    if (variant === "table" || !tc) {
      return { version: 1, table: t.name, aggregate: { fn: "raw" } };
    }
    return {
      version: 1,
      table: t.name,
      timeColumn: tc,
      aggregate: { fn: "count" },
      bucket: "day",
    };
  };

  const pickTable = (t: BuilderTable) => {
    // Influx keeps its Flux template (non-SQL model) → SQL-owned from birth.
    if (connection?.connection_type === "influxdb") {
      const bucket = t.schema || t.name;
      const query = `from(bucket: "${bucket}")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r["_measurement"] == "${t.name}")\n  |> sort(columns: ["_time"], desc: true)\n  |> limit(n: 100)`;
      onChange({
        ...dataSource,
        query,
        timeColumn: detectTimeColumn(t.columns),
        joins: undefined,
        seriesColumn: undefined,
        valueColumn: undefined,
        selectedColumns: [],
        customQuery: false,
        builder: undefined,
      });
      return;
    }
    apply(specForTable(t));
  };

  // ── Non-SQL / not-yet-supported connections ────────────────────────────
  if (
    !isSqlConnection &&
    connection &&
    connection.connection_type !== "influxdb"
  ) {
    return (
      <p className="text-[11px] text-muted-foreground">
        {connection.connection_type} connections are queried directly — edit
        the query in the Query section below.
      </p>
    );
  }

  const showKey = spec
    ? spec.aggregate.fn === "count" || spec.aggregate.fn === "raw"
      ? spec.aggregate.fn
      : `${spec.aggregate.fn}:${spec.aggregate.column ?? ""}`
    : "count";

  const filteredTables = tableSearch.trim()
    ? tables.filter((t) =>
        t.name.toLowerCase().includes(tableSearch.toLowerCase()),
      )
    : tables;

  /** Key-like columns (PK/`id`/`*_id`/`*_no`/`*_key`) first, then A→Z. */
  const sortKeyColsFirst = (cols: BuilderColumn[]) =>
    [...cols].sort(
      (a, b) =>
        joinKeyScore(b.name, b) - joinKeyScore(a.name, a) ||
        a.name.localeCompare(b.name),
    );

  // Tables offered for a new join, split by whether a join key resolves
  // (FK or shared key-named column) so related tables surface first.
  const joinCandidates =
    spec && table
      ? tables.filter(
          (t) =>
            t.name !== spec.table &&
            !(spec.joins ?? []).some((j) => j.table === t.name),
        )
      : [];
  const relatedCandidates = joinCandidates
    .map((t) => ({ table: t, key: resolveJoinKey(table ?? undefined, t) }))
    .filter(
      (x): x is { table: BuilderTable; key: { localColumn: string; foreignColumn: string } } =>
        x.key !== null,
    );
  const otherCandidates = joinCandidates.filter(
    (t) => !relatedCandidates.some((r) => r.table.name === t.name),
  );

  return (
    <div className="space-y-3">
      {/* Connection picker (add flow only) */}
      {showConnectionPicker && (
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Connection
          </Label>
          <Select
            value={dataSource.sourceId || ""}
            onValueChange={(v) =>
              onChange({
                type: "connection",
                sourceId: v,
                query: "",
                refreshInterval: dataSource.refreshInterval,
              })
            }
          >
            <SelectTrigger className="h-7 text-[11px] mt-1 w-full">
              <SelectValue placeholder="Pick a connection…" />
            </SelectTrigger>
            <SelectContent>
              {connections
                .filter(
                  (c) =>
                    c.connection_type &&
                    SQL_CONNECTION_TYPES.has(c.connection_type),
                )
                .map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-[11px]">
                    {c.name || c.slug}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* SQL-owned state: custom SQL, drifted builder, or unrecognized query */}
      {hasQuery && !spec ? (
        <div className="rounded border border-border bg-muted/20 p-2.5 space-y-1.5">
          <p className="text-[11px] text-muted-foreground">
            This panel runs custom SQL — edit it in the Query section below.
          </p>
          {tables.length > 0 && (
            <button
              type="button"
              onClick={() => {
                // Best-effort: rebuild from the query's base table, else first table.
                const t =
                  tableByName(
                    tables,
                    dataSource.query?.match(/FROM\s+(\w+)/i)?.[1] ?? "",
                  ) ?? tables[0];
                apply(specForTable(t));
              }}
              className="text-[11px] text-primary hover:underline"
            >
              Rebuild with visual controls
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Table picker */}
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Table
            </Label>
            {schemaLoading ? (
              <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
                <Spinner className="h-3 w-3" /> Loading tables…
              </div>
            ) : (
              <>
                {tables.length > 8 && (
                  <div className="relative mt-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <Input
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      placeholder="Search tables…"
                      className="h-7 pl-7 text-[11px]"
                    />
                  </div>
                )}
                <div className="mt-1 max-h-40 overflow-y-auto rounded border border-border divide-y divide-border">
                  {filteredTables.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => pickTable(t)}
                      className={cn(
                        "w-full px-2 py-1.5 text-left text-[11px] transition-colors flex items-center gap-1.5",
                        spec?.table === t.name
                          ? "bg-foreground/10 text-foreground"
                          : "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Database className="h-3 w-3 shrink-0 opacity-60" />
                      {t.name}
                      <span className="text-muted-foreground/60 ml-auto">
                        {t.columns.length} cols
                      </span>
                    </button>
                  ))}
                  {filteredTables.length === 0 && (
                    <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                      No tables
                      {tableSearch ? ` matching "${tableSearch}"` : ""}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Show / Per / Split by */}
          {variant === "chart" && spec && table && (
            <>
              {!timeCol && spec.aggregate.fn !== "raw" && (
                <p className="text-[11px] text-amber-600 dark:text-amber-500">
                  No time column found in {table.name} — showing raw values.
                </p>
              )}
              <QuickChartControls
                showKey={showKey}
                bucket={spec.bucket ?? "auto"}
                groupBy={spec.groupBy ?? ""}
                measures={measures}
                dimensions={dimensions}
                rawEnabled
                perDisabled={spec.aggregate.fn === "raw"}
                onShowKeyChange={(key) => {
                  if (key === "count") {
                    apply({ ...spec, aggregate: { fn: "count" }, bucket: spec.bucket ?? "auto" });
                  } else if (key === "raw") {
                    apply({ ...spec, aggregate: { fn: "raw" }, bucket: undefined });
                  } else {
                    const [fn, column] = key.split(":") as [
                      "avg" | "sum" | "min" | "max",
                      string,
                    ];
                    apply({ ...spec, aggregate: { fn, column }, bucket: spec.bucket ?? "day" });
                  }
                }}
                onBucketChange={(bucket: BuilderTimeBucket) =>
                  apply({ ...spec, bucket })
                }
                onGroupByChange={(column) =>
                  apply({ ...spec, groupBy: column || undefined })
                }
              />
              {/* Raw mode: measure multi-select (default all) */}
              {spec.aggregate.fn === "raw" && measures.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {measures.map((m) => {
                    const cols = spec.aggregate.columns;
                    const selected = !cols || cols.includes(m);
                    return (
                      <Badge
                        key={m}
                        variant={selected ? "default" : "outline"}
                        className="text-[10px] px-1.5 py-0 cursor-pointer"
                        onClick={() => {
                          const current = cols ?? measures;
                          const next = selected
                            ? current.filter((c) => c !== m)
                            : [...current, m];
                          apply({
                            ...spec,
                            aggregate: {
                              fn: "raw",
                              columns:
                                next.length === measures.length
                                  ? undefined
                                  : next,
                            },
                          });
                        }}
                      >
                        {m}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Advanced: joined tables + join keys */}
          {spec && table && (
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 w-full text-left group">
                <ChevronRight
                  className={cn(
                    "h-3 w-3 text-muted-foreground transition-transform",
                    advancedOpen && "rotate-90",
                  )}
                />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">
                  Joined tables
                  {spec.joins?.length ? ` (${spec.joins.length})` : ""}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 pl-4 space-y-2">
                {/* Current joins with key editors */}
                {(spec.joins ?? []).map((j) => {
                  const baseCols = table.columns;
                  const jCols = tableByName(tables, j.table)?.columns ?? [];
                  const local = baseCols.find((c) => c.name === j.localColumn);
                  const foreign = jCols.find((c) => c.name === j.foreignColumn);
                  const unresolved = !j.localColumn || !j.foreignColumn;
                  const cast = joinCastNeeded(local, foreign);
                  const setKey = (side: "local" | "foreign", column: string) =>
                    apply({
                      ...spec,
                      joins: (spec.joins ?? []).map((x) =>
                        x.table === j.table
                          ? {
                              ...x,
                              localColumn:
                                side === "local" ? column : x.localColumn,
                              foreignColumn:
                                side === "foreign" ? column : x.foreignColumn,
                            }
                          : x,
                      ),
                    });
                  const keyPicker = (
                    side: "local" | "foreign",
                    owner: string,
                    value: string,
                    cols: BuilderColumn[],
                  ) => (
                    <span className="inline-flex items-center gap-0.5 min-w-0">
                      <span className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[7rem]">
                        {owner}.
                      </span>
                      <Select
                        value={value || undefined}
                        onValueChange={(v) => setKey(side, v)}
                      >
                        <SelectTrigger
                          className={cn(
                            "h-6 text-xs w-auto min-w-[5rem] px-2",
                            !value && "ring-1 ring-amber-500/50",
                          )}
                        >
                          <SelectValue placeholder="column…" />
                        </SelectTrigger>
                        <SelectContent>
                          {sortKeyColsFirst(cols).map((c) => (
                            <SelectItem
                              key={c.name}
                              value={c.name}
                              className="text-xs"
                            >
                              <span className="flex w-full items-center justify-between gap-3">
                                {c.name}
                                <span className="text-[10px] text-muted-foreground/60">
                                  {c.type}
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </span>
                  );
                  return (
                    <div
                      key={j.table}
                      className="rounded-md border border-border/60 bg-muted/20 p-2"
                    >
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">Join</span>
                        <span className="font-mono truncate">{j.table}</span>
                        <button
                          type="button"
                          className="ml-auto text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            apply({
                              ...spec,
                              joins: (spec.joins ?? []).filter(
                                (x) => x.table !== j.table,
                              ),
                            })
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs flex-wrap">
                        {keyPicker("local", spec.table, j.localColumn, baseCols)}
                        <span className="text-muted-foreground">=</span>
                        {keyPicker("foreign", j.table, j.foreignColumn, jCols)}
                      </div>
                      {unresolved && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">
                          Pick the columns these tables join on.
                        </p>
                      )}
                      {!unresolved && cast === "text" && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Compared as text ({local?.type} ↔ {foreign?.type}).
                        </p>
                      )}
                      {!unresolved && cast === "incompatible" && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">
                          Type mismatch: {local?.type} ↔ {foreign?.type} —
                          compared as text; rows may not match.
                        </p>
                      )}
                    </div>
                  );
                })}

                {/* Add a join — related tables (resolvable key) first */}
                <Select
                  value=""
                  onValueChange={(tableName) => {
                    const t = tableByName(tables, tableName);
                    const key = resolveJoinKey(table, t);
                    const join: JoinSpec = {
                      table: tableName,
                      localColumn: key?.localColumn ?? "",
                      foreignColumn: key?.foreignColumn ?? "",
                    };
                    apply({ ...spec, joins: [...(spec.joins ?? []), join] });
                  }}
                >
                  <SelectTrigger className="h-7 text-[11px] w-full">
                    <SelectValue placeholder="Add a joined table…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const relatedItems = relatedCandidates.map(
                        ({ table: t, key }) => (
                          <SelectItem
                            key={t.name}
                            value={t.name}
                            className="text-[11px]"
                          >
                            <span className="flex w-full items-center justify-between gap-3">
                              {t.name}
                              <span className="text-[10px] text-muted-foreground/60">
                                via{" "}
                                {key.localColumn === key.foreignColumn
                                  ? key.localColumn
                                  : `${key.localColumn} → ${key.foreignColumn}`}
                              </span>
                            </span>
                          </SelectItem>
                        ),
                      );
                      const otherItems = otherCandidates.map((t) => (
                        <SelectItem
                          key={t.name}
                          value={t.name}
                          className="text-[11px]"
                        >
                          {t.name}
                        </SelectItem>
                      ));
                      // Group headers only when both kinds exist.
                      if (relatedItems.length && otherItems.length)
                        return (
                          <>
                            <SelectGroup>
                              <SelectLabel className="text-[10px] uppercase tracking-wide">
                                Related
                              </SelectLabel>
                              {relatedItems}
                            </SelectGroup>
                            <SelectGroup>
                              <SelectLabel className="text-[10px] uppercase tracking-wide">
                                Other tables
                              </SelectLabel>
                              {otherItems}
                            </SelectGroup>
                          </>
                        );
                      return [...relatedItems, ...otherItems];
                    })()}
                  </SelectContent>
                </Select>
              </CollapsibleContent>
            </Collapsible>
          )}

          {variant === "chart" && spec && timeCol && (
            <p className="text-[10px] text-muted-foreground">
              Time axis: <span className="font-mono">{timeCol}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
