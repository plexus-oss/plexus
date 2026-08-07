import { NextRequest, NextResponse } from "next/server";
import { verifyWsToken } from "@/lib/auth/ws-token";

/**
 * GET /api/auth/verify-session - Verify a browser session token for the
 * WebSocket gateway.
 *
 * Called by the gateway to authenticate browser connections. Takes
 * Authorization: Bearer <token> and returns org_id/user_id if valid.
 *
 * The token is a Plexus ws-token (HS256 over AUTH_SECRET, minted by
 * /api/auth/ws-token) — a local HMAC check, no network.
 *
 * Response (200): { org_id: string, user_id: string }
 * Response (401): { error: string }
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  const wsClaims = await verifyWsToken(token);
  if (!wsClaims) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    org_id: wsClaims.orgId,
    user_id: wsClaims.userId,
  });
}
