import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { CreateApiKeySchema } from "@/lib/validation/api-schemas";
import { apiKeyQueries } from "@/lib/db";
import { adminApiKeyQueries } from "@/lib/db/server";
import { generateApiKey } from "@/lib/api-keys";
import { emitSystemEvent } from "@/lib/events/emit";
import { computeAccessEnabled } from "@/lib/billing/server";

/**
 * GET /api/api-keys - List all API keys for the organization
 */
export const GET = withRoleAuth(
  ["org:admin", "org:editor"],
  async (_request, { orgId }) => {
    const keys = await apiKeyQueries.findAll(orgId);

    // Don't expose the hash, transform to camelCase for API response
    const safeKeys = keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.key_prefix,
      scopes: k.scopes,
      lastUsedAt: k.last_used_at,
      expiresAt: k.expires_at,
      createdAt: k.created_at,
    }));

    return NextResponse.json({ keys: safeKeys });
  },
);

/**
 * POST /api/api-keys - Create a new API key
 */
export const POST = withRoleAuth(
  ["org:admin", "org:editor"],
  async (request, { userId, orgId }) => {
    const { name, scopes, expires_at } = await validateBody(
      request,
      CreateApiKeySchema,
    );

    // Generate the API key
    const { key, prefix, hash } = generateApiKey();

    const access_enabled = await computeAccessEnabled(orgId);

    // Insert the key record
    const result = await adminApiKeyQueries.insert(orgId, {
      name,
      key_prefix: prefix,
      key_hash: hash,
      scopes: scopes || ["write"],
      expires_at: expires_at ? new Date(expires_at).toISOString() : null,
      access_enabled,
    });

    const keyRecord = result[0];

    emitSystemEvent({
      orgId,
      eventType: "api_key.created",
      category: "api_key",
      title: `API key "${name}" created`,
      severity: "success",
      entityId: keyRecord.id,
      entityType: "api_key",
      actorId: userId,
    });

    return NextResponse.json(
      {
        key: {
          id: keyRecord.id,
          name: keyRecord.name,
          keyPrefix: keyRecord.key_prefix,
          scopes: keyRecord.scopes,
          createdAt: keyRecord.created_at,
          expiresAt: keyRecord.expires_at,
          // IMPORTANT: This is the only time the full key is returned
          secret: key,
        },
        message:
          "API key created. Save the secret - it cannot be retrieved again.",
      },
      { status: 201 },
    );
  },
);
