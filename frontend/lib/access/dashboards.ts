/**
 * Dashboard access resolver, built on the resource-access factory.
 * "Private = has a rule": a dashboard is private when any grant names it;
 * otherwise it's org-visible (view for everyone, edit needs editor+).
 *
 * The decision logic lives in lib/access/shared.ts so it can't drift from the
 * device resolver; this module supplies only the grant queries.
 */

import "server-only";

import { adminDashboardGrantQueries } from "@/lib/db/server";
import { canAccessResource, type AccessLevel } from "./shared";
import { createResourceAccess } from "./resource-access";

export type { AccessLevel } from "./shared";

const access = createResourceAccess({
  noun: "Dashboard",

  loadGrantRows: async (orgId, userId, orgRole) => {
    const rows = await adminDashboardGrantQueries.findDashboardGrantsForUser(
      orgId,
      userId,
      orgRole,
    );
    return rows.map((r) => ({
      resourceId: r.dashboard_id,
      accessLevel: r.access_level,
    }));
  },

  loadPrivateIds: async (orgId) =>
    new Set(await adminDashboardGrantQueries.findPrivateDashboardIds(orgId)),
});

/** dashboardId → the user's most-permissive grant level. */
export const loadUserDashboardGrants = access.loadUserGrants;
/** Dashboards that have any access rule → private. Empty in the common case. */
export const loadPrivateDashboardIds = access.loadPrivateIds;
export const assertDashboardAccess = access.assertAccess;
export const enforceDashboard = access.enforce;

/** Pure decision — no IO. Admin and creator always pass. */
export function canAccessDashboard(args: {
  orgRole: string | undefined;
  userId: string | undefined;
  dashboard: { id: string; created_by: string | null };
  isPrivate: boolean;
  grants: Map<string, AccessLevel>;
  need: AccessLevel;
}): boolean {
  return canAccessResource({
    orgRole: args.orgRole,
    userId: args.userId,
    resource: args.dashboard,
    isPrivate: args.isPrivate,
    grants: args.grants,
    need: args.need,
  });
}
