/**
 * Custom roles: base + per-action exceptions.
 *  - resolveStoredRole maps stored org_members.role values (built-in or
 *    custom role id) to {base, roleId}, falling back to viewer.
 *  - loadRoleRegistry serves the org's custom roles + exceptions.
 *  - canFor answers from exceptions first, then the base's manifest default.
 *
 * NOTE: resolvers use React cache() (memoized per module instance in tests) —
 * every case uses fresh org/user/role rows so no case reads another's memo.
 */

import { describe, it, expect } from "vitest";
import { db } from "../client";
import { orgMembers } from "../schema";
import { adminOrgRoleQueries } from "../server";
import { resolveStoredRole } from "@/lib/auth/org-role";
import { loadRoleRegistry } from "@/lib/access/role-registry";
import { canFor } from "@/lib/access/resolver";

let n = 0;
const freshOrg = () => `roles-org-${++n}`;

describe("resolveStoredRole", () => {
  it("passes built-ins through with no roleId", async () => {
    const r = await resolveStoredRole(freshOrg(), "org:editor");
    expect(r).toEqual({ base: "org:editor", roleId: null });
  });

  it("resolves a custom role id to its base + id", async () => {
    const org = freshOrg();
    const role = await adminOrgRoleQueries.create(org, {
      name: "Customer",
      base_role: "org:viewer",
      created_by: null,
    });
    const r = await resolveStoredRole(org, role.id);
    expect(r).toEqual({ base: "org:viewer", roleId: role.id });
  });

  it("falls back to viewer for unknown values", async () => {
    const r1 = await resolveStoredRole(freshOrg(), "org:member");
    expect(r1).toEqual({ base: "org:viewer", roleId: null });
    const r2 = await resolveStoredRole(
      freshOrg(),
      "00000000-0000-4000-8000-000000000000",
    );
    expect(r2).toEqual({ base: "org:viewer", roleId: null });
  });
});

describe("loadRoleRegistry + canFor", () => {
  it("custom role answers from exceptions, then base default", async () => {
    const org = freshOrg();
    const role = await adminOrgRoleQueries.create(org, {
      name: "Customer",
      base_role: "org:viewer",
      created_by: null,
    });
    await adminOrgRoleQueries.applyOverrides(org, role.id, {
      "action-new-dashboard": true, // grant above viewer base
    });

    const registry = await loadRoleRegistry(org);
    expect(registry[role.id].base).toBe("org:viewer");
    expect(registry[role.id].overrides).toEqual({
      "action-new-dashboard": true,
    });

    const ref = { base: "org:viewer" as const, roleId: role.id };
    // Exception grants an editor-level action to a viewer-based role.
    expect(canFor(ref, "action-new-dashboard", registry)).toBe(true);
    // No exception → base default (viewer can't delete dashboards).
    expect(canFor(ref, "action-delete-dashboard", registry)).toBe(false);
    // Viewer-available actions stay available.
    expect(canFor(ref, "action-acknowledge-alert", registry)).toBe(true);
  });

  it("exceptions can revoke a base-editor action", async () => {
    const org = freshOrg();
    const role = await adminOrgRoleQueries.create(org, {
      name: "Restricted Editor",
      base_role: "org:editor",
      created_by: null,
    });
    await adminOrgRoleQueries.applyOverrides(org, role.id, {
      "action-delete-device": false,
    });
    const registry = await loadRoleRegistry(org);
    const ref = { base: "org:editor" as const, roleId: role.id };
    expect(canFor(ref, "action-delete-device", registry)).toBe(false);
    expect(canFor(ref, "action-pair-device", registry)).toBe(true);
  });

  it("clearing an exception (null) restores the base default", async () => {
    const org = freshOrg();
    const role = await adminOrgRoleQueries.create(org, {
      name: "Temp",
      base_role: "org:viewer",
      created_by: null,
    });
    await adminOrgRoleQueries.applyOverrides(org, role.id, {
      "action-new-alert": true,
    });
    await adminOrgRoleQueries.applyOverrides(org, role.id, {
      "action-new-alert": null,
    });
    const registry = await loadRoleRegistry(org);
    expect(registry[role.id].overrides).toEqual({});
  });
});

describe("member reassignment", () => {
  it("moves members off a role before deletion", async () => {
    const org = freshOrg();
    const role = await adminOrgRoleQueries.create(org, {
      name: "Doomed",
      base_role: "org:viewer",
      created_by: null,
    });
    await db.insert(orgMembers).values({
      org_id: org,
      user_id: "user-1",
      role: role.id,
    } as typeof orgMembers.$inferInsert);

    expect(await adminOrgRoleQueries.countMembers(org, role.id)).toBe(1);
    await adminOrgRoleQueries.reassignMembers(org, role.id, "org:editor");
    expect(await adminOrgRoleQueries.countMembers(org, role.id)).toBe(0);
    await adminOrgRoleQueries.delete(org, role.id);

    const rows = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(eqOrg(org));
    expect(rows[0].role).toBe("org:editor");
  });
});

import { eq } from "drizzle-orm";
function eqOrg(org: string) {
  return eq(orgMembers.org_id, org);
}
