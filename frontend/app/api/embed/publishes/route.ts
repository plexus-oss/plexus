/**
 * Published-embed management (session-authed, Settings/panel dialog).
 *
 * GET  /api/embed/publishes?dashboardId&panelId — list this panel's publishes.
 * POST /api/embed/publishes — publish a durable, revocable embed token for a
 *      panel the org owns. Returns the token to paste directly (no backend mint).
 */

import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { adminDashboardQueries, adminEmbedPublishQueries } from "@/lib/db/server";
import { generateEmbedPublishToken } from "@/lib/embed/publish";
import type { DashboardConfig } from "@/lib/types/dashboard";

function toApi(row: {
  id: string;
  token: string;
  label: string | null;
  time_range: string | null;
  created_at: string;
  revoked_at: string | null;
}) {
  return {
    id: row.id,
    token: row.token,
    label: row.label,
    timeRange: row.time_range,
    createdAt: row.created_at,
    revoked: row.revoked_at !== null,
  };
}

export const GET = withRoleAuth(
  ["org:admin", "org:editor"],
  async (request, { orgId }) => {
    const url = new URL(request.url);
    const dashboardId = url.searchParams.get("dashboardId") ?? "";
    const panelId = url.searchParams.get("panelId") ?? "";
    if (!dashboardId || !panelId) {
      return NextResponse.json(
        { error: "dashboardId and panelId are required" },
        { status: 400 },
      );
    }
    const rows = await adminEmbedPublishQueries.findAllForPanel(
      orgId,
      dashboardId,
      panelId,
    );
    return NextResponse.json({
      publishes: rows.filter((r) => r.revoked_at === null).map(toApi),
    });
  },
);

export const POST = withRoleAuth(
  ["org:admin", "org:editor"],
  async (request, { orgId, userId }) => {
    let body: {
      dashboardId?: unknown;
      panelId?: unknown;
      label?: unknown;
      timeRange?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const dashboardId = typeof body.dashboardId === "string" ? body.dashboardId : "";
    const panelId = typeof body.panelId === "string" ? body.panelId : "";
    if (!dashboardId || !panelId) {
      return NextResponse.json(
        { error: "dashboardId and panelId are required" },
        { status: 400 },
      );
    }

    // Ownership: the panel must exist in a dashboard this org owns.
    const [dashboard] = await adminDashboardQueries.findById(orgId, dashboardId);
    if (!dashboard) {
      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
    }
    const config = dashboard.config as unknown as DashboardConfig;
    if (!config?.panels?.some((p) => p.id === panelId)) {
      return NextResponse.json(
        { error: "Panel not found in dashboard" },
        { status: 404 },
      );
    }

    const row = await adminEmbedPublishQueries.create(orgId, {
      dashboard_id: dashboardId,
      panel_id: panelId,
      token: generateEmbedPublishToken(),
      label: typeof body.label === "string" ? body.label : null,
      time_range: typeof body.timeRange === "string" ? body.timeRange : null,
      created_by: userId,
    });

    return NextResponse.json(toApi(row), { status: 201 });
  },
);
