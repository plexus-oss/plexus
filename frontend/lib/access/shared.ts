/**
 * Shared resource-access primitives (RBAC).
 *
 * The "restricted opt-in" decision is identical for every resource type
 * (dashboards, devices, …): admin bypass → creator bypass → org-visible
 * (view-all / edit-needs-editor) → restricted (grant required). Keeping it in
 * ONE place means a change to the model can't silently drift between resources.
 *
 * Per-resource modules supply only their grant loader and a display noun.
 */

import { apiError } from "@/lib/api/errors";
import { meetsRole } from "./roles";
import type { OrgRole } from "@/lib/api/rbac";

export type AccessLevel = "view" | "edit";

export interface AccessResource {
  id: string;
  created_by: string | null;
}

/**
 * `isPrivate` is derived from the rules: a resource is private exactly when an
 * access rule names it (directly, or for a device via a granted fleet). Public
 * resources are visible to the whole org; private ones need a grant.
 */
export function canAccessResource(args: {
  orgRole: string | undefined;
  userId: string | undefined;
  resource: AccessResource;
  isPrivate: boolean;
  grants: Map<string, AccessLevel>;
  need: AccessLevel;
}): boolean {
  const { orgRole, userId, resource, isPrivate, grants, need } = args;
  if (orgRole === "org:admin") return true; // admin bypass
  if (userId && resource.created_by && resource.created_by === userId) {
    return true; // creator bypass
  }
  if (!isPrivate) {
    return need === "view"
      ? true
      : meetsRole(orgRole as OrgRole | undefined, "org:editor");
  }
  const level = grants.get(resource.id);
  if (!level) return false;
  return need === "view" ? true : level === "edit";
}

/**
 * Throw the right error on denial: NOT_FOUND when the user can't even view
 * (don't leak existence of a private resource), FORBIDDEN on edit-deny.
 */
export function assertResourceAccess(
  noun: string,
  ctx: { orgRole: string | undefined; userId: string | undefined },
  resource: AccessResource,
  isPrivate: boolean,
  grants: Map<string, AccessLevel>,
  need: AccessLevel,
): void {
  if (canAccessResource({ ...ctx, resource, isPrivate, grants, need })) return;
  const canView = canAccessResource({
    ...ctx,
    resource,
    isPrivate,
    grants,
    need: "view",
  });
  if (!canView) throw apiError("NOT_FOUND", `${noun} not found`);
  throw apiError(
    "FORBIDDEN",
    `You don't have edit access to this ${noun.toLowerCase()}`,
  );
}

/** Fold a grant into a most-permissive map (edit beats view). */
export function foldGrant(
  grants: Map<string, AccessLevel>,
  id: string,
  level: string,
): void {
  if (grants.get(id) === "edit") return;
  grants.set(id, level === "edit" ? "edit" : "view");
}
