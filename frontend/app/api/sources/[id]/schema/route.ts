/**
 * Source Schema API - Get database schema
 *
 * GET /api/sources/[id]/schema - Get schema for connection sources
 *
 * Schema results are cached server-side for 5 minutes to avoid
 * hammering customer databases. Schema rarely changes — panels,
 * dashboards, and data explorers all call this on mount.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { enforceSource } from "@/lib/access/sources";
import { isApiError, errorResponse } from "@/lib/api/errors";
import { decrypt } from "@/lib/encryption";
import {
  getSchema,
  buildSSHTunnelConfig,
  maybeMigrateLegacySource,
} from "@/lib/db/data-source-connections";
import { singleflight, checkCircuit, recordSuccess, recordFailure } from "@/lib/db/query-cache";
import type { DataSourceType } from "@/lib/db/types";

// =============================================================================
// Server-side schema cache (5 min TTL)
// =============================================================================

interface SchemaCacheEntry {
  schema: { tables: Array<{ name: string; schema?: string; columns: Array<{ name: string; type: string; nullable?: boolean; isPrimaryKey?: boolean; foreignKey?: { table: string; column: string } | null }> }> };
  cachedAt: number;
}

const schemaCache = new Map<string, SchemaCacheEntry>();
const SCHEMA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedSchema(sourceId: string): SchemaCacheEntry["schema"] | null {
  const entry = schemaCache.get(sourceId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > SCHEMA_CACHE_TTL) {
    schemaCache.delete(sourceId);
    return null;
  }
  return entry.schema;
}

function setCachedSchema(sourceId: string, schema: SchemaCacheEntry["schema"]) {
  schemaCache.set(sourceId, { schema, cachedAt: Date.now() });
}

// GET /api/sources/[id]/schema
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId, userId, orgRole } = await getAuth();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Find the source
    const source = await findSourceByIdOrSlug(orgId, id);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    // Per-source grant check — org membership alone is not enough when the
    // source is named by an access rule.
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

    // Only connection sources have schema
    if (source.source_type !== "connection") {
      return NextResponse.json(
        { error: "Only connection sources have schema" },
        { status: 400 }
      );
    }

    // Must be connected to get schema
    if (source.status !== "online") {
      return NextResponse.json(
        { error: "Source must be connected to get schema. Test connection first." },
        { status: 400 }
      );
    }

    if (!source.credentials_encrypted || !source.connection_type) {
      return NextResponse.json(
        { error: "Source is missing connection credentials" },
        { status: 400 }
      );
    }

    // Circuit breaker: if this source has been failing, don't pile on
    const circuitError = checkCircuit(id);
    if (circuitError) {
      return NextResponse.json({ error: circuitError }, { status: 503 });
    }

    // Check server-side cache first (bypass with ?refresh=true)
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";
    let schema = forceRefresh ? null : getCachedSchema(id);

    if (!schema) {
      // Capture validated values before closure
      const credentialsEncrypted = source.credentials_encrypted;
      const sshCredentialsEncrypted = source.ssh_credentials_encrypted;

      // Singleflight: if another request for this schema is already in-flight, share it
      schema = await singleflight(`schema:${id}`, async () => {
        const connectionString = decrypt(credentialsEncrypted);

        const sshTunnel = sshCredentialsEncrypted
          ? buildSSHTunnelConfig(
              (source.metadata || {}) as Record<string, unknown>,
              decrypt(sshCredentialsEncrypted)
            )
          : undefined;

        return getSchema({
          type: source.connection_type as DataSourceType,
          connectionString,
          sshTunnel,
          existingConfig: (source.config as Record<string, unknown>) ?? {},
        });
      });

      // Cache for subsequent requests (5 min)
      setCachedSchema(id, schema);
      recordSuccess(id);

      // Lazy-migrate legacy URL credentials to JSON format (fire-and-forget)
      void maybeMigrateLegacySource(
        source.id,
        source.connection_type as DataSourceType,
        source.credentials_encrypted,
        (source.config as Record<string, unknown>) ?? {},
      );
    }

    // Check if we should filter by selected tables
    // Use ?all=true to bypass filtering (for initial setup)
    const showAll = request.nextUrl.searchParams.get("all") === "true";
    const selectedTables = (source.config as Record<string, unknown>)?.selectedTables as string[] | undefined;

    // Filter tables if selectedTables is configured and not requesting all
    if (!showAll && selectedTables && selectedTables.length > 0) {
      const selectedSet = new Set(selectedTables);
      const filtered = schema.tables.filter((table) => {
        const fullName = table.schema ? `${table.schema}.${table.name}` : table.name;
        return selectedSet.has(fullName);
      });
      // Only apply filter if it matches at least one table;
      // otherwise the saved selection is stale — show all tables
      if (filtered.length > 0) {
        schema.tables = filtered;
      }
    }

    return NextResponse.json(
      { schema },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (error) {
    if (isApiError(error)) {
      return errorResponse(error);
    }
    console.error("Error getting source schema:", error);
    // Record failure for circuit breaker
    const urlParts = request.nextUrl.pathname.split("/");
    const sourceIdx = urlParts.indexOf("sources");
    if (sourceIdx >= 0 && urlParts[sourceIdx + 1]) {
      recordFailure(urlParts[sourceIdx + 1]);
    }
    return NextResponse.json(
      { error: "Failed to get source schema" },
      { status: 500 }
    );
  }
}
