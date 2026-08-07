/**
 * Row-level scoping for connection (SQL) queries — fed from discovery
 * associations, not a hand-maintained ID list.
 *
 * Scope is an allow-list of SOURCES (lib/access/scope.ts). For a connection
 * query by a scoped viewer:
 *
 *   - connection itself in scope        → full rows
 *   - only associated ENTITY sources in
 *     scope (sat-25544 …)              → wrap the query so only rows matching
 *                                        those entities' slice predicates
 *                                        (source_associations.filter_column =
 *                                        filter_value) survive
 *   - neither                          → deny (fail-closed; the caller
 *                                        returns an empty result marked
 *                                        `restricted`)
 *
 * The wrap is parameterized end to end (column names AND values are bound),
 * appended AFTER any user-authored filters in `__filterParams` — filters are
 * the viewer's lens, this is the server's wall, and they compose.
 */

import "server-only";

import { loadEffectiveScope } from "./scope";
import { sourceAssociationQueries } from "@/lib/db/queries/sources";

export interface RowScopeCtx {
  orgId: string;
  userId: string | undefined;
  isApiKeyAuth: boolean;
}

/** Only simple identifiers are accepted as slice columns (defense-in-depth). */
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ScopedQuery {
  query: string;
  params: Record<string, unknown> & { __filterParams?: unknown[] };
  /** True when the viewer is scoped and holds no slice of this connection. */
  deny: boolean;
}

/**
 * Additional slice columns a connection declares (`config.scopeColumns`).
 * Some tables identify the same entity under different columns (e.g.
 * conjunction_event's sat_id_1/sat_id_2 name the two objects) — the entity
 * VALUES come from associations, but they're matched against every declared
 * column so multi-column tables keep working.
 */
function scopeColumnsOf(config: unknown): string[] {
  const cfg = config as Record<string, unknown> | null | undefined;
  const raw = cfg?.scopeColumns ?? cfg?.scopeColumn;
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  return list.filter(
    (c): c is string => typeof c === "string" && SAFE_IDENT.test(c),
  );
}

/**
 * Apply source-scope row filtering to a connection query. Returns the
 * (possibly wrapped) query + params, or `deny: true` to signal the caller
 * should return an empty result without executing anything.
 */
export async function scopeConnectionQuery(
  ctx: RowScopeCtx,
  source: { id: string; config?: unknown },
  query: string,
  params:
    | (Record<string, unknown> & { __filterParams?: unknown[] })
    | undefined,
): Promise<ScopedQuery> {
  const pass: ScopedQuery = { query, params: params ?? {}, deny: false };

  // API-key automation and userless contexts are never row-scoped; admins are
  // never scoped (enforced inside loadEffectiveScope).
  if (ctx.isApiKeyAuth || !ctx.userId) return pass;

  const scope = await loadEffectiveScope(ctx.orgId, ctx.userId);
  if (scope.pickedSourceIds === null) return pass; // unrestricted — common case
  // Whole connection granted (a literal pick, not derived-via-entity).
  if (scope.pickedSourceIds.has(source.id)) return pass;

  // Slice predicates of the viewer's picked entities on THIS connection.
  const associations = await sourceAssociationQueries.findByConnection(
    ctx.orgId,
    source.id,
  );
  const mine = associations.filter(
    (a) =>
      scope.pickedSourceIds!.has(a.entity_id) &&
      a.filter_column &&
      SAFE_IDENT.test(a.filter_column) &&
      a.filter_value != null,
  );
  if (mine.length === 0) return { ...pass, deny: true }; // no slice → nothing

  // Columns = association columns ∪ the connection's declared scopeColumns
  // (multi-column tables like conjunction_event name entities under several
  // columns). Values = the picked entities' ids. Cross-matching column × value
  // is intended: every slice column holds the same identity namespace, and a
  // row matches when ANY of them names one of the viewer's entities.
  const columns = [
    ...new Set([
      ...mine.map((a) => a.filter_column!),
      ...scopeColumnsOf(source.config),
    ]),
  ].sort();
  const values = [...new Set(mine.map((a) => String(a.filter_value)))].sort();

  // Positional params: keep any existing filter params first, then append
  // the column list and value list. Everything is bound — injection-safe.
  const existing = Array.isArray(params?.__filterParams)
    ? params!.__filterParams
    : params
      ? Object.values(params)
      : [];
  const colsParam = `$${existing.length + 1}`;
  const valsParam = `$${existing.length + 2}`;

  // jsonb_each_text over to_jsonb(row) tolerates queries that don't output a
  // slice column (no error → zero rows, fail-closed).
  const wrapped = `SELECT * FROM (${query}) AS _scoped WHERE EXISTS (SELECT 1 FROM jsonb_each_text(to_jsonb(_scoped)) AS _kv(k, v) WHERE _kv.k = ANY(${colsParam}) AND _kv.v = ANY(${valsParam}))`;

  return {
    query: wrapped,
    params: { __filterParams: [...existing, columns, values] },
    deny: false,
  };
}

/** Empty connection-query result (used when a scoped query is denied). */
export const EMPTY_QUERY_RESULT = {
  columns: [] as { name: string; type: string }[],
  rows: [] as Record<string, unknown>[],
  rowCount: 0,
  executionTimeMs: 0,
  truncated: false,
};
