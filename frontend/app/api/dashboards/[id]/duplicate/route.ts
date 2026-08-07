import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { dashboardQueries, type Json } from "@/lib/db";
import { emitSystemEvent } from "@/lib/events/emit";

/**
 * POST /api/dashboards/[id]/duplicate - Duplicate a dashboard
 */
export const POST = withDualAuth(
  async (_request, { userId, orgId, orgRole, isApiKeyAuth, params }) => {
  const { id } = await params;

  if (!isApiKeyAuth) {
    await requirePermission(
      { orgId, orgRole, userId },
      "action-duplicate-dashboard",
    );
  }

  // Get the original dashboard
  const result = await dashboardQueries.findById(orgId, id);
  const original = result[0];

  if (!original) {
    return NextResponse.json(
      { error: "Dashboard not found" },
      { status: 404 }
    );
  }

  // Create a duplicate with "(Copy)" suffix
  const duplicated = await dashboardQueries.insert(orgId, {
    name: `${original.name} (Copy)`,
    description: original.description,
    icon: original.icon,
    parent_id: original.parent_id,
    config: original.config as Json,
  });

  emitSystemEvent({
    orgId,
    eventType: "dashboard.duplicated",
    category: "dashboard",
    title: `Dashboard duplicated`,
    severity: "success",
    entityId: duplicated[0].id,
    entityType: "dashboard",
    actorId: userId,
  });

  return NextResponse.json({ dashboard: duplicated[0] }, { status: 201 });
  },
);
