/**
 * Pure SQL emitter for connection-backed panels.
 *
 * Extracted from the DataSourceSelector closure so one builder serves the
 * visual query UI, the quick-chart flow, quick-start, and AI proposals.
 * Dependency-free apart from column-roles (same rule as that module): callers
 * pass the connection's tables; `SchemaTable` from use-connection-schema is
 * structurally assignable to `BuilderTable`.
 *
 * Emitted SQL is the contract with every stored panel — changes here must
 * keep the no-agg output byte-identical (see connection-query-builder.test.ts).
 */

import {
  classifyColumn,
  detectTimeColumn,
  isKeyName,
  isNumericType,
  measureColumns,
  type RoleColumn,
} from "@/lib/dashboard/column-roles";
import type { JoinSpec } from "@/lib/types/dashboard";

export interface BuilderColumn extends RoleColumn {
  nullable?: boolean;
  /** Declared foreign-key target, when the driver exposes it. */
  foreignKey?: { table: string; column: string } | null;
}

export interface BuilderTable {
  name: string;
  schema?: string;
  columns: BuilderColumn[];
}

/** Aggregate applied per measure when bucketing by time (non-count mode). */
export type MeasureAgg = "avg" | "sum" | "min" | "max";

/** Fixed time bucket emitted as `$__timeGroup(col, '<unit>')`. */
export type FixedBucket = "hour" | "day" | "week" | "month";

// =============================================================================
// Table/column helpers
// =============================================================================

export function tableByName(
  tables: BuilderTable[],
  name: string,
): BuilderTable | undefined {
  return tables.find((t) => t.name === name);
}

export function selectedTableNames(base: string, joins: JoinSpec[]): string[] {
  return [base, ...joins.map((j) => j.table)];
}

/** Deduped columns across the selected tables (first table wins on clash). */
export function unionColumns(
  tables: BuilderTable[],
  tableNames: string[],
): BuilderColumn[] {
  const seen = new Set<string>();
  const cols: BuilderColumn[] = [];
  for (const tn of tableNames)
    for (const c of tableByName(tables, tn)?.columns ?? []) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      cols.push(c);
    }
  return cols;
}

/** The time column to use (first selected table that has one) + its owner. */
export function resolveTimeColumn(
  tables: BuilderTable[],
  tableNames: string[],
): { col?: string; owner?: string } {
  for (const tn of tableNames) {
    const col = detectTimeColumn(tableByName(tables, tn)?.columns ?? []);
    if (col) return { col, owner: tn };
  }
  return {};
}

/** Measures available to plot across the selected tables. */
export function availableMeasures(
  tables: BuilderTable[],
  tableNames: string[],
  joins: JoinSpec[],
  timeCol: string | undefined,
  seriesColumn: string | undefined,
): string[] {
  return measureColumns(unionColumns(tables, tableNames), {
    timeColumn: timeCol,
    joinKeys: joins.flatMap((j) => [j.localColumn, j.foreignColumn]),
  }).filter((m) => m !== seriesColumn);
}

/** Categorical columns suitable for a breakdown (non-key, non-time). */
export function pivotCandidates(
  tables: BuilderTable[],
  tableNames: string[],
  joins: JoinSpec[],
  timeCol: string | undefined,
): string[] {
  return unionColumns(tables, tableNames)
    .filter(
      (c) =>
        c.name !== timeCol &&
        !isKeyName(c.name) &&
        classifyColumn(c, {
          timeColumn: timeCol,
          joinKeys: joins.flatMap((j) => [j.localColumn, j.foreignColumn]),
        }) === "dimension",
    )
    .map((c) => c.name);
}

/** Score how key-like a shared column is (PK/`id`/`*_id`/`*_no`/`*_key`). */
export function joinKeyScore(
  name: string,
  foreignCol: { name: string; isPrimaryKey?: boolean } | undefined,
): number {
  if (foreignCol?.isPrimaryKey) return 2;
  const n = name.toLowerCase();
  if (n === "id" || /_(id|no|key)$/.test(n)) return 1;
  return 0;
}

/** Coarse type class for join-key compatibility checks. */
export function typeClass(
  sqlType: string,
): "uuid" | "text" | "numeric" | "time" | "bool" | "other" {
  const t = sqlType.toLowerCase();
  if (t.includes("uuid")) return "uuid";
  if (
    t.includes("char") ||
    t.includes("text") ||
    t.includes("string") ||
    t.includes("enum")
  )
    return "text";
  if (isNumericType(t)) return "numeric";
  if (t.includes("timestamp") || t.includes("date") || t === "time")
    return "time";
  if (t.includes("bool")) return "bool";
  return "other";
}

/**
 * Whether joining two columns needs a text cast, is fine as-is, or shouldn't
 * be auto-joined at all. `uuid = text` is the classic silent-until-runtime
 * Postgres failure ("operator does not exist: text = uuid").
 */
export function joinCastNeeded(
  a: BuilderColumn | undefined,
  b: BuilderColumn | undefined,
): "text" | "incompatible" | null {
  if (!a || !b) return null; // unknown → leave the comparison alone
  const ta = typeClass(a.type);
  const tb = typeClass(b.type);
  if (ta === tb) return null;
  if (ta === "other" || tb === "other") return null; // can't judge
  const pair = new Set([ta, tb]);
  if (pair.has("uuid") && pair.has("text")) return "text";
  // numeric↔text, time↔anything, bool↔anything: casting to text makes the SQL
  // run for a join the USER stored, but such pairs are junk as auto-picks.
  return "incompatible";
}

/** Find how `newTable` relates to `base`: FK first, then a key-named match. */
export function resolveJoinKey(
  base: BuilderTable | undefined,
  newTable: BuilderTable | undefined,
): { localColumn: string; foreignColumn: string } | null {
  if (!base || !newTable) return null;
  const fk = base.columns.find(
    (c) => c.foreignKey && c.foreignKey.table === newTable.name,
  );
  if (fk?.foreignKey)
    return { localColumn: fk.name, foreignColumn: fk.foreignKey.column };
  const rfk = newTable.columns.find(
    (c) => c.foreignKey && c.foreignKey.table === base.name,
  );
  if (rfk?.foreignKey)
    return { localColumn: rfk.foreignKey.column, foreignColumn: rfk.name };
  let best: { local: string; foreign: string; score: number } | null = null;
  for (const c of base.columns) {
    const f = newTable.columns.find((x) => x.name === c.name);
    if (!f) continue;
    // Never auto-pick a type-incompatible pair (text=uuid is castable, but
    // e.g. numeric=text name matches are junk) — fall through to the manual
    // join-key picker instead of emitting SQL that errors at runtime.
    if (joinCastNeeded(c, f) === "incompatible") continue;
    const score = joinKeyScore(c.name, f);
    if (score > 0 && (!best || score > best.score))
      best = { local: c.name, foreign: c.name, score };
  }
  return best ? { localColumn: best.local, foreignColumn: best.foreign } : null;
}

/** The table owning `col` among base + joined tables (base on miss). */
export function ownerOf(
  tables: BuilderTable[],
  base: string,
  joins: JoinSpec[],
  col: string,
): string {
  if (tableByName(tables, base)?.columns.some((c) => c.name === col))
    return base;
  for (const j of joins)
    if (tableByName(tables, j.table)?.columns.some((c) => c.name === col))
      return j.table;
  return base;
}

// =============================================================================
// SQL emission
// =============================================================================

export interface BuildConnectionQueryOptions {
  tables: BuilderTable[];
  base: string;
  joins: JoinSpec[];
  timeCol?: string;
  measures: string[];
  seriesColumn?: string;
  countMode: boolean;
  /**
   * Bucket measures with $__timeGroup + this aggregate instead of selecting
   * raw rows ("avg revenue per day"). Ignored in count mode; omitted → the
   * historical raw-row SELECT, byte-identical to the pre-extraction builder.
   */
  measureAgg?: MeasureAgg;
  /**
   * Fixed bucket unit for $__timeGroup ("users per DAY"). Omitted → the
   * historical auto-sized bucket. Only affects count / measureAgg modes.
   */
  bucket?: FixedBucket;
  /**
   * Entity slice predicate for auto-discovered sources ("this device's rows"):
   * appended to every WHERE the emitter writes as
   * ` AND <owner>.<column> = '<value>'` (single quotes in the value doubled —
   * the file quotes no identifiers, so the column stays bare like every other
   * column). Omitted → output is byte-identical to the historical builder;
   * the derive-spec round-trip tests pin that.
   */
  entityFilter?: { column: string; value: string };
}

/**
 * Build the SQL for a (possibly multi-table) connection chart. Plots only
 * measures; when there are none, counts rows over a time bucket. An optional
 * breakdown column produces one series per value. Columns are qualified by
 * their owning table, and the time column is wrapped in `$__timeFilter` so
 * the dashboard time range applies.
 */
export function buildConnectionQuery(
  opts: BuildConnectionQueryOptions,
): string {
  const { tables, base, joins, timeCol, measures, seriesColumn, countMode } =
    opts;
  const from = () => {
    let s = ` FROM ${base}`;
    for (const j of joins) {
      const local = tableByName(tables, base)?.columns.find(
        (c) => c.name === j.localColumn,
      );
      const foreign = tableByName(tables, j.table)?.columns.find(
        (c) => c.name === j.foreignColumn,
      );
      // Mismatched key types (uuid↔text, or a stored user-picked pair we'd
      // never auto-suggest) compare as text via the dialect-resolved $__text
      // macro — otherwise Postgres errors with "operator does not exist".
      const cast = joinCastNeeded(local, foreign) !== null;
      const lhs = cast
        ? `$__text(${base}.${j.localColumn})`
        : `${base}.${j.localColumn}`;
      const rhs = cast
        ? `$__text(${j.table}.${j.foreignColumn})`
        : `${j.table}.${j.foreignColumn}`;
      s += ` JOIN ${j.table} ON ${lhs} = ${rhs}`;
    }
    return s;
  };
  const owner = (col: string) => ownerOf(tables, base, joins, col);
  // Entity slice predicate — literal single-quoted with '' doubling (the file
  // has no literal-quoting helper); null when absent so every emission below
  // stays byte-identical to the historical builder.
  const entityCond = opts.entityFilter
    ? `${owner(opts.entityFilter.column)}.${opts.entityFilter.column} = '${opts.entityFilter.value.replace(/'/g, "''")}'`
    : null;
  if (!timeCol)
    return entityCond
      ? `SELECT *${from()} WHERE ${entityCond}`
      : `SELECT *${from()}`;
  const qTime = `${owner(timeCol)}.${timeCol}`;
  const qSeries = seriesColumn ? `${owner(seriesColumn)}.${seriesColumn}` : null;
  const timeGroup = opts.bucket
    ? `$__timeGroup(${qTime}, '${opts.bucket}')`
    : `$__timeGroup(${qTime})`;
  if (countMode) {
    return (
      `SELECT ${timeGroup} AS ${timeCol}` +
      (qSeries ? `, ${qSeries}` : "") +
      `, count(*) AS count` +
      from() +
      ` WHERE $__timeFilter(${qTime})` +
      (entityCond ? ` AND ${entityCond}` : "") +
      ` GROUP BY ${timeGroup}` +
      (qSeries ? `, ${qSeries}` : "") +
      ` ORDER BY ${timeGroup}`
    );
  }
  if (opts.measureAgg) {
    const aggSel = measures
      .map((m) => `, ${opts.measureAgg}(${owner(m)}.${m}) AS ${m}`)
      .join("");
    return (
      `SELECT ${timeGroup} AS ${timeCol}` +
      (qSeries ? `, ${qSeries}` : "") +
      aggSel +
      from() +
      ` WHERE $__timeFilter(${qTime})` +
      (entityCond ? ` AND ${entityCond}` : "") +
      ` GROUP BY ${timeGroup}` +
      (qSeries ? `, ${qSeries}` : "") +
      ` ORDER BY ${timeGroup}`
    );
  }
  const measSel = measures.map((m) => `, ${owner(m)}.${m}`).join("");
  return (
    `SELECT ${qTime} AS ${timeCol}` +
    (qSeries ? `, ${qSeries}` : "") +
    measSel +
    from() +
    ` WHERE $__timeFilter(${qTime})` +
    (entityCond ? ` AND ${entityCond}` : "") +
    ` ORDER BY ${qTime}`
  );
}

// =============================================================================
// Derived data-source fields
// =============================================================================

export interface ConnectionSelection {
  base: string;
  joins: JoinSpec[];
  /** Measures the user explicitly picked (may be empty → plot all available). */
  measures: string[];
  seriesColumn?: string;
  measureAgg?: MeasureAgg;
}

export interface DerivedConnectionFields {
  query: string;
  timeColumn?: string;
  valueColumn?: string;
  seriesTableMap: Record<string, string>;
  breakdownTable?: string;
  countMode: boolean;
}

/**
 * The pure core of the visual builder's "apply" step: recompute the query and
 * the render-time hint fields from the current table/join/measure/pivot
 * selection.
 */
export function deriveConnectionFields(
  tables: BuilderTable[],
  selection: ConnectionSelection,
): DerivedConnectionFields {
  const { base, joins, seriesColumn, measureAgg } = selection;
  const tableNames = selectedTableNames(base, joins);
  const { col: timeCol } = resolveTimeColumn(tables, tableNames);
  const avail = availableMeasures(tables, tableNames, joins, timeCol, seriesColumn);
  const countMode = avail.length === 0;
  const measures = selection.measures.length ? selection.measures : avail;
  const query = buildConnectionQuery({
    tables,
    base,
    joins,
    timeCol,
    measures,
    seriesColumn,
    countMode,
    measureAgg,
  });
  const valueColumn = countMode
    ? "count"
    : measures.length === 1
      ? measures[0]
      : undefined;

  // Map each series → its owning table so per-table colors resolve at render.
  const seriesTableMap: Record<string, string> = {};
  if (countMode) {
    seriesTableMap.count = base;
  } else {
    for (const m of measures) seriesTableMap[m] = ownerOf(tables, base, joins, m);
  }
  const breakdownTable = seriesColumn
    ? ownerOf(tables, base, joins, seriesColumn)
    : undefined;

  return { query, timeColumn: timeCol, valueColumn, seriesTableMap, breakdownTable, countMode };
}
