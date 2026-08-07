/**
 * Source Test API - Test connection
 *
 * POST /api/sources/[id]/test - Test connection (connections only)
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { findSourceByIdOrSlug } from "@/lib/api/find-source";
import { sourceQueries } from "@/lib/db";
import { enforceSource } from "@/lib/access/sources";
import { isApiError, errorResponse } from "@/lib/api/errors";
import { decrypt } from "@/lib/encryption";
import {
  testConnection,
  buildSSHTunnelConfig,
  maybeMigrateLegacySource,
} from "@/lib/db/data-source-connections";
import type { DataSourceType } from "@/lib/db/types";

interface TestBody {
  connectionConfig?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

// POST /api/sources/[id]/test
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

    // Testing updates source status/config — require edit on the source.
    await enforceSource(
      {
        orgId,
        userId: userId ?? undefined,
        orgRole: orgRole ?? undefined,
        isApiKeyAuth: false,
      },
      source,
      "edit",
    );

    // Only connection sources can be tested
    if (source.source_type !== "connection") {
      return NextResponse.json(
        { error: "Only connection sources can be tested" },
        { status: 400 },
      );
    }

    if (!source.credentials_encrypted || !source.connection_type) {
      return NextResponse.json(
        { error: "Source is missing connection credentials" },
        { status: 400 },
      );
    }

    // Build SSH tunnel config if present
    const sshTunnel = source.ssh_credentials_encrypted
      ? buildSSHTunnelConfig(
          (source.metadata || {}) as Record<string, unknown>,
          decrypt(source.ssh_credentials_encrypted)
        )
      : undefined;

    // If caller provided override values, test with those (pre-save validation)
    let body: TestBody = {};
    try {
      const raw = await request.text();
      if (raw) body = JSON.parse(raw);
    } catch { /* no body is fine */ }

    let connectionString: string;
    let existingConfig: Record<string, unknown>;

    if (body.connectionConfig !== undefined || body.credentials !== undefined) {
      // Test with caller-supplied values (modal pre-save flow)
      existingConfig = {
        ...(source.config as Record<string, unknown>),
        ...(body.connectionConfig || {}),
      };
      const creds = body.credentials && Object.keys(body.credentials).length > 0
        ? body.credentials
        : JSON.parse(decrypt(source.credentials_encrypted));
      connectionString = JSON.stringify(creds);
    } else {
      // Normal test with stored credentials
      connectionString = decrypt(source.credentials_encrypted);
      existingConfig = (source.config as Record<string, unknown>) ?? {};
    }

    const result = await testConnection({
      type: source.connection_type as DataSourceType,
      connectionString,
      sshTunnel,
      existingConfig,
    });

    // Lazy-migrate legacy URL credentials to JSON format (fire-and-forget)
    if (result.success) {
      void maybeMigrateLegacySource(
        source.id,
        source.connection_type as DataSourceType,
        source.credentials_encrypted,
        (source.config as Record<string, unknown>) ?? {},
      );
    }

    // Update source status and config
    if (result.success) {
      await sourceQueries.updateLastConnected(
        orgId,
        source.id,
        result.metadata || undefined,
      );
    } else {
      await sourceQueries.updateStatus(orgId, source.id, "error", result.error);
    }

    return NextResponse.json({
      success: result.success,
      error: result.error,
      metadata: result.metadata,
    });
  } catch (error) {
    if (isApiError(error)) {
      return errorResponse(error);
    }
    console.error("Error testing source:", error);
    return NextResponse.json(
      { error: "Failed to test source connection" },
      { status: 500 },
    );
  }
}
