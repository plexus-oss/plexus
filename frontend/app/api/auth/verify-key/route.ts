import { NextRequest, NextResponse } from "next/server";
import { hashApiKey, isValidApiKeyFormat } from "@/lib/api-keys";
import { adminApiKeyQueries } from "@/lib/db/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

/**
 * GET /api/auth/verify-key - Verify an API key for the WebSocket server
 *
 * Called by the Fly.io WebSocket server to authenticate device connections.
 * Takes x-api-key header and returns org_id if valid.
 *
 * Response (200):
 *   { org_id: string, scopes: string[] }
 *
 * Response (401):
 *   { error: string }
 */
export async function GET(request: NextRequest) {
  // Key verification is a brute-force oracle — limit attempts per IP
  const rate = checkRateLimit(`verify-key:${getClientIp(request)}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many verification attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } },
    );
  }

  const apiKey = request.headers.get("x-api-key");

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing API key" },
      { status: 401 }
    );
  }

  // Check for dev API key in development mode
  if (process.env.NODE_ENV === "development" && apiKey === "plx_dev_internal_telemetry_key") {
    return NextResponse.json({
      org_id: "dev_internal_org",
      scopes: ["write"],
    });
  }

  if (!isValidApiKeyFormat(apiKey)) {
    return NextResponse.json(
      { error: "Invalid API key format" },
      { status: 401 }
    );
  }

  try {
    const keyHash = hashApiKey(apiKey);
    const keyRecords = await adminApiKeyQueries.findByHash(keyHash);
    const keyRecord = keyRecords?.[0] as {
      id: string;
      org_id: string;
      expires_at: string | null;
      scopes: string[] | null;
      access_enabled: boolean | null;
    } | undefined;

    if (!keyRecord) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      );
    }

    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "API key has expired" },
        { status: 401 }
      );
    }

    // Billing gate: an org whose keys were soft-disabled (spend cap, team-tier
    // breach, cancellation) must stop ingesting. `access_enabled` is toggled by
    // syncApiKeyAccess and the breach enforcers; honoring it here is what makes
    // the gateway (which treats any non-200 as auth failure) actually pause the
    // org — without deleting the key, so restore is instant on payment.
    if (keyRecord.access_enabled === false) {
      return NextResponse.json(
        { error: "API key access disabled — check billing" },
        { status: 403 }
      );
    }

    // Update last used timestamp (fire and forget)
    adminApiKeyQueries.updateLastUsed(keyRecord.id).catch(() => {});

    return NextResponse.json({
      org_id: keyRecord.org_id,
      // Length-checked: an empty scopes array must normalize to the default —
      // the gateway's HasScope treats [] as full access.
      scopes: keyRecord.scopes?.length ? keyRecord.scopes : ["write"],
    });
  } catch (error) {
    console.error("API key verification error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
