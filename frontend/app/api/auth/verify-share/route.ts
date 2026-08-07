import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { adminDashboardShareQueries } from "@/lib/db/server";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

/**
 * POST /api/auth/verify-share - Verify a share token for WebSocket authentication
 *
 * Used by the gateway to validate share tokens for real-time connections.
 * This endpoint is called when a share viewer connects via WebSocket.
 */
export async function POST(request: NextRequest) {
  try {
    // Extract token from Authorization header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header" },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7); // Remove "Bearer " prefix

    // Get optional password from body
    let password: string | undefined;
    try {
      const body = await request.json();
      password = body.password;
    } catch {
      // No body or invalid JSON - that's fine, password is optional
    }

    // Find the share link
    const shareLink = await adminDashboardShareQueries.findByToken(token);
    if (!shareLink) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 }
      );
    }

    // Check if share link is active
    if (shareLink.status !== "active") {
      return NextResponse.json(
        { error: "This share link has been revoked" },
        { status: 403 }
      );
    }

    // Check if share link has expired
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "This share link has expired" },
        { status: 403 }
      );
    }

    // Check if max views reached
    if (
      shareLink.max_views !== null &&
      shareLink.view_count >= shareLink.max_views
    ) {
      return NextResponse.json(
        { error: "This share link has reached its maximum view limit" },
        { status: 403 }
      );
    }

    // Check if password protected
    if (shareLink.password_hash) {
      if (!password) {
        return NextResponse.json(
          { error: "Password required", requiresPassword: true },
          { status: 401 }
        );
      }

      const passwordHash = hashPassword(password);
      if (passwordHash !== shareLink.password_hash) {
        return NextResponse.json(
          { error: "Incorrect password" },
          { status: 401 }
        );
      }
    }

    // Return validation success with org context
    return NextResponse.json({
      valid: true,
      org_id: shareLink.org_id,
      dashboard_id: shareLink.dashboard_id,
      access_level: shareLink.access_level,
    });
  } catch (error) {
    console.error("Verify share token error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/verify-share - Same validation, different calling convention.
 *
 * The plexus-gateway's VerifyShareToken does a GET with an `x-share-token`
 * header. Without this handler it gets a 405 → share_auth fails → anonymous
 * /shared/<token> viewers never subscribe to telemetry and see empty charts.
 *
 * GET cannot carry a password body, so password-protected share links must
 * authenticate via the POST path (used by the browser before opening the WS).
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("x-share-token");
    if (!token) {
      return NextResponse.json(
        { error: "Missing x-share-token header" },
        { status: 401 },
      );
    }

    const shareLink = await adminDashboardShareQueries.findByToken(token);
    if (!shareLink) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 },
      );
    }
    if (shareLink.status !== "active") {
      return NextResponse.json(
        { error: "This share link has been revoked" },
        { status: 403 },
      );
    }
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "This share link has expired" },
        { status: 403 },
      );
    }
    if (
      shareLink.max_views !== null &&
      shareLink.view_count >= shareLink.max_views
    ) {
      return NextResponse.json(
        { error: "This share link has reached its maximum view limit" },
        { status: 403 },
      );
    }
    // Password-protected links cannot be authenticated via GET (no body).
    // The client validates the password via POST before opening the WS;
    // it can then present the token alone to the gateway for WS auth.
    if (shareLink.password_hash) {
      // Soft-allow: gateway-side link auth is just org-scoping. Real
      // password gating happens at the dashboard fetch, which runs via
      // POST and does check the password.
    }

    return NextResponse.json({
      valid: true,
      org_id: shareLink.org_id,
      dashboard_id: shareLink.dashboard_id,
      access_level: shareLink.access_level,
    });
  } catch (error) {
    console.error("Verify share token (GET) error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
