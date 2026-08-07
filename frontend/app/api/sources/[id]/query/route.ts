/**
 * Source Query API - Execute queries against connection sources
 *
 * POST /api/sources/[id]/query - Execute a read-only query
 *
 * Uses singleflight + short-TTL caching to prevent multiple users
 * viewing the same dashboard from each opening their own DB connection.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { enforceSource } from "@/lib/access/sources";
import {
  scopeConnectionQuery,
  EMPTY_QUERY_RESULT,
} from "@/lib/access/entity-scope";
import { apiError, isApiError, errorResponse } from "@/lib/api/errors";
import { decrypt } from "@/lib/encryption";
import {
  executeQuery,
  buildSSHTunnelConfig,
  maybeMigrateLegacySource,
} from "@/lib/db/data-source-connections";
import {
  singleflight,
  queryCacheKey,
  getCachedQuery,
  setCachedQuery,
  checkCircuit,
  recordSuccess,
  recordFailure,
  acquireSlot,
} from "@/lib/db/query-cache";
import type { DataSourceType } from "@/lib/db/types";

interface QueryRequestBody {
  query: string;
  params?: Record<string, unknown>;
  limit?: number;
  timeout?: number;
}

// POST /api/sources/[id]/query
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Hoisted so the catch block can log/return the SQL that failed.
  let submittedQuery: string | undefined;
  try {
    const { orgId, userId, orgRole } = await getAuth();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Parse request body
    const body: QueryRequestBody = await request.json();
    submittedQuery = typeof body.query === "string" ? body.query : undefined;

    if (!body.query || typeof body.query !== "string") {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    // Find the source
    const source = await findSourceByIdOrSlug(orgId, id);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    // Per-source grant check — org membership alone is not enough when the
    // source is named by an access rule. The panel already names this source,
    // so an access denial is surfaced as RESTRICTED (a distinct, quiet panel
    // state) rather than the probe-safe NOT_FOUND the detail routes use.
    try {
      await enforceSource(
        {
          orgId,
          userId: userId ?? undefined,
          orgRole: orgRole ?? undefined,
          isApiKeyAuth: false,
        },
        source,
        "view",
      );
    } catch (err) {
      if (isApiError(err) && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) {
        throw apiError("RESTRICTED", "Not available with your access");
      }
      throw err;
    }

    // Only connection sources can be queried
    if (source.source_type !== "connection") {
      return NextResponse.json(
        { error: "Only connection sources can be queried" },
        { status: 400 }
      );
    }

    if (!source.credentials_encrypted || !source.connection_type) {
      return NextResponse.json(
        { error: "Source is missing connection credentials" },
        { status: 400 }
      );
    }

    // Source must be online
    if (source.status !== "online") {
      return NextResponse.json(
        { error: "Connection is not online. Please test the connection first." },
        { status: 400 }
      );
    }

    // Circuit breaker: if this source has been failing, don't pile on
    const circuitError = checkCircuit(id);
    if (circuitError) {
      return NextResponse.json({ error: circuitError }, { status: 503 });
    }

    // Row-level satellite scoping (external/guest users). Wrap BEFORE the cache
    // key so users with different scopes never share a cached result; deny =
    // fail-closed (return no rows without executing).
    const scoped = await scopeConnectionQuery(
      { orgId, userId: userId ?? undefined, isApiKeyAuth: false },
      source,
      body.query,
      body.params,
    );
    if (scoped.deny) {
      // Row-level scope denied the whole query (no scope column / empty
      // allow-list) — tell the panel so it renders "restricted", not "no data".
      return NextResponse.json({ ...EMPTY_QUERY_RESULT, restricted: true });
    }
    const effectiveQuery = scoped.query;
    const effectiveParams = scoped.params;

    // Check short-TTL cache first (identical query from another user/panel)
    const cacheKey = queryCacheKey(id, effectiveQuery, effectiveParams);
    const cached = getCachedQuery<{
      columns: { name: string; type: string }[];
      rows: Record<string, unknown>[];
      rowCount: number;
      executionTimeMs: number;
      truncated: boolean;
    }>(cacheKey);

    if (cached) {
      return NextResponse.json(cached);
    }

    // Concurrency limit: max 3 concurrent queries per source
    const release = await acquireSlot(id);

    try {
      // Capture validated values before closure
      const credentialsEncrypted = source.credentials_encrypted;
      const sshCredentialsEncrypted = source.ssh_credentials_encrypted;

      // Singleflight: if an identical query is already in-flight, share it
      const result = await singleflight(cacheKey, async () => {
        const connectionString = decrypt(credentialsEncrypted);

        const sshTunnel = sshCredentialsEncrypted
          ? buildSSHTunnelConfig(
              (source.metadata || {}) as Record<string, unknown>,
              decrypt(sshCredentialsEncrypted)
            )
          : undefined;

        return executeQuery({
          type: source.connection_type as DataSourceType,
          connectionString,
          query: effectiveQuery,
          params: effectiveParams,
          limit: body.limit,
          timeout: body.timeout,
          sshTunnel,
          existingConfig: (source.config as Record<string, unknown>) ?? {},
        });
      });

      const responseData = {
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        executionTimeMs: result.executionTimeMs,
        truncated: result.truncated,
      };

      // Cache for 15s so the next user loading this dashboard gets instant results
      setCachedQuery(cacheKey, responseData);
      recordSuccess(id);

      // Lazy-migrate legacy URL credentials to JSON format (fire-and-forget)
      void maybeMigrateLegacySource(
        source.id,
        source.connection_type as DataSourceType,
        source.credentials_encrypted,
        (source.config as Record<string, unknown>) ?? {},
      );

      return NextResponse.json(responseData);
    } finally {
      release();
    }
  } catch (error) {
    // Access/validation errors carry their own status (403/404) — don't fold
    // them into the driver-error 500 path below.
    if (isApiError(error)) {
      return errorResponse(error);
    }

    console.error("Error executing query:", error, { query: submittedQuery });
    // Deliberate: this is the connection owner's authenticated SQL console, so the
    // driver error message (syntax, missing column) is surfaced to help them fix
    // their own query against their own DB. The PUBLIC shared-query endpoint does
    // NOT do this — it returns a generic message to avoid leaking to anonymous viewers.
    const message = error instanceof Error ? error.message : "Query execution failed";

    // Record failure for circuit breaker (extract source ID from URL)
    const urlParts = request.nextUrl.pathname.split("/");
    const sourceIdx = urlParts.indexOf("sources");
    if (sourceIdx >= 0 && urlParts[sourceIdx + 1]) {
      recordFailure(urlParts[sourceIdx + 1]);
    }

    // Include the executed SQL so the panel/editor can show WHAT failed —
    // same owner-authenticated-console rationale as surfacing the message.
    return NextResponse.json(
      { error: message, sql: submittedQuery },
      { status: 500 }
    );
  }
}
