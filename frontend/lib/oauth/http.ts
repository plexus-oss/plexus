/**
 * Shared helpers for the OAuth 2.1 authorization-server endpoints (MCP
 * connector flow). The token/register/metadata endpoints are called
 * cross-origin by browser-based MCP clients (e.g. the MCP inspector), and the
 * frontend has no global CORS — so each public OAuth route exports OPTIONS
 * and attaches these headers itself.
 */

import { NextResponse } from "next/server";

// Fly proxy rule: never derive origins from request.nextUrl (see middleware.ts).
export const OAUTH_ISSUER =
  process.env.NEXT_PUBLIC_APP_URL || "https://app.plexus.company";

/** Canonical resource identifier of the MCP server (RFC 8707 audience). */
export const MCP_RESOURCE_URL =
  process.env.MCP_RESOURCE_URL || "https://api.plexus.company/mcp";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-protocol-version",
};

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** OAuth-shaped error body (RFC 6749 §5.2), CORS'd and uncacheable. */
export function oauthError(
  error: string,
  status: number,
  description?: string,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error, ...(description ? { error_description: description } : {}) },
    {
      status,
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "no-store",
        ...extraHeaders,
      },
    },
  );
}

/** RFC 8707 comparison: exact match modulo a single trailing slash. */
export function matchesMcpResource(resource: string): boolean {
  const norm = (u: string) => (u.endsWith("/") ? u.slice(0, -1) : u);
  return norm(resource) === norm(MCP_RESOURCE_URL);
}

export function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  // Loopback redirects are allowed per OAuth 2.1 (native/local clients).
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)
  );
}
