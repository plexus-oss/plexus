/**
 * Device API - Get device info and status
 *
 * GET /api/devices/[id] - Get device details
 *
 * Every connected device is an API endpoint. This is the root
 * endpoint for querying a device's current state.
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { findSourceByRef } from "@/lib/api/find-source";
import { enforceSource } from "@/lib/access/sources";

export const GET = withDualAuth(
  async (_request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id } = await params;

  const source = await findSourceByRef(orgId, id, isApiKeyAuth);
  if (!source) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  await enforceSource({ orgId, userId, orgRole, isApiKeyAuth }, source, "view");

  // Compute live status
  const now = Date.now();
  const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;
  const lastSeenMs = source.last_seen_at
    ? new Date(source.last_seen_at).getTime()
    : 0;
  const isOnline = lastSeenMs > 0 && now - lastSeenMs < ONLINE_THRESHOLD_MS;
  const uptimeMs = isOnline ? now - lastSeenMs : 0;

  return NextResponse.json({
    device: {
      id: source.id,
      slug: source.slug,
      name: source.name,
      type: source.source_type,
      status: isOnline ? "online" : "offline",
      last_seen: source.last_seen_at,
      uptime_ms: uptimeMs,
      metadata: source.metadata,
      created_at: source.created_at,
    },
  });
});
