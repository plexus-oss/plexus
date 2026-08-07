import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { dashboardQueries } from "@/lib/db";
import { adminDashboardQueries } from "@/lib/db/server";
import type { UpdateDashboardRequest } from "@/lib/types/dashboard";
import { emitSystemEvent } from "@/lib/events/emit";
import {
  loadUserDashboardGrants,
  loadPrivateDashboardIds,
  assertDashboardAccess,
  type AccessLevel,
} from "@/lib/access/dashboards";
import type { Dashboard } from "@/lib/db/types";

/**
 * For session callers, enforce per-dashboard access. API-key callers are
 * org-scoped automation and bypass (consistent with the list route).
 */
async function enforce(
  ctx: {
    orgId: string;
    userId: string | undefined;
    orgRole: string | undefined;
    roleId?: string | null;
    isApiKeyAuth: boolean;
  },
  dashboard: Dashboard,
  need: AccessLevel,
): Promise<void> {
  if (ctx.isApiKeyAuth || !ctx.userId) return;
  const privateIds = await loadPrivateDashboardIds(ctx.orgId);
  const isPrivate = privateIds.has(dashboard.id);
  // Grants only matter for private dashboards; public access is decided by
  // role/creator alone, so skip the grant load in the common case.
  const grants = isPrivate
    ? await loadUserDashboardGrants(ctx.orgId, ctx.userId, ctx.roleId ?? ctx.orgRole)
    : new Map<string, AccessLevel>();
  assertDashboardAccess(
    { orgRole: ctx.orgRole, userId: ctx.userId },
    dashboard,
    isPrivate,
    grants,
    need,
  );
}

/**
 * GET /api/dashboards/[id] - Get a single dashboard
 */
export const GET = withDualAuth(
  async (_request, { orgId, userId, orgRole, roleId, isApiKeyAuth, params }) => {
    const { id } = await params;
    const queries = isApiKeyAuth ? adminDashboardQueries : dashboardQueries;
    const result = await queries.findById(orgId, id);
    const dashboard = result[0];

    if (!dashboard) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }

    await enforce({ orgId, userId, orgRole, roleId, isApiKeyAuth }, dashboard, "view");

    return NextResponse.json({ dashboard });
  },
);

/**
 * PUT /api/dashboards/[id] - Update a dashboard
 */
export const PUT = withDualAuth(
  async (request, { orgId, userId, orgRole, roleId, isApiKeyAuth, params }) => {
    const { id } = await params;
    const body = (await request.json()) as UpdateDashboardRequest & {
      visibility?: string;
    };
    const queries = isApiKeyAuth ? adminDashboardQueries : dashboardQueries;

    const existing = (await queries.findById(orgId, id))[0];
    if (!existing) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }

    await enforce({ orgId, userId, orgRole, roleId, isApiKeyAuth }, existing, "edit");

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (!body.name.trim()) {
        return NextResponse.json(
          { error: "Dashboard name cannot be empty" },
          { status: 400 },
        );
      }
      updates.name = body.name.trim();
    }

    if (body.description !== undefined) {
      updates.description = body.description?.trim() || null;
    }

    if (body.icon !== undefined) {
      updates.icon = body.icon || null;
    }

    if (body.icon_url !== undefined) {
      updates.icon_url = body.icon_url;
    }

    if (body.config !== undefined) {
      updates.config = body.config;
    }

    const result = await queries.update(orgId, id, updates);
    const dashboard = result[0];

    if (!dashboard) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ dashboard });
  },
);

/**
 * DELETE /api/dashboards/[id] - Delete a dashboard
 *
 * Dual-auth: session callers go through RLS; API-key callers bypass
 * via adminDashboardQueries so automated provisioning pipelines can
 * tear down try-session dashboards without a user session.
 */
export const DELETE = withDualAuth(
  async (_request, { userId, orgId, orgRole, roleId, isApiKeyAuth, params }) => {
    const { id } = await params;
    const queries = isApiKeyAuth ? adminDashboardQueries : dashboardQueries;

    if (!isApiKeyAuth && userId) {
      const existing = (await queries.findById(orgId, id))[0];
      if (!existing) {
        return NextResponse.json(
          { error: "Dashboard not found" },
          { status: 404 },
        );
      }
      await enforce({ orgId, userId, orgRole, roleId, isApiKeyAuth }, existing, "edit");
      // Delete is capability-gated (Role Matrix). Creators keep their bypass —
      // resource grants confer view/edit, not delete.
      if (existing.created_by !== userId) {
        await requirePermission(
          { orgId, orgRole, userId },
          "action-delete-dashboard",
        );
      }
    }

    await queries.delete(orgId, id);

    emitSystemEvent({
      orgId,
      eventType: "dashboard.deleted",
      category: "dashboard",
      title: `Dashboard deleted`,
      severity: "warning",
      entityId: id,
      entityType: "dashboard",
      actorId: userId,
    });

    return NextResponse.json({ success: true });
  },
);
