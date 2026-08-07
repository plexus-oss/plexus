/**
 * Entity discovery — identity declaration's third home.
 *
 * A DiscoveryRule lives on a CONNECTION source at `config.discovery` (jsonb,
 * no migration) and says: "this table's <idColumn> names the things I'm
 * monitoring." The discovery loop reads distinct values and mints one source
 * per value (kind = rule.kind), keeping a source_associations row per entity
 * as the source of truth for the slice predicate (filter_column = value).
 */

export interface DiscoveryRule {
  table: string;
  schema?: string;
  /** Column whose distinct values name the entities. */
  idColumn: string;
  /** Time column for freshness (last row seen → last_seen_at). */
  timeColumn?: string;
  /** Source kind for minted entities (lib/sources/kinds.ts id). */
  kind: string;
  enabled: boolean;
}

/** Bounds: distinct identities per rule; matches POLL_ROW_LIMIT ethos. */
export const DISCOVERY_IDENTITY_LIMIT = 1000;

export function discoveryRulesOf(
  config: Record<string, unknown> | null | undefined,
): DiscoveryRule[] {
  const raw = (config as { discovery?: unknown } | null)?.discovery;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is DiscoveryRule =>
      !!r &&
      typeof (r as DiscoveryRule).table === "string" &&
      typeof (r as DiscoveryRule).idColumn === "string" &&
      typeof (r as DiscoveryRule).kind === "string",
  );
}
