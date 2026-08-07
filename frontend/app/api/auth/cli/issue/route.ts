/**
 * POST /api/auth/cli/issue
 *
 * Creates a fresh API key for the current org and returns the plaintext
 * value exactly once. Used by the `/auth/cli` page after the user
 * authorizes a CLI flow (`plexus init`-style).
 *
 * Request body:
 *   {
 *     name?:     string   // optional label, defaults to "cli-<random>"
 *     scopes?:   string[] // defaults to ["read", "write"]
 *   }
 *
 * Response:
 *   { key: "plx_...", prefix: "plx_xxxx", id: "uuid" }
 *
 * Security:
 *   - Requires an authenticated session.
 *   - The plaintext key is returned ONCE; the redirect to a localhost
 *     callback (which the /auth/cli page does) keeps the key on the
 *     user's machine.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { apiKeyQueries } from "@/lib/db";
import { generateApiKey } from "@/lib/api-keys";
import { emitSystemEvent } from "@/lib/events/emit";

function randomSuffix(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const POST = withAuth(async (request, { userId, orgId }) => {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    scopes?: string[];
  };

  const name =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim().slice(0, 64)
      : `cli-${randomSuffix()}`;

  const scopes =
    Array.isArray(body.scopes) && body.scopes.length > 0
      ? body.scopes.filter((s) => typeof s === "string").slice(0, 8)
      : ["read", "write"];

  const { key, prefix, hash } = generateApiKey();

  const inserted = await apiKeyQueries.insert(orgId, {
    name,
    key_prefix: prefix,
    key_hash: hash,
    scopes,
    expires_at: null,
  });

  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  const id = (row as { id?: string } | undefined)?.id;

  emitSystemEvent({
    orgId,
    eventType: "api_key.created",
    category: "api_key",
    title: `CLI key issued: ${name}`,
    severity: "info",
    actorId: userId,
    metadata: { source: "cli", name, scopes },
  });

  return NextResponse.json({
    key,
    prefix,
    id,
    name,
    scopes,
  });
});
