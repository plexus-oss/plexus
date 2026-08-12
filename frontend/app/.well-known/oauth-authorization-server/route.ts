import { NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflight, OAUTH_ISSUER } from "@/lib/oauth/http";

/**
 * GET /.well-known/oauth-authorization-server — RFC 8414 metadata.
 *
 * Public: MCP clients (claude.ai, Claude Code, the inspector) discover the
 * OAuth endpoints here after the MCP server's protected-resource metadata
 * points them at this issuer. code_challenge_methods_supported is mandatory —
 * MCP clients refuse to proceed without PKCE support advertised.
 */
export async function GET() {
  return NextResponse.json(
    {
      issuer: OAUTH_ISSUER,
      authorization_endpoint: `${OAUTH_ISSUER}/oauth/authorize`,
      token_endpoint: `${OAUTH_ISSUER}/api/oauth/token`,
      registration_endpoint: `${OAUTH_ISSUER}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    {
      headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" },
    },
  );
}

export async function OPTIONS() {
  return corsPreflight();
}
