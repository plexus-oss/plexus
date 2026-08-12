import { NextRequest, NextResponse } from "next/server";
import { generateApiKey } from "@/lib/api-keys";
import { computeAccessEnabled } from "@/lib/billing/server";
import { apiKeyQueries } from "@/lib/db";
import { oauthQueries, verifyPkceS256 } from "@/lib/db/queries/oauth";
import { emitSystemEvent } from "@/lib/events/emit";
import { CORS_HEADERS, corsPreflight, oauthError } from "@/lib/oauth/http";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

/**
 * POST /api/oauth/token — authorization_code exchange (OAuth 2.1 + PKCE).
 *
 * Public, form-encoded, called by MCP clients (server-side by claude.ai,
 * browser-side by the inspector — hence CORS). The access token minted here
 * IS an org-scoped plx_ API key (mint-at-exchange, mirroring the device-code
 * claim flow): validation, billing gating, and revocation all ride the
 * existing api_keys machinery. Codes redeem exactly once — consume first,
 * validate after, so a failed exchange burns the code (per OAuth 2.1).
 */
export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`oauth-token:${getClientIp(request)}`, 30, 60_000);
  if (!rate.allowed) {
    return oauthError("invalid_request", 429, "Too many token requests", {
      "Retry-After": String(rate.retryAfter ?? 60),
    });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return oauthError(
      "invalid_request",
      400,
      "Body must be application/x-www-form-urlencoded",
    );
  }
  const p = (k: string): string | null => {
    const v = form.get(k);
    return typeof v === "string" && v.length > 0 ? v : null;
  };

  if (p("grant_type") !== "authorization_code") {
    return oauthError("unsupported_grant_type", 400);
  }
  const code = p("code");
  const verifier = p("code_verifier");
  const clientId = p("client_id");
  const redirectUri = p("redirect_uri");
  if (!code || !verifier || !clientId || !redirectUri) {
    return oauthError(
      "invalid_request",
      400,
      "code, code_verifier, client_id, and redirect_uri are required",
    );
  }

  try {
    // Single winner: burn the code before validating the rest.
    const row = await oauthQueries.consumeAuthorizationCode(code);
    if (
      !row ||
      row.client_id !== clientId ||
      row.redirect_uri !== redirectUri ||
      !verifyPkceS256(verifier, row.code_challenge)
    ) {
      return oauthError("invalid_grant", 400);
    }

    const client = await oauthQueries.findClient(row.client_id);
    const keyName = `${client?.client_name ?? "MCP client"} (MCP)`;

    const { key, prefix, hash } = generateApiKey();
    const access_enabled = await computeAccessEnabled(row.org_id);
    const inserted = await apiKeyQueries.insert(row.org_id, {
      name: keyName,
      key_prefix: prefix,
      key_hash: hash,
      scopes: ["read", "write"],
      expires_at: null,
      access_enabled,
    });
    const keyRecord = inserted[0];

    await oauthQueries.attachApiKey(code, keyRecord.id);

    emitSystemEvent({
      orgId: row.org_id,
      eventType: "api_key.created",
      category: "api_key",
      title: `API key "${keyName}" issued via MCP OAuth`,
      severity: "success",
      entityId: keyRecord.id,
      entityType: "api_key",
    });

    return NextResponse.json(
      { access_token: key, token_type: "Bearer", scope: "read write" },
      { headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("OAuth token exchange error:", error);
    return oauthError("server_error", 500);
  }
}

export async function OPTIONS() {
  return corsPreflight();
}
