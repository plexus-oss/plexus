/**
 * Custom-role registry — per-request cached read of the org's custom roles
 * (name + base + per-action exceptions). Consulted by requirePermission for
 * members whose stored role is a custom role id, and served to the client by
 * GET /api/access/roles so UI gating mirrors the server.
 */

import "server-only";

import { cache } from "react";
import { adminOrgRoleQueries } from "@/lib/db/server";
import type { CustomRoleDef } from "./resolver";
import type { OrgRole } from "@/lib/api/rbac";

export const loadRoleRegistry = cache(
  async (orgId: string): Promise<Record<string, CustomRoleDef>> => {
    const [roles, overrides] = await Promise.all([
      adminOrgRoleQueries.findAll(orgId),
      adminOrgRoleQueries.findAllOverrides(orgId),
    ]);
    const registry: Record<string, CustomRoleDef> = {};
    for (const r of roles) {
      registry[r.id] = {
        id: r.id,
        name: r.name,
        base: r.base_role as OrgRole,
        overrides: {},
      };
    }
    for (const o of overrides) {
      registry[o.role_id]?.overrides &&
        (registry[o.role_id].overrides[o.action_id] = o.allowed);
    }
    return registry;
  },
);
