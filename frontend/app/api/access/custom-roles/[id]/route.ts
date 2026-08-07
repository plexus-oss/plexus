/**
 * PATCH  /api/access/custom-roles/[id] — rename and/or apply permission
 *         exception changes: { name?, overrides?: { [actionId]: bool|null } }
 *         (null clears the exception → base default).
 * DELETE /api/access/custom-roles/[id]?reassignTo=<role value> — delete the
 *         role; members holding it move to `reassignTo` (a built-in or
 *         another custom role id). Admin only.
 */

import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { adminOrgRoleQueries } from "@/lib/db/server";
import { VALID_ROLES } from "@/lib/auth/org-role";
import { ACTION_IDS } from "@/lib/manifest/types";
import { emitSystemEvent } from "@/lib/events/emit";

const KNOWN_ACTIONS = new Set<string>(ACTION_IDS);

export const PATCH = withRoleAuth(
  ["org:admin"],
  async (request, { orgId, userId, params }) => {
    const { id } = await params;
    const role = await adminOrgRoleQueries.findById(orgId, id);
    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      overrides?: Record<string, boolean | null>;
    };

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name || name.length > 60) {
        return NextResponse.json(
          { error: "A role name (max 60 chars) is required" },
          { status: 400 },
        );
      }
      try {
        await adminOrgRoleQueries.rename(orgId, id, name);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          return NextResponse.json(
            { error: "A role with that name already exists" },
            { status: 409 },
          );
        }
        throw err;
      }
    }

    if (body.overrides && typeof body.overrides === "object") {
      const changes: Record<string, boolean | null> = {};
      for (const [actionId, allowed] of Object.entries(body.overrides)) {
        if (!KNOWN_ACTIONS.has(actionId)) continue; // ignore unknown ids
        if (allowed !== null && typeof allowed !== "boolean") continue;
        changes[actionId] = allowed;
      }
      await adminOrgRoleQueries.applyOverrides(orgId, id, changes);
    }

    emitSystemEvent({
      orgId,
      eventType: "member.role_changed",
      category: "member",
      title: `Updated role "${body.name?.trim() || role.name}"`,
      actorId: userId,
      metadata: { roleId: id },
    });
    return NextResponse.json({ ok: true });
  },
);

export const DELETE = withRoleAuth(
  ["org:admin"],
  async (request, { orgId, userId, params }) => {
    const { id } = await params;
    const role = await adminOrgRoleQueries.findById(orgId, id);
    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const reassignTo =
      new URL(request.url).searchParams.get("reassignTo") ?? "org:viewer";
    // Target must be a built-in (never admin via this path) or another
    // existing custom role.
    const validBuiltin =
      VALID_ROLES.has(reassignTo) && reassignTo !== "org:admin";
    const validCustom =
      !reassignTo.startsWith("org:") &&
      reassignTo !== id &&
      (await adminOrgRoleQueries.findById(orgId, reassignTo)) !== null;
    if (!validBuiltin && !validCustom) {
      return NextResponse.json(
        { error: "reassignTo must be viewer, editor, or another custom role" },
        { status: 400 },
      );
    }

    await adminOrgRoleQueries.reassignMembers(orgId, id, reassignTo);
    await adminOrgRoleQueries.delete(orgId, id); // exceptions cascade

    emitSystemEvent({
      orgId,
      eventType: "member.role_changed",
      category: "member",
      title: `Deleted role "${role.name}"`,
      actorId: userId,
      metadata: { roleId: id, reassignedTo: reassignTo },
    });
    return NextResponse.json({ ok: true });
  },
);
