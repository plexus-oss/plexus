/**
 * Discovery SQL builders. Pure module (unit-testable, no I/O), built on the
 * poll SQL primitives — identifiers are always quoted via quoteIdent, never
 * string-concatenated.
 */
import {
  quoteIdent,
  tableRef,
  type PollDialect,
} from "@/lib/alerts/event-poll-sql";
import { DISCOVERY_IDENTITY_LIMIT, type DiscoveryRule } from "./types";

export function buildDistinctIdentitySql(
  dialect: PollDialect,
  rule: Pick<DiscoveryRule, "table" | "schema" | "idColumn">,
  limit: number = DISCOVERY_IDENTITY_LIMIT,
): string {
  const col = quoteIdent(dialect, rule.idColumn);
  const ref = tableRef(
    rule.schema
      ? { dialect, table: rule.table, schema: rule.schema }
      : { dialect, table: rule.table },
  );
  return `SELECT DISTINCT ${col} AS plexus_id FROM ${ref} WHERE ${col} IS NOT NULL LIMIT ${Math.trunc(limit)}`;
}

/**
 * One grouped query per rule — never per entity — mapping every identity to
 * its newest row time. Rendered as text by the source DB itself (same
 * precision doctrine as the poll watermark).
 */
export function buildFreshnessSql(
  dialect: PollDialect,
  rule: Pick<DiscoveryRule, "table" | "schema" | "idColumn"> & {
    timeColumn: string;
  },
  limit: number = DISCOVERY_IDENTITY_LIMIT,
): string {
  const col = quoteIdent(dialect, rule.idColumn);
  const time = quoteIdent(dialect, rule.timeColumn);
  const ref = tableRef(
    rule.schema
      ? { dialect, table: rule.table, schema: rule.schema }
      : { dialect, table: rule.table },
  );
  return `SELECT ${col} AS plexus_id, MAX(${time}) AS last_seen FROM ${ref} WHERE ${col} IS NOT NULL GROUP BY ${col} LIMIT ${Math.trunc(limit)}`;
}
