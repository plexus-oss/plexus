import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { oauthQueries } from "@/lib/db/queries/oauth";
import { matchesMcpResource, MCP_RESOURCE_URL } from "@/lib/oauth/http";

// S256 code_challenge is BASE64URL(SHA256(...)) = 43 chars; accept the RFC
// 7636 unreserved charset within sane bounds.
const CODE_CHALLENGE_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * POST /api/oauth/authorize — the consent page's approve action.
 *
 * Session + role gated (same admin/editor bar as manual key minting and
 * claim approval). Re-validates everything the page validated — the page is
 * UX, this is the boundary — then issues a single-use authorization code
 * bound to the caller's active org.
 */
export const POST = withRoleAuth(["org:admin", "org:editor"], async (request, ctx) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "INVALID_REQUEST", message: "Body must be JSON" },
      { status: 400 },
    );
  }

  const { client_id, redirect_uri, code_challenge, state, scope, resource } = body as {
    client_id?: string;
    redirect_uri?: string;
    code_challenge?: string;
    state?: string;
    scope?: string;
    resource?: string;
  };

  if (!client_id || !redirect_uri || !code_challenge) {
    return NextResponse.json(
      {
        error: "INVALID_REQUEST",
        message: "client_id, redirect_uri, and code_challenge are required",
      },
      { status: 400 },
    );
  }

  const client = await oauthQueries.findClient(client_id);
  if (!client || !client.redirect_uris.includes(redirect_uri)) {
    return NextResponse.json(
      { error: "INVALID_CLIENT", message: "Unknown client or redirect_uri" },
      { status: 400 },
    );
  }
  if (!CODE_CHALLENGE_RE.test(code_challenge)) {
    return NextResponse.json(
      { error: "INVALID_REQUEST", message: "Malformed code_challenge" },
      { status: 400 },
    );
  }
  if (resource !== undefined && !matchesMcpResource(resource)) {
    return NextResponse.json(
      { error: "INVALID_TARGET", message: "Unknown resource" },
      { status: 400 },
    );
  }

  const row = await oauthQueries.createAuthorizationCode({
    clientId: client.id,
    orgId: ctx.orgId,
    userId: ctx.userId,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    scope: typeof scope === "string" ? scope : null,
    resource: resource ?? MCP_RESOURCE_URL,
  });

  const url = new URL(redirect_uri);
  url.searchParams.set("code", row.code);
  if (typeof state === "string" && state) url.searchParams.set("state", state);

  return NextResponse.json({ redirect_url: url.toString() });
});
