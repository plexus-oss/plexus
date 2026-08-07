import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { CreateDashboardSchema } from "@/lib/validation/api-schemas";
import { dashboardQueries, type Json } from "@/lib/db";
import { adminDashboardQueries } from "@/lib/db/server";
import { DEFAULT_DASHBOARD_CONFIG } from "@/lib/types/dashboard";
import { cachedJson } from "@/lib/utils";
import { emitSystemEvent } from "@/lib/events/emit";
import {
  loadUserDashboardGrants,
  loadPrivateDashboardIds,
  canAccessDashboard,
} from "@/lib/access/dashboards";

/**
 * GET /api/dashboards - List all dashboards for the organization
 *
 * Auto-seeds a showcase dashboard on first login (when org has no dashboards)
 */
export const GET = withDualAuth(
  async (_req, { orgId, userId, orgRole, roleId, isApiKeyAuth }) => {
    const queries = isApiKeyAuth ? adminDashboardQueries : dashboardQueries;
    let dashboards = await queries.findAll(orgId);

    // Session callers see only dashboards they can view (API-key automation is
    // org-scoped and bypasses per-user filtering). Restricted dashboards the
    // user has no grant for are filtered out entirely.
    if (!isApiKeyAuth && userId) {
      const privateIds = await loadPrivateDashboardIds(orgId);
      if (privateIds.size > 0) {
        const grants = await loadUserDashboardGrants(orgId, userId, roleId ?? orgRole);
        dashboards = dashboards.filter((d) =>
          canAccessDashboard({
            orgRole,
            userId,
            dashboard: d,
            isPrivate: privateIds.has(d.id),
            grants,
            need: "view",
          }),
        );
      }
    }

    const items = dashboards.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      icon: d.icon,
      icon_url: d.icon_url,
      parent_id: d.parent_id,
      visibility: d.visibility,
      created_at: d.created_at,
      updated_at: d.updated_at,
      panel_count: (d.config as { panels?: unknown[] })?.panels?.length || 0,
    }));

    // cachedJson already sets Cache-Control: private, so the per-user filtered
    // list is never cross-served by a shared cache.
    return cachedJson(
      { dashboards: items },
      { maxAge: 5, staleWhileRevalidate: 15 },
    );
  },
);

/**
 * POST /api/dashboards - Create a new dashboard
 */
export const POST = withDualAuth(
  async (request, { userId, orgId, orgRole, isApiKeyAuth }) => {
    // Manifest-gated capability (API-key callers are org-scoped automation).
    if (!isApiKeyAuth) {
      await requirePermission({ orgId, orgRole, userId }, "action-new-dashboard");
    }
    const body = await validateBody(request, CreateDashboardSchema);
    const queries = isApiKeyAuth ? adminDashboardQueries : dashboardQueries;

    const insertResult = await queries.insert(orgId, {
      name: body.name,
      description: body.description?.trim() || null,
      icon: body.icon || null,
      parent_id: body.parent_id || null,
      config: DEFAULT_DASHBOARD_CONFIG as unknown as Json,
      created_by: userId ?? null,
    });

    // adminDashboardQueries.insert returns Dashboard, dashboardQueries.insert returns Dashboard[]
    const dashboard = Array.isArray(insertResult)
      ? insertResult[0]
      : insertResult;

    emitSystemEvent({
      orgId,
      eventType: "dashboard.created",
      category: "dashboard",
      title: `Dashboard "${body.name || "Untitled"}" created`,
      severity: "success",
      entityId: dashboard.id,
      entityType: "dashboard",
      actorId: userId,
    });

    return NextResponse.json({ dashboard }, { status: 201 });
  },
);
