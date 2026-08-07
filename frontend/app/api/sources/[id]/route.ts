/**
 * Source API - Get, Update, Delete
 *
 * GET /api/sources/[id] - Get source by ID or slug
 * PATCH /api/sources/[id] - Update source
 * DELETE /api/sources/[id] - Delete source
 */

import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { findSourceByRef } from "@/lib/api/find-source";
import { sourceQueries, sourceAssociationQueries } from "@/lib/db";
import { adminSourceQueries } from "@/lib/db/server";
import { emitSystemEvent } from "@/lib/events/emit";
import { pushToService } from "@/lib/internal/push";
import { encrypt, decrypt } from "@/lib/encryption";
import { getDriver } from "@/lib/db/drivers/registry";
import { testConnection, buildSSHTunnelConfig } from "@/lib/db/data-source-connections";
import { enforceSource } from "@/lib/access/sources";
import type { DataSourceType } from "@/lib/db/types";

// GET /api/sources/[id]
export const GET = withDualAuth(
  async (_request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id } = await params;
  const source = await findSourceByRef(orgId, id, isApiKeyAuth);

  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await enforceSource(
    { orgId, userId, orgRole, isApiKeyAuth },
    source,
    "view",
  );

  // Compute live status for devices
  if (source.source_type === "device" && source.last_seen_at) {
    const now = Date.now();
    const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;
    const lastSeenMs = new Date(source.last_seen_at).getTime();
    const isOnline = now - lastSeenMs < ONLINE_THRESHOLD_MS;
    return NextResponse.json({
      source: { ...source, status: isOnline ? "online" : "offline" },
    });
  }

  return NextResponse.json({ source });
});

// PATCH /api/sources/[id]
export const PATCH = withDualAuth(
  async (request, { userId, orgId, orgRole, isApiKeyAuth, params }) => {
    const { id } = await params;
    const body = await request.json();

    const source = await findSourceByRef(orgId, id, isApiKeyAuth);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    await enforceSource(
      { orgId, userId, orgRole, isApiKeyAuth },
      source,
      "edit",
    );

    const allowedFields = [
      "name",
      "description",
      "device_type",
      "config",
      "metadata",
    ];
    const updateData: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (body.config && typeof body.config === "object") {
      updateData.config = {
        ...(source.config as Record<string, unknown>),
        ...body.config,
      };
    }

    if (body.metadata && typeof body.metadata === "object") {
      updateData.metadata = {
        ...(source.metadata as Record<string, unknown>),
        ...body.metadata,
      };
    }

    // Handle connection config + credential update
    if (
      source.source_type === "connection" &&
      source.connection_type &&
      source.credentials_encrypted &&
      (body.connectionConfig !== undefined || body.credentials !== undefined)
    ) {
      const newConfig = {
        ...(source.config as Record<string, unknown>),
        ...(body.connectionConfig || {}),
      };

      // Determine which credentials to use
      let credsJson: string;
      if (body.credentials && Object.keys(body.credentials).length > 0) {
        credsJson = JSON.stringify(body.credentials);
      } else {
        // Keep existing — normalize to JSON format
        const raw = decrypt(source.credentials_encrypted);
        if (raw.trimStart().startsWith("{")) {
          credsJson = raw;
        } else {
          const driver = getDriver(source.connection_type as DataSourceType);
          const { creds } = driver.parseConnectionString(raw);
          credsJson = JSON.stringify(creds);
        }
      }

      const sshTunnel = source.ssh_credentials_encrypted
        ? buildSSHTunnelConfig(
            (source.metadata || {}) as Record<string, unknown>,
            decrypt(source.ssh_credentials_encrypted),
          )
        : undefined;

      const testResult = await testConnection({
        type: source.connection_type as DataSourceType,
        connectionString: credsJson,
        sshTunnel,
        existingConfig: newConfig,
      });

      if (!testResult.success) {
        return NextResponse.json(
          { error: testResult.error || "Connection test failed with new settings" },
          { status: 400 },
        );
      }

      updateData.credentials_encrypted = encrypt(credsJson);
      updateData.config = { ...newConfig, ...(testResult.metadata || {}) };
      updateData.status = "online";
      updateData.last_connected_at = new Date().toISOString();
      updateData.last_error = null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ source });
    }

    const updated = isApiKeyAuth
      ? await adminSourceQueries.update(source.id, updateData)
      : await sourceQueries.update(orgId, source.id, updateData);

    if (updated.length === 0) {
      return NextResponse.json(
        { error: "Failed to update source" },
        { status: 500 },
      );
    }

    emitSystemEvent({
      orgId,
      eventType: "source.updated",
      category: "source",
      title: `${source.source_type === "device" ? "Device" : "Connection"} ${source.name || source.slug} updated`,
      sourceId: source.id,
      sourceName: source.name || source.slug,
      sourceSlug: source.slug,
      actorId: userId,
      metadata: { updatedFields: Object.keys(updateData) },
    });

    let loaderPush: Awaited<ReturnType<typeof pushToService>> | null = null;
    if (body.config?.recording !== undefined) {
      loaderPush = await pushToService(
        process.env.PLEXUS_LOADER_URL,
        process.env.PLEXUS_INTERNAL_SECRET,
        "/recording",
        { org_id: source.org_id, source_id: source.slug, recording: body.config.recording === true },
        "loader-recording",
      );
    }

    const response: Record<string, unknown> = { source: updated[0] };
    if (loaderPush) {
      response.loaderPush = loaderPush;
    }
    return NextResponse.json(response);
  },
);

// DELETE /api/sources/[id]
export const DELETE = withDualAuth(
  async (_request, { userId, orgId, orgRole, isApiKeyAuth, params }) => {
    const { id } = await params;

    const source = await findSourceByRef(orgId, id, isApiKeyAuth);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    await enforceSource(
      { orgId, userId, orgRole, isApiKeyAuth },
      source,
      "edit",
    );

    // Delete is capability-gated (Role Matrix). Creators keep their bypass —
    // resource grants confer view/edit, not delete.
    if (!isApiKeyAuth && source.created_by !== userId) {
      await requirePermission(
        { orgId, orgRole, userId },
        source.source_type === "device"
          ? "action-delete-device"
          : "action-delete-connection",
      );
    }

    // Discovery associations have no FK on entity_id (only connection_id
    // cascades) — clean them up so entity deletion can't orphan rows.
    await sourceAssociationQueries
      .deleteByEntity(orgId, source.id)
      .catch(() => {});

    if (isApiKeyAuth) {
      await adminSourceQueries.delete(source.id);
    } else {
      await sourceQueries.delete(orgId, source.id);
    }

    emitSystemEvent({
      orgId,
      eventType:
        source.source_type === "device"
          ? "device.deleted"
          : "connection.deleted",
      category: source.source_type === "device" ? "device" : "source",
      title: `${source.source_type === "device" ? "Device" : "Connection"} ${source.name || source.slug} deleted`,
      severity: "warning",
      sourceId: source.id,
      sourceName: source.name || source.slug,
      sourceSlug: source.slug,
      actorId: userId,
    });

    return NextResponse.json({ success: true });
  },
);
