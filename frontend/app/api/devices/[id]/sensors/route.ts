/**
 * Device Sensors API - Get detected hardware
 *
 * GET /api/devices/[id]/sensors - List all sensors, cameras, and adapters
 *
 * Returns the hardware capabilities reported by the device
 * during its last WebSocket auth handshake.
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

  const meta = (source.metadata ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    device_id: source.slug || source.id,
    sensors: (meta.sensors as unknown[]) ?? [],
    cameras: (meta.cameras as unknown[]) ?? [],
    can: (meta.can as unknown[]) ?? [],
    platform: (meta.platform as string) ?? null,
  });
});
