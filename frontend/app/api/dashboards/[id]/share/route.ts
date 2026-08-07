import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createHash } from "crypto";
import { withAuth, withDualAuth } from "@/lib/api/with-auth";
import {
  dashboardQueries,
  dashboardShareLinkQueries,
  dashboardPermissionQueries,
} from "@/lib/db";
import { adminDashboardQueries } from "@/lib/db/server";
import type { Dashboard, ShareLinkAccess } from "@/lib/db/types";
import { emitSystemEvent } from "@/lib/events/emit";
import { apiError } from "@/lib/api/errors";
import {
  loadUserDashboardGrants,
  loadPrivateDashboardIds,
  assertDashboardAccess,
} from "@/lib/access/dashboards";
import { db } from "@/lib/db/client";
import { dashboardShareLinks } from "@/lib/db/schema";
import { loadAllowedSourceIds } from "@/lib/access/sources";

/** Managing sharing requires edit access. Session callers only; API-key bypass. */
async function assertCanManageSharing(
  ctx: {
    orgId: string;
    userId: string | undefined;
    orgRole: string | undefined;
    roleId?: string | null;
    isApiKeyAuth: boolean;
  },
  dashboard: Dashboard,
): Promise<void> {
  if (ctx.isApiKeyAuth || !ctx.userId) return;
  const isPrivate = (await loadPrivateDashboardIds(ctx.orgId)).has(
    dashboard.id,
  );
  const grants = await loadUserDashboardGrants(
    ctx.orgId,
    ctx.userId,
    ctx.roleId ?? ctx.orgRole,
  );
  assertDashboardAccess(
    { orgRole: ctx.orgRole, userId: ctx.userId },
    dashboard,
    isPrivate,
    grants,
    "edit",
  );
}

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

/**
 * GET /api/dashboards/[id]/share - List share links + permissions.
 * Session-authenticated. API-key access is not exposed here (read path
 * is only used from the in-app Share dialog).
 */
export const GET = withAuth(
  async (_request, { userId, orgId, orgRole, roleId, params }) => {
    const { id: dashboardId } = await params;
    const dashboard = await dashboardQueries.findById(orgId, dashboardId);
    if (!dashboard[0]) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }

    // Only those who can manage sharing (creator / admin / edit-grant) may see
    // the grant list and share-link tokens — these are sensitive for a
    // private dashboard.
    const isPrivate = (await loadPrivateDashboardIds(orgId)).has(
      dashboard[0].id,
    );
    const grants = await loadUserDashboardGrants(
      orgId,
      userId,
      roleId ?? orgRole,
    );
    assertDashboardAccess(
      { orgRole, userId },
      dashboard[0],
      isPrivate,
      grants,
      "edit",
    );

    const [shareLinks, permissions] = await Promise.all([
      dashboardShareLinkQueries.findByDashboard(orgId, dashboardId),
      dashboardPermissionQueries.findByDashboard(orgId, dashboardId),
    ]);

    return NextResponse.json({
      shareLinks: shareLinks.filter((link) => link.status === "active"),
      permissions,
    });
  },
);

/**
 * POST /api/dashboards/[id]/share - Create a share link or permission.
 *
 * Accepts dual auth. With an API key there is no user session, so the
 * share-link row records `created_by = "api-key:<key_prefix>"` and
 * permission/invite creation is rejected (requires a real inviter).
 */
export const POST = withDualAuth(
  async (request, { userId, orgId, orgRole, isApiKeyAuth, params }) => {
    const { id: dashboardId } = (await params) as { id: string };
    const body = await request.json();

    // Dashboard lookup: admin queries for API key, user queries for session.
    const dashboard = isApiKeyAuth
      ? await adminDashboardQueries.findById(orgId, dashboardId)
      : await dashboardQueries.findById(orgId, dashboardId);
    if (!dashboard[0]) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }

    await assertCanManageSharing(
      { orgId, userId, orgRole, isApiKeyAuth },
      dashboard[0],
    );

    // A scoped member's public link would run UNSCOPED (anonymous viewers),
    // leaking data beyond their own scope — refuse to create one.
    if (!isApiKeyAuth && userId) {
      const srcs = await loadAllowedSourceIds(orgId, userId);
      if (srcs !== null) {
        return NextResponse.json(
          { error: "Scoped members can't create public share links." },
          { status: 403 },
        );
      }
    }

    if (body.type === "link") {
      const token = nanoid(32);
      const passwordHash = body.password
        ? hashPassword(body.password)
        : undefined;
      const creator = userId ?? "api-key";

      // API-key path can't use the RLS-scoped queries (no JWT), so write via
      // the service role here to stay consistent with the dashboards path.
      if (isApiKeyAuth) {
        let data;
        try {
          [data] = await db
            .insert(dashboardShareLinks)
            .values({
              org_id: orgId,
              dashboard_id: dashboardId,
              token,
              name: body.name ?? null,
              access_level: (body.accessLevel as ShareLinkAccess) ?? "view",
              status: "active",
              password_hash: passwordHash ?? null,
              expires_at: body.expiresAt ?? null,
              max_views: body.maxViews ?? null,
              created_by: creator,
            } as typeof dashboardShareLinks.$inferInsert)
            .returning();
        } catch (error) {
          console.error("Share-link insert failed:", error);
          return NextResponse.json(
            { error: "Failed to create share link" },
            { status: 500 },
          );
        }

        const origin =
          request.headers.get("origin") ||
          process.env.NEXT_PUBLIC_APP_URL ||
          "https://app.plexus.company";
        const shareUrl = `${origin}/shared/${token}`;
        return NextResponse.json({
          shareLink: { ...(data as unknown as object), url: shareUrl },
        });
      }

      const shareLink = await dashboardShareLinkQueries.create(
        orgId,
        dashboardId,
        creator,
        {
          token,
          name: body.name,
          accessLevel: (body.accessLevel as ShareLinkAccess) ?? "view",
          expiresAt: body.expiresAt,
          maxViews: body.maxViews,
          passwordHash,
        },
      );

      const origin =
        request.headers.get("origin") ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000";
      const shareUrl = `${origin}/shared/${token}`;

      if (userId) {
        emitSystemEvent({
          orgId,
          eventType: "dashboard.shared",
          category: "dashboard",
          title: `Dashboard shared via link`,
          entityId: dashboardId,
          entityType: "dashboard",
          actorId: userId,
        });
      }

      return NextResponse.json({
        shareLink: { ...shareLink, url: shareUrl },
      });
    } else if (body.type === "permission") {
      if (!userId) {
        return NextResponse.json(
          { error: "Permission invites require a user session (not API key)" },
          { status: 400 },
        );
      }

      // A grant targets exactly one of: an org member (userId) or an external
      // email invite.
      const granteeUserId: string | undefined = body.userId;
      const email: string | undefined = body.email;
      if (!granteeUserId && !email) {
        return NextResponse.json(
          { error: "A grantee (userId or email) is required" },
          { status: 400 },
        );
      }

      const permission = await dashboardPermissionQueries.create(
        orgId,
        dashboardId,
        userId,
        {
          userId: granteeUserId,
          email,
          accessLevel: (body.accessLevel as ShareLinkAccess) ?? "view",
        },
      );

      const granteeLabel = email ?? "a member";
      emitSystemEvent({
        orgId,
        eventType: "dashboard.shared",
        category: "dashboard",
        title: `Dashboard shared with ${granteeLabel}`,
        entityId: dashboardId,
        entityType: "dashboard",
        actorId: userId,
      });

      return NextResponse.json({ permission });
    }

    return NextResponse.json({ error: "Unknown share type" }, { status: 400 });
  },
);

/**
 * DELETE /api/dashboards/[id]/share?linkId=<id>      — revoke a public link
 * DELETE /api/dashboards/[id]/share?permissionId=<id> — remove a grant
 */
export const DELETE = withDualAuth(
  async (request, { userId, orgId, orgRole, isApiKeyAuth, params }) => {
    const { id: dashboardId } = (await params) as { id: string };
    const url = new URL(request.url);
    const linkId = url.searchParams.get("linkId");
    const permissionId = url.searchParams.get("permissionId");

    const dashboard = await dashboardQueries.findById(orgId, dashboardId);
    if (!dashboard[0]) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }
    await assertCanManageSharing(
      { orgId, userId, orgRole, isApiKeyAuth },
      dashboard[0],
    );

    if (linkId) {
      await dashboardShareLinkQueries.revoke(orgId, linkId);
    } else if (permissionId) {
      await dashboardPermissionQueries.delete(orgId, permissionId);
    } else {
      throw apiError("VALIDATION_ERROR", "linkId or permissionId is required");
    }

    return NextResponse.json({ success: true });
  },
);

/**
 * PATCH /api/dashboards/[id]/share
 *   { linkId, name?, expiresAt?, maxViews? }   — update a public link
 *   { permissionId, accessLevel }              — change a grant's access level
 */
export const PATCH = withDualAuth(
  async (request, { userId, orgId, orgRole, isApiKeyAuth, params }) => {
    const { id: dashboardId } = (await params) as { id: string };
    const body = await request.json();

    const dashboard = await dashboardQueries.findById(orgId, dashboardId);
    if (!dashboard[0]) {
      return NextResponse.json(
        { error: "Dashboard not found" },
        { status: 404 },
      );
    }
    await assertCanManageSharing(
      { orgId, userId, orgRole, isApiKeyAuth },
      dashboard[0],
    );

    if (body.linkId) {
      await dashboardShareLinkQueries.update(orgId, body.linkId, {
        name: body.name,
        expiresAt: body.expiresAt,
        maxViews: body.maxViews,
      });
      return NextResponse.json({ success: true });
    }

    if (body.permissionId) {
      await dashboardPermissionQueries.update(orgId, body.permissionId, {
        accessLevel: body.accessLevel as ShareLinkAccess,
      });
      return NextResponse.json({ success: true });
    }

    throw apiError("VALIDATION_ERROR", "linkId or permissionId is required");
  },
);
