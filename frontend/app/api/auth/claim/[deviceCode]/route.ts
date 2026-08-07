import { NextRequest, NextResponse } from "next/server";
import { generateApiKey } from "@/lib/api-keys";
import { computeAccessEnabled } from "@/lib/billing/server";
import { adminApiKeyQueries } from "@/lib/db/server";
import {
  adminDeviceAuthQueries,
  isClaimExpired,
} from "@/lib/db/queries/device-auth";
import { emitSystemEvent } from "@/lib/events/emit";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

/**
 * GET /api/auth/claim/[deviceCode] - Poll a key-claim request
 *
 * Public: polled by the coding agent that created the claim. device_code is
 * the bearer secret — it is never shown to a human and never accepted by the
 * approval endpoints.
 *
 * The key is minted HERE, on the first poll after approval (mint-at-poll):
 * claimDelivery atomically burns the approved row, so the plaintext secret
 * is never stored and is delivered to exactly one poll.
 *
 * Response (200): { status: "pending" | "denied" | "expired" }
 *              or { status: "approved", api_key, org_id }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deviceCode: string }> },
) {
  // Polling cadence is 5s; the cap only exists to stop brute-force scanning.
  const rate = checkRateLimit(`claim-poll:${getClientIp(request)}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many poll attempts. Slow down." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } },
    );
  }

  const { deviceCode } = await params;

  try {
    const row = await adminDeviceAuthQueries.findByDeviceCode(deviceCode);

    if (!row) {
      return NextResponse.json(
        { error: "Unknown claim request" },
        { status: 404 },
      );
    }

    if (row.status === "denied") {
      return NextResponse.json({ status: "denied" });
    }

    if (row.status === "expired" || isClaimExpired(row)) {
      return NextResponse.json({ status: "expired" });
    }

    if (row.status === "pending") {
      return NextResponse.json({ status: "pending", interval: 5 });
    }

    // status === "approved" — burn the row first; only the winner mints.
    const claimed = await adminDeviceAuthQueries.claimDelivery(deviceCode);
    if (!claimed || !claimed.org_id) {
      return NextResponse.json({ status: "expired" });
    }

    const keyName = claimed.requested_name || `agent-${claimed.user_code}`;
    const { key, prefix, hash } = generateApiKey();
    const access_enabled = await computeAccessEnabled(claimed.org_id);

    const inserted = await adminApiKeyQueries.insert(claimed.org_id, {
      name: keyName,
      key_prefix: prefix,
      key_hash: hash,
      scopes: ["write"],
      expires_at: null,
      access_enabled,
    });
    const keyRecord = inserted[0];

    await adminDeviceAuthQueries.attachApiKey(deviceCode, keyRecord.id);

    emitSystemEvent({
      orgId: claimed.org_id,
      eventType: "api_key.created",
      category: "api_key",
      title: `API key "${keyName}" issued to a coding agent`,
      severity: "success",
      entityId: keyRecord.id,
      entityType: "api_key",
    });

    return NextResponse.json({
      status: "approved",
      // Only delivery of the secret — it cannot be retrieved again.
      api_key: key,
      org_id: claimed.org_id,
    });
  } catch (error) {
    console.error("Claim poll error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
