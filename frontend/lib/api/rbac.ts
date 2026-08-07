/**
 * Role-Based Access Control (RBAC)
 *
 * Org roles are app-owned: org:admin, org:editor, org:viewer, stored in the
 * org_members table (lib/auth/org-role.ts resolves them; identity comes from
 * the users table). Use requireRole() in API routes to gate actions by role.
 */

import { apiError } from "./errors";
import type { AuthContext } from "./with-auth";

export type OrgRole = "org:admin" | "org:editor" | "org:viewer";

/**
 * Throws ApiError(FORBIDDEN) if the user's role isn't in the allowed list.
 * Call inside a withAuth handler after destructuring ctx.
 */
export function requireRole(
  ctx: Pick<AuthContext, "orgRole">,
  ...roles: OrgRole[]
): void {
  if (!ctx.orgRole || !roles.includes(ctx.orgRole as OrgRole)) {
    throw apiError("FORBIDDEN", "Insufficient permissions for this action");
  }
}
