/**
 * Smart defaults for connection-backed panels: turn a table's schema into
 * ranked, ready-to-add panel suggestions ("users per day"), and materialize a
 * PanelBuilderSpec into the executable data-source fields.
 *
 * Pure and I/O-free (same rule as column-roles / connection-query-builder) so
 * the quick-chart UI, the quick-start route, and the AI terminal tools can all
 * share it. The metric-based sibling for realtime sources lives in
 * lib/dashboards/quick-start-layout.ts.
 */

import {
  detectTimeColumn,
  measureColumns,
} from "@/lib/dashboard/column-roles";
import {
  availableMeasures,
  buildConnectionQuery,
  ownerOf,
  pivotCandidates,
  resolveTimeColumn,
  selectedTableNames,
  type BuilderTable,
  type FixedBucket,
  type MeasureAgg,
} from "@/lib/dashboard/connection-query-builder";
import { humanize } from "@/lib/dashboards/quick-start-layout";
import type { KnownPanelType } from "@/lib/panels/registry";
import type {
  ConnectionDataSource,
  PanelBuilderSpec,
  PanelConfig,
} from "@/lib/types/dashboard";

/** A builder spec minus the query it generates (the materializer fills it). */
export type DraftBuilderSpec = Omit<PanelBuilderSpec, "generatedQuery">;

// =============================================================================
// Materialization: intent spec → executable data source
// =============================================================================

/**
 * Deterministically materialize a spec into a complete ConnectionDataSource.
 * The returned `query` is the executable source of truth; the spec rides
 * along as `builder` (with `generatedQuery` set for the drift check).
 * Intent-driven: `aggregate.fn: "count"` counts rows even when the table has
 * numeric columns (unlike the visual builder, which infers count mode only
 * when no measures exist).
 */
export function materializeConnectionDataSource(
  sourceId: string,
  spec: DraftBuilderSpec,
  tables: BuilderTable[],
  /** Optional entity slice ("this device's rows") — appended to every WHERE. */
  entityFilter?: { column: string; value: string },
): ConnectionDataSource {
  const base = spec.table;
  const joins = spec.joins ?? [];
  const tableNames = selectedTableNames(base, joins);
  const timeCol =
    spec.timeColumn ?? resolveTimeColumn(tables, tableNames).col;

  const fn = spec.aggregate.fn;
  const countMode = fn === "count";
  let measures: string[];
  let measureAgg: MeasureAgg | undefined;
  if (fn === "count") {
    measures = [];
  } else if (fn === "raw") {
    measures =
      spec.aggregate.columns ??
      (spec.aggregate.column
        ? [spec.aggregate.column]
        : availableMeasures(tables, tableNames, joins, timeCol, spec.groupBy));
  } else {
    measures = spec.aggregate.column ? [spec.aggregate.column] : [];
    measureAgg = fn;
  }

  const bucket: FixedBucket | undefined =
    spec.bucket && spec.bucket !== "auto" ? spec.bucket : undefined;

  const query = buildConnectionQuery({
    tables,
    base,
    joins,
    timeCol,
    measures,
    seriesColumn: spec.groupBy,
    countMode,
    measureAgg,
    bucket,
    entityFilter,
  });

  const valueColumn = countMode
    ? "count"
    : measures.length === 1
      ? measures[0]
      : undefined;

  const seriesTableMap: Record<string, string> = {};
  if (countMode) {
    seriesTableMap.count = base;
  } else {
    for (const m of measures)
      seriesTableMap[m] = ownerOf(tables, base, joins, m);
  }

  return {
    type: "connection",
    sourceId,
    query,
    timeColumn: timeCol,
    valueColumn,
    seriesColumn: spec.groupBy,
    selectedColumns: measures,
    joins: joins.length ? joins : undefined,
    seriesTableMap,
    breakdownTable: spec.groupBy
      ? ownerOf(tables, base, joins, spec.groupBy)
      : undefined,
    customQuery: false,
    builder: { ...spec, timeColumn: timeCol, generatedQuery: query },
  };
}

// =============================================================================
// Suggestions: table schema → ranked default panels
// =============================================================================

export interface PanelSuggestion {
  /** Ready-to-use panel title ("Users per day"). */
  title: string;
  panelType: KnownPanelType;
  /** Fully materialized data source (query + builder spec). */
  dataSource: ConnectionDataSource;
  config: Partial<PanelConfig>;
  /** Higher = better default. Sorted descending. */
  score: number;
}

const BUCKET_LABEL: Record<FixedBucket, string> = {
  hour: "per hour",
  day: "per day",
  week: "per week",
  month: "per month",
};

function bucketPhrase(bucket: PanelBuilderSpec["bucket"]): string {
  return bucket && bucket !== "auto" ? BUCKET_LABEL[bucket] : "over time";
}

/**
 * Rank the best default panels for one table. The first suggestion is the
 * "how many rows per day" chart — the founder path for a `users` table.
 */
export function suggestPanelsForTable(
  table: BuilderTable,
  sourceId: string,
  opts: {
    maxSuggestions?: number;
    tables?: BuilderTable[];
    /** Scope every suggestion to one entity's rows (discovered sources). */
    entityFilter?: { column: string; value: string };
  } = {},
): PanelSuggestion[] {
  const max = opts.maxSuggestions ?? 4;
  const tables = opts.tables ?? [table];
  const entityFilter = opts.entityFilter;
  const timeCol = detectTimeColumn(table.columns);
  const out: PanelSuggestion[] = [];

  if (!timeCol) {
    // No time axis → the honest default is a raw table view.
    const spec: DraftBuilderSpec = {
      version: 1,
      table: table.name,
      aggregate: { fn: "raw" },
    };
    return [
      {
        title: humanize(table.name),
        panelType: "datagrid",
        dataSource: materializeConnectionDataSource(
          sourceId,
          spec,
          tables,
          entityFilter,
        ),
        config: {},
        score: 10,
      },
    ];
  }

  const countSpec: DraftBuilderSpec = {
    version: 1,
    table: table.name,
    timeColumn: timeCol,
    aggregate: { fn: "count" },
    bucket: "day",
  };
  out.push({
    title: `${humanize(table.name)} ${bucketPhrase("day")}`,
    panelType: "bar",
    dataSource: materializeConnectionDataSource(
      sourceId,
      countSpec,
      tables,
      entityFilter,
    ),
    config: { decimals: 0 },
    score: 100,
  });

  const measures = measureColumns(table.columns, { timeColumn: timeCol });
  measures.slice(0, Math.max(0, max - 1)).forEach((m, i) => {
    const spec: DraftBuilderSpec = {
      version: 1,
      table: table.name,
      timeColumn: timeCol,
      aggregate: { fn: "avg", column: m },
      bucket: "day",
    };
    out.push({
      title: `Avg ${humanize(m).toLowerCase()} ${bucketPhrase("day")}`,
      panelType: "line",
      dataSource: materializeConnectionDataSource(
        sourceId,
        spec,
        tables,
        entityFilter,
      ),
      config: { smoothLines: true },
      score: 90 - i * 5,
    });
  });

  return out.slice(0, max).sort((a, b) => b.score - a.score);
}

/** Dimension columns suitable for the "Split by" dropdown. */
export function splitByCandidates(
  table: BuilderTable,
  timeCol: string | undefined,
): string[] {
  return pivotCandidates([table], [table.name], [], timeCol);
}
