/**
 * Device Status API - Get device online status, uptime, and health
 *
 * GET /api/devices/[id]/status
 *
 * Returns connection state, uptime, error counts, and buffer status.
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { findSourceByRef } from "@/lib/api/find-source";
import { queryTelemetry } from "@/lib/db/clickhouse";
import { enforceSource } from "@/lib/access/sources";

export const GET = withDualAuth(
  async (_request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id } = await params;

  const source = await findSourceByRef(orgId, id, isApiKeyAuth);
  if (!source) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  await enforceSource({ orgId, userId, orgRole, isApiKeyAuth }, source, "view");

  const sourceId = source.slug || source.id;

  // Compute online status
  const now = Date.now();
  const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;
  const lastSeenMs = source.last_seen_at
    ? new Date(source.last_seen_at).getTime()
    : 0;
  const isOnline = lastSeenMs > 0 && now - lastSeenMs < ONLINE_THRESHOLD_MS;

  // Get recent data point count (last 1 minute) for throughput
  let recentPointCount = 0;
  try {
    const oneMinAgo = new Date(now - 60_000);
    const results = await queryTelemetry({
      orgId,
      sourceId,
      startTime: oneMinAgo,
      endTime: new Date(),
      limit: 10000,
    });
    recentPointCount = results?.length ?? 0;
  } catch {
    // Non-critical
  }

  const meta = (source.metadata ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    device_id: sourceId,
    name: source.name,
    status: isOnline ? "online" : "offline",
    last_seen: source.last_seen_at,
    uptime_ms: isOnline ? now - lastSeenMs : 0,
    points_per_min: recentPointCount,
    sensors: ((meta.sensors as unknown[]) ?? []).length,
    cameras: ((meta.cameras as unknown[]) ?? []).length,
    commands: ((meta.commands as unknown[]) ?? []).length,
    platform: (meta.platform as string) ?? null,
    firmware_version: (meta.firmware_version as string) ?? null,
  });
});
