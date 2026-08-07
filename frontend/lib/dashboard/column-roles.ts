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
function isTimeType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("timestamp") || t.includes("date") || t === "time";
}

/** Looks like an identifier/key by name: `id`, `*_id`, `*_no`, `*_key`. */
export function isKeyName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "id" || /_(id|no|key)$/.test(n);
}

/**
 * Pick the most likely time column from a list of columns.
 *   1. A timestamp/date/time-typed column
 *   2. A column named timestamp/time/ts/created_at/updated_at
 */
export function detectTimeColumn(columns: RoleColumn[]): string | undefined {
  const typeMatch = columns.find((c) => isTimeType(c.type));
  if (typeMatch) return typeMatch.name;
  const nameMatch = columns.find((c) =>
    ["timestamp", "time", "ts", "created_at", "updated_at"].includes(
      c.name.toLowerCase(),
    ),
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
