/**
 * App-owned org role resolution.
 *
 * Roles live in the org_members table — the org_members row is the single
 * source of truth, written at org creation and invite acceptance. A stored
 * value is either a built-in ("org:viewer" | "org:editor" | "org:admin") or a
 * CUSTOM role id (org_roles.id). Custom roles resolve to their base role for
 * every rank-style check; the id travels alongside for permission-exception
 * and grant matching.
 */

import "server-only";

import { cache } from "react";
import { adminOrgMemberQueries, adminOrgRoleQueries } from "@/lib/db/server";
import type { OrgRole } from "@/lib/api/rbac";

export const VALID_ROLES = new Set<string>([
  "org:admin",
  "org:editor",
  "org:viewer",
]);

export interface ResolvedRole {
  /** Built-in role used for all rank checks (custom roles → their base). */
  base: OrgRole;
  /** The custom role id when the member holds one, else null. */
  roleId: string | null;
}

/**
 * Resolve a STORED role value (from org_members) to {base, roleId}. Unknown
 * values fall back to viewer (least privilege).
 */
export const resolveStoredRole = cache(
  async (orgId: string, stored: string | null): Promise<ResolvedRole> => {
    if (stored && VALID_ROLES.has(stored)) {
      return { base: stored as OrgRole, roleId: null };
    }
    if (stored && !stored.startsWith("org:")) {
      const custom = await adminOrgRoleQueries.findById(orgId, stored);
      if (custom) {
        return { base: custom.base_role as OrgRole, roleId: custom.id };
      }
    }
    return { base: "org:viewer", roleId: null };
  },
);

/**
 * Resolve the member's app role from org_members. The session already
 * carries the resolved role; this re-reads it as the authority and, on a
 * missing row, falls back to the session role (else least-privilege) and
 * lazily backfills. Memoized per request.
 */
export const resolveOrgRoleFull = cache(
  async (
    orgId: string,
    userId: string,
    sessionRole?: string | null,
  ): Promise<ResolvedRole> => {
    const stored = await adminOrgMemberQueries.findRole(orgId, userId);
    if (stored) return resolveStoredRole(orgId, stored);
    const fallback: OrgRole =
      sessionRole && VALID_ROLES.has(sessionRole)
        ? (sessionRole as OrgRole)
        : "org:viewer";
    await adminOrgMemberQueries.insertIfAbsent(orgId, userId, fallback);
    return { base: fallback, roleId: null };
  },
);

/** Back-compat: just the base role. */
export async function resolveOrgRole(
  orgId: string,
  userId: string,
  sessionRole?: string | null,
): Promise<OrgRole> {
  return (await resolveOrgRoleFull(orgId, userId, sessionRole)).base;
}
