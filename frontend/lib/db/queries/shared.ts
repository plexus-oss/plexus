/**
 * Shared database utilities.
 *
 * - `createOrgQueries` — generic org-scoped CRUD on Drizzle (the `db` client).
 *
 * Org isolation is enforced at the app layer: every method takes `orgId` and
 * filters on it. Column field names in the Drizzle schema are snake_case, so
 * query results match the app's snake_case shapes with no mapping.
 */

import "server-only";

import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { db } from "../client";
import * as schema from "../schema";

/**
 * Compatibility shim — the Drizzle pool already bypasses RLS (it connects as the
 * app role, not via PostgREST), so "run with service role" is just running the
 * function. Kept so the callers that wrapped privileged writes don't churn.
 */
export function runWithServiceRole<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

// --- Drizzle helpers ----------------------------------------------------------

/** First row or null — the common `.single()`/`.maybeSingle()` replacement. */
export function oneOrNull<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

// A Drizzle table that also exposes its columns for indexed access by
// snake_case name — what the dynamic-table modules need without `any`.
export type ResolvedTable = PgTable & Record<string, AnyPgColumn>;

// SQL table name ("org_members") → Drizzle table object (schema.orgMembers).
// Exported for the dynamic-table modules (e.g. access.ts) that resolve a table
// by its SQL name from a registry.
export function resolveTable(tableName: string): ResolvedTable {
  const camel = tableName.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
  const tbl = (schema as Record<string, unknown>)[camel] ?? (schema as Record<string, unknown>)[tableName];
  if (!tbl) throw new Error(`createOrgQueries: no Drizzle table for "${tableName}"`);
  return tbl as ResolvedTable;
}

// Drizzle tables expose their columns as properties; this view lets us index
// them by snake_case name without resorting to `any`.
function cols(table: PgTable): Record<string, AnyPgColumn> {
  return table as unknown as Record<string, AnyPgColumn>;
}

// AND of equality filters from a plain {column: value} object (snake keys).
function eqFilters(table: PgTable, filters: Record<string, unknown>): SQL | undefined {
  const c = cols(table);
  const conds = Object.entries(filters).map(([k, v]) => eq(c[k], v));
  return conds.length ? and(...conds) : undefined;
}

export interface FindManyOpts {
  orderBy?: [column: string, dir: "asc" | "desc"];
  limit?: number;
  offset?: number;
}

/**
 * Org-scoped CRUD on Drizzle. Pass the Drizzle table object directly — the
 * table is typed at compile time (no runtime name resolution). Return types
 * use the caller-supplied <T, TNew> so they match the hand-maintained Database
 * interface types until those are replaced by Drizzle inference.
 */
export function createOrgQueries<T, TNew>(table: PgTable) {
  return {
    findAll: async (orgId: string): Promise<T[]> =>
      (await db.select().from(table).where(eq(cols(table).org_id, orgId))) as T[],

    findById: async (orgId: string, id: string): Promise<T[]> =>
      (await db
        .select()
        .from(table)
        .where(and(eq(cols(table).org_id, orgId), eq(cols(table).id, id)))) as T[],

    /** First row matching org + filters, or null. */
    findOne: async (orgId: string, filters: Record<string, unknown> = {}): Promise<T | null> => {
      const rows = await db
        .select()
        .from(table)
        .where(and(eq(cols(table).org_id, orgId), eqFilters(table, filters)))
        .limit(1);
      return (rows[0] ?? null) as T | null;
    },

    /** Org-scoped find with arbitrary equality filters + order/limit/offset. */
    findMany: async (
      orgId: string,
      filters: Record<string, unknown> = {},
      opts: FindManyOpts = {},
    ): Promise<T[]> => {
      let q = db
        .select()
        .from(table)
        .where(and(eq(cols(table).org_id, orgId), eqFilters(table, filters)))
        .$dynamic();
      if (opts.orderBy) {
        const [col, dir] = opts.orderBy;
        q = q.orderBy(dir === "desc" ? desc(cols(table)[col]) : asc(cols(table)[col]));
      }
      if (opts.limit != null) q = q.limit(opts.limit);
      if (opts.offset != null) q = q.offset(opts.offset);
      return (await q) as T[];
    },

    insert: async (orgId: string, data: Omit<TNew, "org_id">): Promise<T[]> =>
      (await db
        .insert(table)
        .values({ ...(data as object), org_id: orgId } as never)
        .returning()) as T[],

    update: async (orgId: string, id: string, data: Partial<TNew>): Promise<T[]> =>
      (await db
        .update(table)
        .set(data as object)
        .where(and(eq(cols(table).org_id, orgId), eq(cols(table).id, id)))
        .returning()) as T[],

    delete: async (orgId: string, id: string): Promise<T[]> =>
      (await db
        .delete(table)
        .where(and(eq(cols(table).org_id, orgId), eq(cols(table).id, id)))
        .returning()) as T[],

    count: async (orgId: string): Promise<number> => {
      const r = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(table)
        .where(eq(cols(table).org_id, orgId));
      return r[0]?.count ?? 0;
    },
  };
}
