import { and, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";

import { db } from "../client";
import {
  dashboards,
  dashboardShareLinks,
  dashboardViews,
  dashboardPermissions,
} from "../schema";
import { createOrgQueries, oneOrNull } from "./shared";
import type {
  Dashboard,
  NewDashboard,
  DashboardShareLink,
  NewDashboardView,
  DashboardView,
  DashboardPermission,
  ShareLinkAccess,
  ShareLinkStatus,
} from "../types";

export const dashboardQueries = {
  ...createOrgQueries<Dashboard, NewDashboard>(dashboards),

  // Null out icon_url on every dashboard pointing at a deleted library image
  // so they fall back to their lucide/emoji icon instead of a dead URL.
  clearIconUrlReferences: async (orgId: string, url: string): Promise<void> => {
    await db
      .update(dashboards)
      .set({ icon_url: null } as Partial<typeof dashboards.$inferInsert>)
      .where(and(eq(dashboards.org_id, orgId), eq(dashboards.icon_url, url)));
  },
};

export const dashboardShareLinkQueries = {
  findByDashboard: async (
    orgId: string,
    dashboardId: string,
  ): Promise<DashboardShareLink[]> => {
    return (await db
      .select()
      .from(dashboardShareLinks)
      .where(
        and(
          eq(dashboardShareLinks.org_id, orgId),
          eq(dashboardShareLinks.dashboard_id, dashboardId),
        ),
      )
      .orderBy(desc(dashboardShareLinks.created_at))) as DashboardShareLink[];
  },

  findByToken: async (token: string): Promise<DashboardShareLink | null> => {
    const rows = await db
      .select()
      .from(dashboardShareLinks)
      .where(eq(dashboardShareLinks.token, token))
      .limit(1);
    return oneOrNull(rows) as DashboardShareLink | null;
  },

  create: async (
    orgId: string,
    dashboardId: string,
    createdBy: string,
    data: {
      token: string;
      name?: string;
      accessLevel?: ShareLinkAccess;
      expiresAt?: string;
      maxViews?: number;
      passwordHash?: string;
    },
  ): Promise<DashboardShareLink> => {
    const [result] = await db
      .insert(dashboardShareLinks)
      .values({
        org_id: orgId,
        dashboard_id: dashboardId,
        token: data.token,
        name: data.name ?? null,
        access_level: data.accessLevel ?? "view",
        password_hash: data.passwordHash ?? null,
        expires_at: data.expiresAt ?? null,
        max_views: data.maxViews ?? null,
        created_by: createdBy,
      } as typeof dashboardShareLinks.$inferInsert)
      .returning();
    return result as DashboardShareLink;
  },

  update: async (
    orgId: string,
    id: string,
    data: {
      name?: string | null;
      status?: ShareLinkStatus;
      expiresAt?: string | null;
      maxViews?: number | null;
    },
  ): Promise<DashboardShareLink | null> => {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.expiresAt !== undefined) updateData.expires_at = data.expiresAt;
    if (data.maxViews !== undefined) updateData.max_views = data.maxViews;

    const [result] = await db
      .update(dashboardShareLinks)
      .set(updateData as Partial<typeof dashboardShareLinks.$inferInsert>)
      .where(
        and(
          eq(dashboardShareLinks.org_id, orgId),
          eq(dashboardShareLinks.id, id),
        ),
      )
      .returning();
    return (result ?? null) as DashboardShareLink | null;
  },

  revoke: async (orgId: string, id: string): Promise<boolean> => {
    await db
      .update(dashboardShareLinks)
      .set({ status: "revoked" } as Partial<
        typeof dashboardShareLinks.$inferInsert
      >)
      .where(
        and(
          eq(dashboardShareLinks.org_id, orgId),
          eq(dashboardShareLinks.id, id),
        ),
      );
    return true;
  },

  delete: async (orgId: string, id: string): Promise<boolean> => {
    await db
      .delete(dashboardShareLinks)
      .where(
        and(
          eq(dashboardShareLinks.org_id, orgId),
          eq(dashboardShareLinks.id, id),
        ),
      );
    return true;
  },

  incrementViewCount: async (token: string): Promise<void> => {
    // Atomic +1 to avoid a read-modify-write race between concurrent views.
    await db
      .update(dashboardShareLinks)
      .set({ view_count: sql`${dashboardShareLinks.view_count} + 1` })
      .where(eq(dashboardShareLinks.token, token));
  },
};

export const dashboardViewQueries = {
  create: async (
    orgId: string,
    data: Omit<NewDashboardView, "org_id" | "id" | "created_at">,
  ): Promise<DashboardView> => {
    const [result] = await db
      .insert(dashboardViews)
      .values({
        org_id: orgId,
        ...data,
      } as typeof dashboardViews.$inferInsert)
      .returning();
    return result as DashboardView;
  },

  update: async (
    orgId: string,
    sessionId: string,
    data: {
      endedAt?: string;
      durationSeconds?: number;
      panelsViewed?: string[];
    },
  ): Promise<DashboardView | null> => {
    const updateData: Record<string, unknown> = {};
    if (data.endedAt !== undefined) updateData.ended_at = data.endedAt;
    if (data.durationSeconds !== undefined)
      updateData.duration_seconds = data.durationSeconds;
    if (data.panelsViewed !== undefined)
      updateData.panels_viewed = data.panelsViewed;

    const [result] = await db
      .update(dashboardViews)
      .set(updateData as Partial<typeof dashboardViews.$inferInsert>)
      .where(
        and(
          eq(dashboardViews.org_id, orgId),
          eq(dashboardViews.session_id, sessionId),
        ),
      )
      .returning();
    return (result ?? null) as DashboardView | null;
  },

  findByDashboard: async (
    orgId: string,
    dashboardId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    },
  ): Promise<DashboardView[]> => {
    const conds = [
      eq(dashboardViews.org_id, orgId),
      eq(dashboardViews.dashboard_id, dashboardId),
    ];
    if (options?.startDate) {
      conds.push(gte(dashboardViews.started_at, options.startDate.toISOString()));
    }
    if (options?.endDate) {
      conds.push(lte(dashboardViews.started_at, options.endDate.toISOString()));
    }

    let query = db
      .select()
      .from(dashboardViews)
      .where(and(...conds))
      .orderBy(desc(dashboardViews.started_at))
      .$dynamic();

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    return (await query) as DashboardView[];
  },

  getStats: async (
    orgId: string,
    dashboardId: string,
    days: number = 30,
    offsetDays: number = 0,
  ): Promise<{
    totalViews: number;
    uniqueViewers: number;
    avgDuration: number;
  }> => {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - offsetDays);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    const conds = [
      eq(dashboardViews.org_id, orgId),
      eq(dashboardViews.dashboard_id, dashboardId),
      gte(dashboardViews.started_at, startDate.toISOString()),
    ];
    if (offsetDays > 0) {
      conds.push(lt(dashboardViews.started_at, endDate.toISOString()));
    }

    const [row] = await db
      .select({
        totalViews: sql<number>`count(*)`.mapWith(Number),
        uniqueViewers: sql<number>`count(distinct ${dashboardViews.session_id})`.mapWith(Number),
        avgDuration: sql<number>`coalesce(avg(${dashboardViews.duration_seconds}), 0)`.mapWith(Number),
      })
      .from(dashboardViews)
      .where(and(...conds));

    return {
      totalViews: row.totalViews,
      uniqueViewers: row.uniqueViewers,
      avgDuration: Math.round(row.avgDuration),
    };
  },

  getViewsByDay: async (
    orgId: string,
    dashboardId: string,
    days: number = 30,
  ): Promise<Array<{ date: string; views: number }>> => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Bucket in UTC explicitly — the zero-fill series below keys by UTC date
    // (toISOString), so DB-session-timezone bucketing would drift the two
    // apart for evening hours.
    const dayExpr = sql`date_trunc('day', ${dashboardViews.started_at}::timestamptz AT TIME ZONE 'UTC')`;
    const rows = await db
      .select({
        date: sql<string>`to_char(${dayExpr}, 'YYYY-MM-DD')`,
        views: sql<number>`count(*)`.mapWith(Number),
      })
      .from(dashboardViews)
      .where(
        and(
          eq(dashboardViews.org_id, orgId),
          eq(dashboardViews.dashboard_id, dashboardId),
          gte(dashboardViews.started_at, startDate.toISOString()),
        ),
      )
      .groupBy(dayExpr)
      .orderBy(dayExpr);

    const viewsByDate = new Map(rows.map((r) => [r.date, r.views]));

    const result: Array<{ date: string; views: number }> = [];
    const current = new Date(startDate);
    const end = new Date();
    while (current <= end) {
      const dateStr = current.toISOString().split("T")[0];
      result.push({ date: dateStr, views: viewsByDate.get(dateStr) ?? 0 });
      current.setDate(current.getDate() + 1);
    }

    return result;
  },
};

export const dashboardPermissionQueries = {
  findByDashboard: async (
    orgId: string,
    dashboardId: string,
  ): Promise<DashboardPermission[]> => {
    return (await db
      .select()
      .from(dashboardPermissions)
      .where(
        and(
          eq(dashboardPermissions.org_id, orgId),
          eq(dashboardPermissions.dashboard_id, dashboardId),
        ),
      )
      .orderBy(desc(dashboardPermissions.created_at))) as DashboardPermission[];
  },

  findByUser: async (
    orgId: string,
    userId: string,
  ): Promise<DashboardPermission[]> => {
    return (await db
      .select()
      .from(dashboardPermissions)
      .where(
        and(
          eq(dashboardPermissions.org_id, orgId),
          eq(dashboardPermissions.user_id, userId),
        ),
      )) as DashboardPermission[];
  },

  findByEmail: async (
    orgId: string,
    email: string,
  ): Promise<DashboardPermission[]> => {
    return (await db
      .select()
      .from(dashboardPermissions)
      .where(
        and(
          eq(dashboardPermissions.org_id, orgId),
          eq(dashboardPermissions.email, email.toLowerCase()),
        ),
      )) as DashboardPermission[];
  },

  create: async (
    orgId: string,
    dashboardId: string,
    invitedBy: string,
    data: {
      userId?: string;
      email?: string;
      accessLevel?: ShareLinkAccess;
    },
  ): Promise<DashboardPermission> => {
    const [result] = await db
      .insert(dashboardPermissions)
      .values({
        org_id: orgId,
        dashboard_id: dashboardId,
        user_id: data.userId ?? null,
        email: data.email?.toLowerCase() ?? null,
        access_level: data.accessLevel ?? "view",
        invited_by: invitedBy,
      } as typeof dashboardPermissions.$inferInsert)
      .returning();
    return result as DashboardPermission;
  },

  update: async (
    orgId: string,
    id: string,
    data: {
      accessLevel?: ShareLinkAccess;
      acceptedAt?: string;
    },
  ): Promise<DashboardPermission | null> => {
    const updateData: Record<string, unknown> = {};
    if (data.accessLevel !== undefined)
      updateData.access_level = data.accessLevel;
    if (data.acceptedAt !== undefined) updateData.accepted_at = data.acceptedAt;

    const [result] = await db
      .update(dashboardPermissions)
      .set(updateData as Partial<typeof dashboardPermissions.$inferInsert>)
      .where(
        and(
          eq(dashboardPermissions.org_id, orgId),
          eq(dashboardPermissions.id, id),
        ),
      )
      .returning();
    return (result ?? null) as DashboardPermission | null;
  },

  delete: async (orgId: string, id: string): Promise<boolean> => {
    await db
      .delete(dashboardPermissions)
      .where(
        and(
          eq(dashboardPermissions.org_id, orgId),
          eq(dashboardPermissions.id, id),
        ),
      );
    return true;
  },

  acceptInvite: async (
    orgId: string,
    email: string,
    userId: string,
  ): Promise<DashboardPermission[]> => {
    return (await db
      .update(dashboardPermissions)
      .set({
        user_id: userId,
        accepted_at: new Date().toISOString(),
      } as Partial<typeof dashboardPermissions.$inferInsert>)
      .where(
        and(
          eq(dashboardPermissions.org_id, orgId),
          eq(dashboardPermissions.email, email.toLowerCase()),
          isNull(dashboardPermissions.user_id),
        ),
      )
      .returning()) as DashboardPermission[];
  },
};
