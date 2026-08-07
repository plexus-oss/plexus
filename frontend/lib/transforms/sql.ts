/**
 * SQL Condition Builders
 *
 * Functions for converting filter/aggregation configurations into SQL fragments.
 * Extracted from lib/types/dashboard.ts for proper separation of concerns.
 */

import type { DataFilter, TimeBucket } from "@/lib/types/dashboard";

/**
 * Helper to check if a filter uses a numeric operator
 */
export function isNumericFilter(filter: DataFilter): boolean {
  return [">", ">=", "<", "<="].includes(filter.operator);
}

/**
 * Result of building parameterized SQL conditions
 */
export interface ParameterizedConditions {
  /** SQL fragment with $1, $2, ... placeholders */
  sql: string;
  /** Ordered parameter values */
  params: unknown[];
}

/**
 * Convert filters to parameterized SQL WHERE clause conditions.
 *
 * Returns { sql, params } where sql uses $1-style positional placeholders.
 * The caller is responsible for translating these to the target DB's syntax
 * (e.g. ? for MySQL, {p1:String} for ClickHouse).
 *
 * @param filters - Array of DataFilter objects
 * @param paramOffset - Starting parameter index (default 1), useful when
 *   combining with other parameterized fragments
 * @param dialect - String operators cast the column to text so LIKE works on
 *   uuid/numeric columns ("operator does not exist: uuid ~~ text")
 */
export function filtersToSqlConditions(
  filters: DataFilter[],
  paramOffset: number = 1,
  dialect: "postgres" | "clickhouse" = "postgres"
): ParameterizedConditions {
  const enabledFilters = filters.filter((f) => f.enabled !== false);
  if (enabledFilters.length === 0) return { sql: "", params: [] };

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = paramOffset;

  for (const filter of enabledFilters) {
    const field = `"${filter.field}"`;
    // LIKE only exists for text — cast so string filters work on any column.
    const textField =
      dialect === "clickhouse" ? `toString(${field})` : `${field}::text`;

    switch (filter.operator) {
      case "contains":
        conditions.push(`${textField} LIKE $${paramIdx}`);
        params.push(`%${filter.value}%`);
        paramIdx++;
        break;
      case "startsWith":
        conditions.push(`${textField} LIKE $${paramIdx}`);
        params.push(`${filter.value}%`);
        paramIdx++;
        break;
      case "endsWith":
        conditions.push(`${textField} LIKE $${paramIdx}`);
        params.push(`%${filter.value}`);
        paramIdx++;
        break;
      default:
        conditions.push(`${field} ${filter.operator} $${paramIdx}`);
        params.push(filter.value);
        paramIdx++;
        break;
    }
  }

  return {
    sql: conditions.join(" AND "),
    params,
  };
}

/**
 * Convert time bucket to SQL interval string
 */
export function timeBucketToInterval(bucket: TimeBucket): string {
  const map: Record<TimeBucket, string> = {
    "1m": "1 minute",
    "5m": "5 minutes",
    "15m": "15 minutes",
    "1h": "1 hour",
    "6h": "6 hours",
    "1d": "1 day",
  };
  return map[bucket];
}
