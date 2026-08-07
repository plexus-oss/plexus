/**
 * Role hierarchy primitives — the leaf module of the access layer.
 *
 * Kept dependency-free (only the OrgRole type) so both `lib/manifest` and
 * `lib/access/resolver` can import it without a circular dependency.
 */

import type { OrgRole } from "@/lib/api/rbac";

/** Higher number = more privileged. viewer < editor < admin. */
export const ROLE_HIERARCHY: Record<OrgRole, number> = {
  "org:viewer": 0,
  "org:editor": 1,
  "org:admin": 2,
};

/** True if `userRole` meets or exceeds the `required` minimum role. */
export function meetsRole(
  userRole: OrgRole | undefined,
  required: OrgRole,
): boolean {
  if (!userRole) return false;
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];
}
