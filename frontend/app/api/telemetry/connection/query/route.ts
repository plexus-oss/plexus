/**
 * Plexus Telemetry Connection Query API
 *
 * POST /api/telemetry/connection/query - Execute read-only queries against internal ClickHouse
 *
 * Wraps every query with an org-scoped CTE so users can only see their own data.
 */

import { NextResponse } from "next/server";
import { withOrgAuth } from "@/lib/api/with-auth";
import { validateReadOnlyQuery } from "@/lib/db/data-source-connections";
import { validateInternalTelemetryQuery } from "@/lib/db/drivers/shared/query-helpers";
import { getClient } from "@/lib/db/clickhouse";
import { loadAllowedSourceIds } from "@/lib/access/sources";
import { sourceQueries } from "@/lib/db/queries/sources";

interface QueryRequestBody {
  query: string;
  limit?: number;
  timeout?: number;
  params?: Record<string, unknown> & { __filterParams?: unknown[] };
}

/** Infer a ClickHouse parameter type tag from a JS value. */
function clickhouseTypeOf(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? "Int64" : "Float64";
  }
  if (typeof value === "boolean") return "Bool";
  return "String";
}

/**
 * Translate Postgres-style positional placeholders ($1, $2, ...) into
 * ClickHouse's named-param syntax ({p1:Type}, {p2:Type}, ...) and return the
 * rewritten SQL plus a param map keyed by pN.
 */
function bindFilterParams(
  sql: string,
  filterParams: unknown[],
): { sql: string; params: Record<string, unknown> } {
  if (!filterParams.length) return { sql, params: {} };
  const params: Record<string, unknown> = {};
  const rewritten = sql.replace(/\$(\d+)/g, (_, idxStr: string) => {
    const idx = parseInt(idxStr, 10);
    const value = filterParams[idx - 1];
    const key = `p${idx}`;
    params[key] = value;
    return `{${key}:${clickhouseTypeOf(value)}}`;
  });
  return { sql: rewritten, params };
}

export const POST = withOrgAuth(async (request, { orgId, userId }) => {
  try {
    const body: QueryRequestBody = await request.json();

    if (!body.query || typeof body.query !== "string") {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const userQuery = body.query.trim();

    // Validate read-only
    const validation = validateReadOnlyQuery(userQuery);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Strict ClickHouse guard: block table functions (merge/url/s3/remote/...)
    // and any schema-qualified table reference (plexus.events, system.*, ...)
    // that would read around the org-scoped CTE below. The only legitimate
    // source is the unqualified, CTE-shadowed `telemetry` table.
    const chGuard = validateInternalTelemetryQuery(userQuery);
    if (!chGuard.valid) {
      return NextResponse.json({ error: chGuard.error }, { status: 400 });
    }

    const limit = Math.min(body.limit ?? 1000, 10000);

    // Translate Postgres-style $N placeholders (emitted by filter injection)
    // into ClickHouse's {pN:Type} named params before wrapping.
    const filterParams = Array.isArray(body.params?.__filterParams)
      ? (body.params!.__filterParams as unknown[])
      : [];
    const { sql: boundQuery, params: boundParams } = bindFilterParams(
      userQuery,
      filterParams,
    );

    // Scoped members only see telemetry for their allow-listed sources.
    // ClickHouse source_id holds the device SLUG, so map ids → slugs; an
    // empty allow-list matches nothing (fail-closed).
    const allowed = userId
      ? await loadAllowedSourceIds(orgId, userId)
      : null;
    let scopePredicate = "";
    const scopeParams: Record<string, unknown> = {};
    if (allowed) {
      const sources =
        allowed.size > 0
          ? await sourceQueries.findByIds(orgId, [...allowed])
          : [];
      scopePredicate = " AND source_id IN {allowedSlugs:Array(String)}";
      scopeParams.allowedSlugs = sources.map((s) => s.slug);
    }

    // Wrap user query with org-scoped CTE that shadows the telemetry table
    const hasLimit = /\bLIMIT\s+\d+/i.test(boundQuery);
    const wrappedQuery = `WITH telemetry AS (SELECT * FROM telemetry WHERE org_id = {orgId:String}${scopePredicate})\n${boundQuery}${hasLimit ? "" : `\nLIMIT ${limit}`}`;

    // Pass orgId so the row-policy backstop (when enabled) stamps plexus_org_id.
    const client = getClient(orgId);
    const startTime = Date.now();

    try {
      const result = await client.query({
        query: wrappedQuery,
        query_params: { orgId, ...scopeParams, ...boundParams },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Record<string, unknown>[];
      const executionTimeMs = Date.now() - startTime;

      // Derive columns from first row
      const columns =
        rows.length > 0
          ? Object.keys(rows[0]).map((name) => ({
              name,
              type: typeof rows[0][name] === "number" ? "number" : "string",
            }))
          : [];

      return NextResponse.json({
        columns,
        rows,
        rowCount: rows.length,
        executionTimeMs,
        truncated: rows.length >= limit,
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    console.error("[Telemetry Connection Query] Error:", error);
    const message =
      error instanceof Error ? error.message : "Query execution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
