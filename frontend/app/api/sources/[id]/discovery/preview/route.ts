/**
 * GET /api/sources/[id]/discovery/preview?table=&column=&schema=
 *
 * The "40 drones found" moment: run the identity DISTINCT against the
 * connection (sample + count) before the user commits to a rule.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { enforceSource } from "@/lib/access/sources";
import { isApiError, errorResponse } from "@/lib/api/errors";
import { decrypt } from "@/lib/encryption";
import {
  executeQuery,
  buildSSHTunnelConfig,
} from "@/lib/db/data-source-connections";
import { isPollDialect } from "@/lib/alerts/event-poll-sql";
import { buildDistinctIdentitySql } from "@/lib/discovery/sql";
import { slugForIdentity } from "@/lib/discovery/identity";
import type { DataSourceType } from "@/lib/db/types";

const SAMPLE_LIMIT = 50;
const COUNT_LIMIT = 1001; // one past the sync cap → "1000+" display

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { orgId, userId, orgRole } = await getAuth();
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const table = request.nextUrl.searchParams.get("table");
    const column = request.nextUrl.searchParams.get("column");
    const schema = request.nextUrl.searchParams.get("schema") ?? undefined;
    if (!table || !column) {
      return NextResponse.json(
        { error: "Missing 'table' or 'column' query param" },
        { status: 400 },
      );
    }

    const source = await findSourceByIdOrSlug(orgId, id);
    if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    await enforceSource(
      { orgId, userId: userId ?? undefined, orgRole: orgRole ?? undefined, isApiKeyAuth: false },
      source,
      "view",
    );
    const dialect = source.connection_type ?? null;
    if (source.source_type !== "connection" || !isPollDialect(dialect)) {
      return NextResponse.json(
        { error: "Preview requires a SQL connection source" },
        { status: 400 },
      );
    }
    if (!source.credentials_encrypted) {
      return NextResponse.json({ error: "Connection has no credentials" }, { status: 400 });
    }

    const rule = schema
      ? { table, idColumn: column, schema }
      : { table, idColumn: column };
    const result = await executeQuery({
      type: dialect as DataSourceType,
      connectionString: decrypt(source.credentials_encrypted),
      query: buildDistinctIdentitySql(dialect, rule, COUNT_LIMIT),
      timeout: 10_000,
      sshTunnel: source.ssh_credentials_encrypted
        ? buildSSHTunnelConfig(
            (source.metadata || {}) as Record<string, unknown>,
            decrypt(source.ssh_credentials_encrypted),
          )
        : undefined,
      existingConfig: (source.config as Record<string, unknown>) ?? {},
    });

    const values = result.rows
      .map((r) => r.plexus_id)
      .filter((v): v is string | number => v !== null && v !== undefined)
      .map(String);

    return NextResponse.json({
      count: Math.min(values.length, COUNT_LIMIT - 1),
      truncated: values.length >= COUNT_LIMIT,
      sample: values.slice(0, SAMPLE_LIMIT).map((value) => ({
        value,
        slug: slugForIdentity(value),
      })),
    });
  } catch (error) {
    if (isApiError(error)) return errorResponse(error);
    console.error("[discovery/preview] failed:", error);
    return NextResponse.json(
      { error: "Preview query failed — check the connection" },
      { status: 502 },
    );
  }
}
