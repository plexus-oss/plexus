import { NextResponse } from "next/server";
import { withAuth, withRoleAuth } from "@/lib/api/with-auth";
import { apiKeyQueries } from "@/lib/db";
import { emitSystemEvent } from "@/lib/events/emit";

/**
 * GET /api/api-keys/[id] - Get a single API key
 */
export const GET = withAuth(async (_request, { orgId, params }) => {
  const { id } = await params;
  const result = await apiKeyQueries.findById(orgId, id);
  const key = result[0];

  if (!key) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  // Don't expose the hash, transform to camelCase for API response
  return NextResponse.json({
    key: {
      id: key.id,
      name: key.name,
      keyPrefix: key.key_prefix,
      scopes: key.scopes,
      lastUsedAt: key.last_used_at,
      expiresAt: key.expires_at,
      createdAt: key.created_at,
    },
  });
});

/**
 * DELETE /api/api-keys/[id] - Permanently delete an API key (admin-only)
 */
export const DELETE = withRoleAuth(["org:admin"], async (_request, { userId, orgId, params }) => {
  const { id } = await params;
  await apiKeyQueries.delete(orgId, id);

  emitSystemEvent({
    orgId,
    eventType: "api_key.revoked",
    category: "api_key",
    title: "API key revoked",
    severity: "warning",
    entityId: id,
    entityType: "api_key",
    actorId: userId,
  });

  return NextResponse.json({ message: "API key deleted" });
});
