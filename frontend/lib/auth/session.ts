/**
 * Server-side auth read. Every server-side auth read goes through
 * getAuth(): an Auth.js DB session plus an active-org cookie.
 *
 * Active-org rule (security-critical): the cookie is a HINT, never an
 * authority. Every getAuth() call validates the cookie value against
 * org_members; a missing/foreign membership resolves orgId from the
 * user's real memberships (sole membership, else oldest) or null. A
 * client can therefore never read another org's data by editing the
 * cookie — the worst forgery outcome is selecting an org they already
 * belong to.
 *
 * Impersonation rule (security-critical): the impersonation cookie is
 * likewise only a hint — it is honored solely when users.is_staff is
 * true, re-checked on every request. Non-staff (including just-revoked
 * staff) fall through to normal org resolution, so a forged cookie is
 * inert. Set/cleared by POST/DELETE /api/internal/impersonate.
 */

import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { adminOrgMemberQueries } from "@/lib/db/server";
import { resolveStoredRole } from "./org-role";
import { ACTIVE_ORG_COOKIE, IMPERSONATE_ORG_COOKIE } from "./constants";

export { ACTIVE_ORG_COOKIE, IMPERSONATE_ORG_COOKIE };

/** Role granted to staff while impersonating — the single policy knob. */
export const IMPERSONATION_ORG_ROLE = "org:admin";

export interface AuthState {
  userId: string | null;
  orgId: string | null;
  /**
   * Always a BUILT-IN role (custom roles resolve to their base here) — every
   * rank-style check downstream stays simple. The held custom role, if any,
   * is `roleId`.
   */
  orgRole: string | null;
  /** Custom role id (org_roles.id) when the member holds one. */
  roleId: string | null;
  /** True when a staff user is impersonating another org. */
  impersonating: boolean;
}

const SIGNED_OUT: AuthState = {
  userId: null,
  orgId: null,
  orgRole: null,
  roleId: null,
  impersonating: false,
};

async function authjsGetAuth(): Promise<AuthState> {
  const { authjsSession } = await import("./authjs");
  const session = await authjsSession();
  const userId = session?.user?.id;
  if (!userId) return SIGNED_OUT;

  const cookieStore = await cookies();

  // 0. Staff impersonation hint, honored only when is_staff (re-checked
  //    per request; a forged cookie from a non-staff user is ignored).
  const impersonated = cookieStore.get(IMPERSONATE_ORG_COOKIE)?.value;
  if (impersonated) {
    // Dynamic import: plexus-staff statically imports getAuth from here.
    const { isPlexusStaffById } = await import("./plexus-staff");
    if (await isPlexusStaffById(userId)) {
      return {
        userId,
        orgId: impersonated,
        orgRole: IMPERSONATION_ORG_ROLE,
        roleId: null,
        impersonating: true,
      };
    }
  }

  // 1. Cookie hint, validated against a real membership row.
  const hinted = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  if (hinted) {
    const membership = await adminOrgMemberQueries.findMembership(
      hinted,
      userId,
    );
    if (membership) {
      const resolved = await resolveStoredRole(membership.org_id, membership.role);
      return {
        userId,
        orgId: membership.org_id,
        orgRole: resolved.base,
        roleId: resolved.roleId,
        impersonating: false,
      };
    }
  }

  // 2. No (valid) hint: fall back to the user's memberships.
  const memberships = await adminOrgMemberQueries.findByUser(userId);
  if (memberships.length === 0) {
    return { userId, orgId: null, orgRole: null, roleId: null, impersonating: false };
  }
  // Sole membership, else oldest — deterministic across requests.
  const chosen = memberships[0];
  const resolved = await resolveStoredRole(chosen.org_id, chosen.role);
  return {
    userId,
    orgId: chosen.org_id,
    orgRole: resolved.base,
    roleId: resolved.roleId,
    impersonating: false,
  };
}

/**
 * Read the current request's auth state:
 *
 *   const { userId, orgId, orgRole } = await getAuth();
 *
 * Wrapped in React cache() so a single server render (layout + page +
 * nested components) resolves the session once instead of repeating the
 * DB lookups. Outside a render (route handlers) it's a transparent
 * passthrough.
 */
export const getAuth = cache(authjsGetAuth);
