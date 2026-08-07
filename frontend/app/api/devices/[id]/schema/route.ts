/**
 * Device Schema API - Get discovered metric schemas for a device
 *
 * GET /api/devices/[id]/schema - Returns all captured metric schemas
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { findSourceByRef } from "@/lib/api/find-source";
import { deviceSchemaQueries } from "@/lib/db";
import { enforceSource } from "@/lib/access/sources";

export const GET = withDualAuth(
  async (_request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id } = await params;

  // Resolve id to slug
  const source = await findSourceByRef(orgId, id, isApiKeyAuth);
  if (!source) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  await enforceSource({ orgId, userId, orgRole, isApiKeyAuth }, source, "view");

  const schemas = await deviceSchemaQueries.findBySource(orgId, source.slug);

  return NextResponse.json({ schemas });
});
