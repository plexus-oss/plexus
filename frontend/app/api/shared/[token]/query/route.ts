/**
 * Shared Connection Query API - Execute read-only queries against connection
 * sources for an anonymously-viewed shared dashboard.
 *
 * POST /api/shared/[token]/query
 *
 * Body: { panelId, password? }
 *
 * Unlike /api/sources/[id]/query, this endpoint does NOT accept a client-
 * supplied SQL string. The viewer identifies a panel by id; the server loads
 * the dashboard config, pulls the panel's own `dataSource.query` + `sourceId`,
 * applies the dashboard's configured time range, and executes. Viewers cannot
 * inject arbitrary SQL or influence query construction beyond choosing which
 * panel to fetch.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { adminDashboardShareQueries } from "@/lib/db/server";
import { findSourceByRef } from "@/lib/api/find-source";
import { decrypt } from "@/lib/encryption";
import {
  executeQuery,
  buildSSHTunnelConfig,
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
import {
  substituteVariables,
  injectConditions,
} from "@/lib/transforms/connection-query";
import type { DataSourceType } from "@/lib/db/types";
import type { DashboardConfig, Panel } from "@/lib/types/dashboard";
import { isConnectionSource } from "@/lib/types/dashboard";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

interface QueryRequestBody {
  panelId: string;
  password?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    // Anonymous, DB-touching endpoint — limit per viewer (IP) per share token
    const rate = checkRateLimit(
      `shared-query:${token}:${getClientIp(request)}`,
      60,
      60_000,
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } },
      );
    }

    const body: QueryRequestBody = await request.json();

    if (!body.panelId || typeof body.panelId !== "string") {
      return NextResponse.json(
        { error: "panelId is required" },
        { status: 400 },
      );
    }

    const shareLink = await adminDashboardShareQueries.findByToken(token);
    if (!shareLink) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 },
      );
    }
    if (shareLink.status !== "active") {
      return NextResponse.json(
        { error: "This share link has been revoked" },
        { status: 403 },
      );
    }
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "This share link has expired" },
        { status: 403 },
      );
    }
    if (
      shareLink.max_views !== null &&
      shareLink.view_count >= shareLink.max_views
    ) {
      return NextResponse.json(
        { error: "This share link has reached its maximum view limit" },
        { status: 403 },
      );
    }
    if (shareLink.password_hash) {
      if (!body.password) {
        return NextResponse.json(
          { error: "Password required", requiresPassword: true },
          { status: 401 },
        );
      }
      if (hashPassword(body.password) !== shareLink.password_hash) {
        return NextResponse.json(
          { error: "Incorrect password" },
          { status: 401 },
        );
      }
    }

    // Load dashboard for this share link and locate the panel
    const dashboard =
      await adminDashboardShareQueries.getDashboardForShareLink(shareLink);
    if (!dashboard) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }

    const config = dashboard.config as unknown as DashboardConfig;
    const panel: Panel | undefined = config.panels.find(
      (p) => p.id === body.panelId,
    );
    if (!panel) {
      return NextResponse.json({ error: "Panel not found" }, { status: 404 });
    }
    if (!isConnectionSource(panel.dataSource)) {
      return NextResponse.json(
        { error: "Panel does not use a connection data source" },
        { status: 400 },
      );
    }

    const orgId = shareLink.org_id;
    const panelSourceId = panel.dataSource.sourceId;
    const rawQuery = panel.dataSource.query;

    // Load the source, scoped to the share link's org. Token auth has no user
    // session, so resolve via the admin client (isApiKeyAuth: true dispatch).
    const source = await findSourceByRef(orgId, panelSourceId, true);

    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    if (source.source_type !== "connection") {
      return NextResponse.json(
        { error: "Only connection sources can be queried" },
        { status: 400 },
      );
    }
    if (!source.credentials_encrypted || !source.connection_type) {
      return NextResponse.json(
        { error: "Source is missing connection credentials" },
        { status: 400 },
      );
    }
    if (source.status !== "online") {
      return NextResponse.json(
        { error: "Connection is not online." },
        { status: 400 },
      );
    }

    // Apply server-side query injection using the dashboard's own configured
    // time range. Client input does not influence the SQL.
    const timeRange = config.timeRange;
    const timeColumn = panel.dataSource.timeColumn || "timestamp";

    const { sql: afterVars, hadTimeMacro } = substituteVariables(
      rawQuery,
      {},
      timeRange,
    );
    const effectiveTimeRange = hadTimeMacro ? undefined : timeRange;
    const injected = effectiveTimeRange
      ? injectConditions(afterVars, {
          timeRange: effectiveTimeRange,
          timeColumn,
        })
      : { sql: afterVars, params: [] as unknown[] };

    const finalQuery = injected.sql;
    const finalParams =
      injected.params.length > 0
        ? { __filterParams: injected.params }
        : undefined;

    const circuitError = checkCircuit(source.id);
    if (circuitError) {
      return NextResponse.json({ error: circuitError }, { status: 503 });
    }

    const cacheKey = queryCacheKey(source.id, finalQuery, finalParams);
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

    const release = await acquireSlot(source.id);
    try {
      const credentialsEncrypted = source.credentials_encrypted;
      const sshCredentialsEncrypted = source.ssh_credentials_encrypted;

      const result = await singleflight(cacheKey, async () => {
        const connectionString = decrypt(credentialsEncrypted);
        const sshTunnel = sshCredentialsEncrypted
          ? buildSSHTunnelConfig(
              (source.metadata || {}) as Record<string, unknown>,
              decrypt(sshCredentialsEncrypted),
            )
          : undefined;

        return executeQuery({
          type: source.connection_type as DataSourceType,
          connectionString,
          query: finalQuery,
          params: finalParams,
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

      setCachedQuery(cacheKey, responseData);
      recordSuccess(source.id);

      return NextResponse.json(responseData);
    } catch (err) {
      recordFailure(source.id);
      throw err;
    } finally {
      release();
    }
  } catch (error) {
    // This endpoint is PUBLIC (anonymous share viewers) — never leak raw driver
    // error messages (table names, SQL, host info) to the client. Log server-side,
    // return a generic message. The viewer can't edit the query anyway.
    console.error("Shared query execution error:", error);
    return NextResponse.json(
      { error: "Query execution failed" },
      { status: 500 },
    );
  }
}
