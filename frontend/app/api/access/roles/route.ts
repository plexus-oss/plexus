import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { buildCatalog } from "@/lib/access/resolver";
import { loadRoleRegistry } from "@/lib/access/role-registry";
import { loadEffectiveScope } from "@/lib/access/scope";

/**
 * GET /api/access/roles — the permission catalog (from the manifest), the
 * org's CUSTOM roles (name + base + exceptions), and whether the CALLER is
 * scope-restricted. Built-in roles are fixed at manifest defaults — there is
 * no override editing; all customization lives in custom roles (see
 * /api/access/custom-roles).
 *
 * Available to any org member: every authenticated user needs it to gate UI.
 */
export const GET = withAuth(async (_request, { orgId, userId, roleId }) => {
  const [catalog, registry, scope] = await Promise.all([
    Promise.resolve(buildCatalog()),
    loadRoleRegistry(orgId),
    loadEffectiveScope(orgId, userId),
  ]);
  const scoped = scope.sourceIds !== null;
  return NextResponse.json({
    catalog,
    customRoles: Object.values(registry),
    callerRoleId: roleId ?? null,
    scoped,
  });
});
