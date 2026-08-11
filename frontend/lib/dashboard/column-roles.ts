/**
 * Column role classification for connection (SQL) data sources.
 *
 * Charts need to tell apart three kinds of column so they plot the right thing:
 *   - time      → the X axis
 *   - measure   → a real quantity to plot on Y (temperature, voltage, count…)
 *   - dimension → an id / key / category you group or join by, NOT a Y value
 *
 * Plotting dimensions as measures is the bug behind `sat_id`/`orbit_id` showing
 * up as series. This module is dependency-free so both the data-source builder
 * and the panel data hook can share one definition.
 */

export interface RoleColumn {
  name: string;
  type: string;
  isPrimaryKey?: boolean;
}

export type ColumnRole = "time" | "measure" | "dimension";

/** SQL types we treat as plottable numbers. */
export function isNumericType(type: string): boolean {
  const t = type.toLowerCase();
  return (
    t.includes("int") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("numeric") ||
    t.includes("decimal") ||
    t === "real"
  );
}

/** A timestamp-ish type. */
export function isTimeType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("timestamp") || t.includes("date") || t === "time";
}

/** An integer-ish type — usable as a monotonic id cursor for event polling. */
export function isIntegerType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("int") || t.includes("serial");
}

/** Looks like an identifier/key by name: `id`, `*_id`, `*_no`, `*_key`. */
export function isKeyName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "id" || /_(id|no|key)$/.test(n);
}

/** Names that mean "when the row was CREATED", in preference order. */
const INSERT_TIME_NAMES = [
  "created_at",
  "inserted_at",
  "received_at",
  "ingested_at",
  "event_time",
  "logged_at",
  "timestamp",
  "time",
  "ts",
];

/** Names that mean "when the row was last TOUCHED" — a poll cursor pinned to
 * one of these re-emits every UPDATE as a "new" row (login bumps
 * last_login_at → a "new signup" monitor fires). */
const MUTATION_TIME_NAME = /^(updated_at|updated_on|modified|last_)/;

/**
 * Pick the most likely time column from a list of columns.
 *   1. A time-typed column with an insert-time name (created_at, timestamp, …)
 *   2. A time-typed column that isn't a mutation timestamp (ordinal order)
 *   3. Any time-typed column
 *   4. Name fallback for untyped snapshots
 */
export function detectTimeColumn(columns: RoleColumn[]): string | undefined {
  const timeTyped = columns.filter((c) => isTimeType(c.type));
  for (const name of INSERT_TIME_NAMES) {
    const hit = timeTyped.find((c) => c.name.toLowerCase() === name);
    if (hit) return hit.name;
  }
  const nonMutation = timeTyped.find(
    (c) => !MUTATION_TIME_NAME.test(c.name.toLowerCase()),
  );
  if (nonMutation) return nonMutation.name;
  if (timeTyped.length > 0) return timeTyped[0].name;
  const nameMatch = columns.find((c) =>
    [...INSERT_TIME_NAMES, "updated_at"].includes(c.name.toLowerCase()),
  );
  return nameMatch?.name;
}

/**
 * Classify a column as time / measure / dimension.
 *
 * `timeColumn` (if known) and `joinKeys` (columns used in joins) are forced to
 * time/dimension respectively; otherwise we fall back to name + type.
 */
export function classifyColumn(
  col: RoleColumn,
  opts: { timeColumn?: string; joinKeys?: string[] } = {},
): ColumnRole {
  if (opts.timeColumn && col.name === opts.timeColumn) return "time";
  if (isTimeType(col.type)) return "time";
  if (opts.joinKeys?.includes(col.name)) return "dimension";
  if (col.isPrimaryKey) return "dimension";
  if (isKeyName(col.name)) return "dimension";
  // Numeric and not an id/key/time → a real measure. Everything else
  // (strings, enums, categoricals like `assoc_type`) is a dimension.
  return isNumericType(col.type) ? "measure" : "dimension";
}

/** Convenience: the names of all measure columns (in column order). */
export function measureColumns(
  columns: RoleColumn[],
  opts: { timeColumn?: string; joinKeys?: string[] } = {},
): string[] {
  return columns
    .filter((c) => classifyColumn(c, opts) === "measure")
    .map((c) => c.name);
}
