/**
 * SQL builders for poll-based event detection against connection sources.
 *
 * Pure module (no server-only, no I/O) so the exact query text is unit-testable.
 *
 * Precision contract: the watermark is an OPAQUE string rendered by the source
 * database itself (`ts::text` / `CAST(ts AS CHAR)` / `toString(ts)`). We store
 * it verbatim and inline it back as a literal on the next poll, so the same DB
 * parses it at full native precision. Postgres/MySQL timestamps carry
 * microseconds; a JS Date round-trip truncates to milliseconds and would
 * re-match the newest row on every tick. Do not "simplify" this to ISO strings.
 */

export type PollDialect = "postgres" | "timescaledb" | "mysql" | "clickhouse";

export const POLL_ROW_LIMIT = 1000;

const POLL_DIALECTS: readonly PollDialect[] = [
  "postgres",
  "timescaledb",
  "mysql",
  "clickhouse",
];

/** Connection types the poller can build SQL for. */
export function isPollDialect(type: string | null): type is PollDialect {
  return POLL_DIALECTS.includes(type as PollDialect);
}

/** Quote an identifier for the dialect; rejects names we can't quote safely. */
export function quoteIdent(dialect: PollDialect, name: string): string {
  if (!name || name.includes("\0")) {
    throw new Error(`Unquotable identifier: ${JSON.stringify(name)}`);
  }
  if (dialect === "mysql" || dialect === "clickhouse") {
    return "`" + name.replace(/`/g, "``") + "`";
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

/** Escape a string for inlining as a single-quoted SQL literal. */
export function escapeLiteral(value: string): string {
  return value.replace(/\0/g, "").replace(/'/g, "''");
}

export interface PollTableRef {
  dialect: PollDialect;
  table: string;
  schema?: string;
}

export function tableRef({ dialect, table, schema }: PollTableRef): string {
  const quoted = quoteIdent(dialect, table);
  return schema ? `${quoteIdent(dialect, schema)}.${quoted}` : quoted;
}

/** Render the time column as text using the source DB's own formatter. */
function timeAsText(dialect: PollDialect, timeColumn: string): string {
  const col = quoteIdent(dialect, timeColumn);
  switch (dialect) {
    case "postgres":
    case "timescaledb":
      return `${col}::text`;
    case "mysql":
      return `CAST(${col} AS CHAR)`;
    case "clickhouse":
      return `toString(${col})`;
  }
}

/**
 * Optional entity predicate for auto-discovered sources: the discovered
 * source's rows are the slice of the parent connection's table where
 * `filterColumn = filterValue` (from source_associations). Rendered as
 * ` AND "col" = 'val'`; empty when absent so unfiltered SQL stays
 * byte-identical.
 */
function entityFilter(
  dialect: PollDialect,
  filterColumn?: string,
  filterValue?: string,
): string {
  if (filterColumn == null || filterValue == null) return "";
  return `AND ${quoteIdent(dialect, filterColumn)} = '${escapeLiteral(filterValue)}' `;
}

/**
 * Rows newer than the watermark, oldest first, capped. Selects only the time
 * column (as DB-rendered text) and the monitored column — never `SELECT *`.
 */
export function buildNewRowsSql(params: {
  dialect: PollDialect;
  table: string;
  schema?: string;
  timeColumn: string;
  valueColumn: string;
  watermark: string;
  limit?: number;
  filterColumn?: string;
  filterValue?: string;
}): string {
  const { dialect, timeColumn, valueColumn, watermark } = params;
  const limit = params.limit ?? POLL_ROW_LIMIT;
  const timeCol = quoteIdent(dialect, timeColumn);
  const valueCol = quoteIdent(dialect, valueColumn);
  return (
    `SELECT ${timeAsText(dialect, timeColumn)} AS plexus_ts, ${valueCol} AS plexus_value ` +
    `FROM ${tableRef(params)} ` +
    `WHERE ${timeCol} > '${escapeLiteral(watermark)}' ` +
    entityFilter(dialect, params.filterColumn, params.filterValue) +
    `ORDER BY ${timeCol} ASC ` +
    `LIMIT ${Math.trunc(limit)}`
  );
}

/**
 * Initial watermark = the newest existing row's time, rendered by the source
 * DB. Empty table falls back to the source DB's own clock (not ours — avoids
 * app/DB clock skew). ClickHouse needs a count() guard because max() over an
 * empty table returns the type default (1970), not NULL.
 */
export function buildInitWatermarkSql(params: {
  dialect: PollDialect;
  table: string;
  schema?: string;
  timeColumn: string;
  filterColumn?: string;
  filterValue?: string;
}): string {
  const { dialect, timeColumn, filterColumn, filterValue } = params;
  const col = quoteIdent(dialect, timeColumn);
  // No base WHERE clause here — the entity predicate introduces one.
  const where =
    filterColumn != null && filterValue != null
      ? ` WHERE ${quoteIdent(dialect, filterColumn)} = '${escapeLiteral(filterValue)}'`
      : "";
  const from = `FROM ${tableRef(params)}${where}`;
  switch (dialect) {
    case "postgres":
    case "timescaledb":
      return `SELECT COALESCE(MAX(${col})::text, now()::text) AS plexus_wm ${from}`;
    case "mysql":
      return `SELECT COALESCE(CAST(MAX(${col}) AS CHAR), CAST(NOW(6) AS CHAR)) AS plexus_wm ${from}`;
    case "clickhouse":
      return `SELECT if(count() = 0, toString(now64(3)), toString(max(${col}))) AS plexus_wm ${from}`;
  }
}
