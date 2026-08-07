/**
 * Sources API - List and Create
 *
 * GET /api/sources - List all sources with optional filters
 * POST /api/sources - Create a new source (device or connection)
 */

import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { CreateSourceSchema } from "@/lib/validation/api-schemas";
import { sourceQueries } from "@/lib/db";
import { adminSourceQueries } from "@/lib/db/server";
import { encrypt } from "@/lib/encryption";
import {
  testConnection,
  buildSSHTunnelConfig,
} from "@/lib/db/data-source-connections";
import { getDriver } from "@/lib/db/drivers/registry";
import type { DriverCredentials } from "@/lib/db/drivers/types";
import { emitSystemEvent } from "@/lib/events/emit";
import { apiError } from "@/lib/api/errors";
import { pushToService } from "@/lib/internal/push";
import {
  loadUserSourceGrants,
  loadPrivateSourceIds,
  loadAllowedSourceIds,
  canAccessSource,
} from "@/lib/access/sources";
import type {
  ConnectionType,
  DataSourceType,
  Json,
  Source,
} from "@/lib/db/types";

// =============================================================================
// Business Logic
// =============================================================================

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
// Discovered devices are fed by the discovery poll loop, not a live stream —
// give them a full hour before flipping offline.
const DISCOVERED_ONLINE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Enrich device sources with computed online/offline status
 * based on last_seen_at timestamp.
 */
function enrichDeviceStatus<
  T extends {
    source_type: string;
    last_seen_at: string | null;
    device_type?: string | null;
    metadata?: unknown;
  },
>(sources: T[]): T[] {
  const now = Date.now();
  return sources.map((source) => {
    if (source.source_type === "device") {
      // Satellites don't stream telemetry — always "online"
      if (source.device_type === "satellite") {
        return { ...source, status: "online" };
      }
      // Auto-discovered devices (rows sliced out of a connection table):
      // online iff the discovery loop has seen them within the last hour.
      const metadata =
        source.metadata &&
        typeof source.metadata === "object" &&
        !Array.isArray(source.metadata)
          ? (source.metadata as Record<string, unknown>)
          : null;
      if (metadata?.discovered_from) {
        const lastSeenMs = source.last_seen_at
          ? new Date(source.last_seen_at).getTime()
          : NaN;
        const isOnline =
          Number.isFinite(lastSeenMs) &&
          now - lastSeenMs < DISCOVERED_ONLINE_THRESHOLD_MS;
        return { ...source, status: isOnline ? "online" : "offline" };
      }
      if (source.last_seen_at) {
        const lastSeenMs = new Date(source.last_seen_at).getTime();
        const isOnline = now - lastSeenMs < ONLINE_THRESHOLD_MS;
        return { ...source, status: isOnline ? "online" : "offline" };
      }
    }
    return source;
  });
}

// =============================================================================
// Route Handlers
// =============================================================================

// GET /api/sources
export const GET = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth }) => {
    const url = new URL(request.url);
    const typeParam = url.searchParams.get("type");
    const statusParam = url.searchParams.get("status");
    const search = url.searchParams.get("search");
    const slug = url.searchParams.get("slug");

    let sources: Source[];
    let isList = false;
    if (slug) {
      // Direct slug lookup
      sources = await sourceQueries.findBySlug(orgId, slug);
    } else {
      isList = true;
      const type = typeParam
        ? (typeParam.split(",") as ("device" | "connection")[])
        : undefined;
      const status = statusParam
        ? (statusParam.split(",") as (
            | "online"
            | "offline"
            | "pending"
            | "error"
          )[])
        : undefined;
      sources = await sourceQueries.findAllFiltered(orgId, {
        type,
        status,
        search: search || undefined,
      });
    }

    // Per-user access filter (session callers only; API-key is org automation).
    // Filter BEFORE enriching so we don't compute status for hidden devices.
    if (!isApiKeyAuth && userId) {
      // Scoped (external/guest) users see ONLY their allow-listed sources —
      // applied unconditionally, even when the org has no private devices.
      const allowed = await loadAllowedSourceIds(orgId, userId);
      if (allowed) sources = sources.filter((s) => allowed.has(s.id));

      // Then the normal private-device grant filter (common case: no privates).
      const privateIds = await loadPrivateSourceIds(orgId);
      if (privateIds.size > 0) {
        const grants = await loadUserSourceGrants(orgId, userId, orgRole);
        sources = sources.filter((s) =>
          canAccessSource({
            orgRole,
            userId,
            source: s,
            isPrivate: privateIds.has(s.id),
            grants,
            need: "view",
          }),
        );
      }
    }

    if (isList) sources = enrichDeviceStatus(sources);

    return NextResponse.json({ sources });
  },
);

// POST /api/sources
export const POST = withDualAuth(
  async (request, { userId, orgId, orgRole, isApiKeyAuth }) => {
    const body = await validateBody(request, CreateSourceSchema);
    // Manifest-gated capability, by source kind (API-key callers bypass).
    if (!isApiKeyAuth) {
      await requirePermission(
        { orgId, orgRole, userId },
        body.source_type === "device"
          ? "action-pair-device"
          : "action-connect-data",
      );
    }
    const queries = isApiKeyAuth ? adminSourceQueries : sourceQueries;
    const {
      source_type,
      slug,
      name,
      description,
      device_type,
      connection_type,
      connectionString,
      connectionConfig: structuredConfig,
      credentials: structuredCredentials,
      config,
      metadata,
      sshTunnel,
      sshCredential,
    } = body;

    // Check if slug already exists
    const existing = await queries.findBySlug(orgId, slug);
    if (existing.length > 0) {
      throw apiError(
        "VALIDATION_ERROR",
        `Source with slug "${slug}" already exists`,
      );
    }

    // Handle connection-specific logic
    let credentials_encrypted: string | null = null;
    let ssh_credentials_encrypted: string | null = null;
    let testResult = null;
    let connectionConfig: Record<string, unknown> = config || {};
    let sourceMetadata: Record<string, unknown> = metadata || {};

    if (source_type === "device" && connectionConfig.recording !== false) {
      connectionConfig.recording = true;
    }

    if (source_type === "connection") {
      if (!connection_type) {
        throw apiError(
          "VALIDATION_ERROR",
          "connection_type is required for connection sources",
        );
      }

      // Resolve connection string from either input format
      let resolvedConnectionString: string;

      if (connectionString) {
        resolvedConnectionString = connectionString;
        // Best-effort: also populate config JSONB with non-sensitive parsed fields
        try {
          const driver = getDriver(connection_type as DataSourceType);
          const { config: parsedConfig } =
            driver.parseConnectionString(connectionString);
          connectionConfig = { ...connectionConfig, ...parsedConfig };
        } catch {
          // Don't fail creation if config extraction fails
        }
      } else if (structuredConfig && structuredCredentials) {
        const driver = getDriver(connection_type as DataSourceType);
        if (!driver.toConnectionString) {
          throw apiError(
            "VALIDATION_ERROR",
            `Structured input not supported for ${connection_type}`,
          );
        }
        resolvedConnectionString = driver.toConnectionString(
          structuredConfig,
          structuredCredentials as DriverCredentials,
        );
        connectionConfig = { ...connectionConfig, ...structuredConfig };
      } else {
        throw apiError(
          "VALIDATION_ERROR",
          "Either connectionString or (connectionConfig + credentials) is required for connection sources",
        );
      }

      // Encrypt credentials
      credentials_encrypted = encrypt(resolvedConnectionString);

      // Handle SSH tunnel config
      let sshTunnelConfig;
      if (sshTunnel?.enabled && sshCredential) {
        ssh_credentials_encrypted = encrypt(sshCredential);
        sourceMetadata = {
          ...sourceMetadata,
          ssh_tunnel: {
            enabled: true,
            host: sshTunnel.host,
            port: sshTunnel.port,
            username: sshTunnel.username,
            auth_method: sshTunnel.authMethod,
          },
        };
        sshTunnelConfig = buildSSHTunnelConfig(sourceMetadata, sshCredential);
      }

      // Test connection (with SSH tunnel if configured)
      testResult = await testConnection({
        type: connection_type as DataSourceType,
        connectionString: resolvedConnectionString,
        sshTunnel: sshTunnelConfig,
      });

      if (testResult.success && testResult.metadata) {
        connectionConfig = { ...connectionConfig, ...testResult.metadata };
      }
    }

    // Create the source
    const sources = await queries.insert(orgId, {
      source_type,
      slug,
      name: name || null,
      description: description || null,
      status:
        source_type === "connection"
          ? testResult?.success
            ? "online"
            : "error"
          : device_type === "satellite"
            ? "online"
            : "pending",
      device_type: device_type || null,
      connection_type: (connection_type || null) as ConnectionType | null,
      credentials_encrypted,
      ssh_credentials_encrypted,
      config: connectionConfig as Json & Record<string, unknown>,
      metadata: sourceMetadata as Json & Record<string, unknown>,
      last_error: testResult && !testResult.success ? testResult.error : null,
      last_connected_at: testResult?.success ? new Date().toISOString() : null,
      created_by: userId ?? null,
    });

    if (sources.length === 0) {
      throw apiError("DATABASE_ERROR", "Failed to create source");
    }

    const createdSource = sources[0];

    let loaderPush: Awaited<ReturnType<typeof pushToService>> | null = null;
    if (createdSource.source_type === "device") {
      const recording =
        (createdSource.config as Record<string, unknown> | null)?.recording !==
        false;
      loaderPush = await pushToService(
        process.env.PLEXUS_LOADER_URL,
        process.env.PLEXUS_INTERNAL_SECRET,
        "/recording",
        {
          org_id: orgId,
          source_id: createdSource.slug,
          recording,
        },
        "loader-recording",
      );
    }

    emitSystemEvent({
      orgId,
      eventType:
        createdSource.source_type === "device"
          ? "device.created"
          : "connection.created",
      category: createdSource.source_type === "device" ? "device" : "source",
      title: `${createdSource.source_type === "device" ? "Device" : "Connection"} ${createdSource.name || createdSource.slug} created`,
      severity: "success",
      sourceId: createdSource.id,
      sourceName: createdSource.name || createdSource.slug,
      sourceSlug: createdSource.slug,
      actorId: userId,
    });

    const response: Record<string, unknown> = { source: createdSource };
    if (testResult) {
      response.testResult = testResult;
    }
    if (loaderPush) {
      response.loaderPush = loaderPush;
    }

    return NextResponse.json(response, { status: 201 });
  },
);
