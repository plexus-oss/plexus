"use client";

/**
 * Client-side role hook.
 *
 * Returns the current user's organization role and convenience booleans.
 */

import { usePlexusSession } from "@/hooks/use-plexus-session";
import type { OrgRole } from "@/lib/api/rbac";

export type { OrgRole };

export function useRole() {
  const { orgRole, roleId, roleName } = usePlexusSession();
  // Always a BASE role — custom roles resolve server-side; their id/name
  // travel alongside for permission-exception checks and display.
  const role = (orgRole as OrgRole) || undefined;

  return {
    role,
    roleId: roleId ?? null,
    roleName: roleName ?? null,
    isAdmin: role === "org:admin",
    canEdit: role === "org:admin" || role === "org:editor",
    canView: true,
  };
}
