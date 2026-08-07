import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { nanoid } from "nanoid";
import { createHash } from "crypto";
import { adminDashboardShareQueries } from "@/lib/db/server";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

interface RouteParams {
  params: Promise<{ token: string }>;
}

/**
 * GET /api/shared/[token] - Get a shared dashboard by token (public access)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const { searchParams } = new URL(request.url);
    const providedPassword = searchParams.get("password");

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
      // If no password provided, return that password is required
      if (!providedPassword) {
        return NextResponse.json({
          requiresPassword: true,
          shareLink: {
            id: shareLink.id,
            name: shareLink.name,
          },
        });
      }

      // Verify password
      const passwordHash = hashPassword(providedPassword);
      if (passwordHash !== shareLink.password_hash) {
        return NextResponse.json(
          { error: "Incorrect password" },
          { status: 401 }
        );
      }
    }

    // Get the dashboard
    const dashboard =
      await adminDashboardShareQueries.getDashboardForShareLink(shareLink);
    if (!dashboard) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 }
      );
    }

    // Extract request metadata for analytics
    const headersList = await headers();
    const userAgent = headersList.get("user-agent") || undefined;
    const referer = headersList.get("referer") || undefined;
    const forwardedFor = headersList.get("x-forwarded-for");
    const ipAddress = forwardedFor?.split(",")[0].trim() || undefined;

    // Generate a session ID for this view
    const sessionId = nanoid(16);

    // Record the view for analytics
    try {
      await adminDashboardShareQueries.recordView({
        org_id: shareLink.org_id,
        dashboard_id: shareLink.dashboard_id,
        share_link_id: shareLink.id,
        session_id: sessionId,
        ip_address: ipAddress,
        user_agent: userAgent,
        referrer: referer,
        started_at: new Date().toISOString(),
      });

      // Increment view count on the share link
      await adminDashboardShareQueries.incrementViewCount(token);
    } catch (viewError) {
      // Don't fail the request if view tracking fails
      console.error("Failed to record view:", viewError);
    }

    return NextResponse.json({
      dashboard: {
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description,
        icon: dashboard.icon,
        icon_url: dashboard.icon_url,
        config: dashboard.config,
      },
      shareLink: {
        id: shareLink.id,
        accessLevel: shareLink.access_level,
        name: shareLink.name,
        isPasswordProtected: !!shareLink.password_hash,
        orgId: shareLink.org_id, // Include orgId for WebSocket connection
      },
      sessionId,
    });
  } catch (error) {
    console.error("Get shared dashboard error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/shared/[token] - Update view analytics (end session, track duration)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const body = await request.json();

    // Verify share link exists
    const shareLink = await adminDashboardShareQueries.findByToken(token);
    if (!shareLink) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 }
      );
    }

    // Update the view
    if (body.sessionId) {
      await adminDashboardShareQueries.updateView(body.sessionId, {
        ended_at: body.endedAt || new Date().toISOString(),
        duration_seconds: body.durationSeconds,
        panels_viewed: body.panelsViewed,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update shared view error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
