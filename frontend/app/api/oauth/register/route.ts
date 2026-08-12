import { NextRequest, NextResponse } from "next/server";
import { oauthQueries } from "@/lib/db/queries/oauth";
import {
  CORS_HEADERS,
  corsPreflight,
  isAllowedRedirectUri,
  oauthError,
} from "@/lib/oauth/http";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

const MAX_REDIRECT_URIS = 10;
const MAX_NAME_LENGTH = 100;
const MAX_URI_LENGTH = 2000;

/**
 * POST /api/oauth/register — RFC 7591 Dynamic Client Registration (subset).
 *
 * Public and anonymous by design (claude.ai registers itself before the user
 * ever consents); rate-limited, and registration grants nothing — every
 * authorization still goes through the signed-in consent page. Public clients
 * only: no client_secret is issued.
 */
export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`oauth-register:${getClientIp(request)}`, 10, 60_000);
  if (!rate.allowed) {
    return oauthError("invalid_client_metadata", 429, "Too many registrations", {
      "Retry-After": String(rate.retryAfter ?? 60),
    });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return oauthError("invalid_client_metadata", 400, "Body must be JSON");
  }

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return oauthError(
      "invalid_redirect_uri",
      400,
      "redirect_uris must be a non-empty array",
    );
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    return oauthError("invalid_redirect_uri", 400, "Too many redirect_uris");
  }
  for (const uri of redirectUris) {
    if (
      typeof uri !== "string" ||
      uri.length > MAX_URI_LENGTH ||
      !isAllowedRedirectUri(uri)
    ) {
      return oauthError(
        "invalid_redirect_uri",
        400,
        `redirect_uris entries must be https:// URLs (or http://localhost): ${String(uri).slice(0, 100)}`,
      );
    }
  }

  if (
    body.token_endpoint_auth_method !== undefined &&
    body.token_endpoint_auth_method !== "none"
  ) {
    return oauthError(
      "invalid_client_metadata",
      400,
      "Only public clients (token_endpoint_auth_method 'none') are supported",
    );
  }
  if (
    body.grant_types !== undefined &&
    (!Array.isArray(body.grant_types) ||
      !body.grant_types.includes("authorization_code"))
  ) {
    return oauthError(
      "invalid_client_metadata",
      400,
      "grant_types must include authorization_code",
    );
  }

  const clientName =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, MAX_NAME_LENGTH)
      : "MCP client";
  const asUrl = (v: unknown) =>
    typeof v === "string" && v.length <= MAX_URI_LENGTH && v.startsWith("https://")
      ? v
      : null;

  let client;
  try {
    client = await oauthQueries.registerClient({
      clientName,
      redirectUris,
      logoUri: asUrl(body.logo_uri),
      clientUri: asUrl(body.client_uri),
    });
  } catch (error) {
    console.error("OAuth client registration error:", error);
    return oauthError("server_error", 500);
  }

  return NextResponse.json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(
        new Date(client.created_at ?? Date.now()).getTime() / 1000,
      ),
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS() {
  return corsPreflight();
}
