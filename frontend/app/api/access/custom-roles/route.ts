/**
 * POST /api/access/custom-roles — create a custom role (admin).
 * Body: { name, base: "org:viewer" | "org:editor" }
 */

import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { adminOrgRoleQueries } from "@/lib/db/server";
import { emitSystemEvent } from "@/lib/events/emit";
import { entitled, FEATURE_RBAC } from "@/lib/licensing";

const VALID_BASES = new Set(["org:viewer", "org:editor"]);

export const POST = withRoleAuth(
  ["org:admin"],
  async (request, { orgId, userId }) => {
    // Custom roles are enterprise; built-in roles (single-team auth) are free.
    // Expired key ⇒ existing roles keep resolving, only creation is blocked.
    if (!entitled(FEATURE_RBAC)) {
      return NextResponse.json(
        {
          error: "Custom roles require an enterprise license",
          code: "license_required",
        },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      base?: string;
    };
    const name = body.name?.trim();
    const base = body.base ?? "org:viewer";
    if (!name || name.length > 60) {
      return NextResponse.json(
        { error: "A role name (max 60 chars) is required" },
        { status: 400 },
      );
    }
    if (!VALID_BASES.has(base)) {
      return NextResponse.json(
        { error: "base must be org:viewer or org:editor" },
        { status: 400 },
      );
    }
    // Don't shadow the built-ins' display names.
    if (["viewer", "editor", "admin"].includes(name.toLowerCase())) {
      return NextResponse.json(
        { error: "That name is reserved for a built-in role" },
        { status: 409 },
      );
    }

    try {
      const role = await adminOrgRoleQueries.create(orgId, {
        name,
        base_role: base,
        created_by: userId,
      });
      emitSystemEvent({
        orgId,
        eventType: "member.role_changed",
        category: "member",
        title: `Created role "${name}"`,
        actorId: userId,
        metadata: { roleId: role.id, base },
      });
      return NextResponse.json({ role });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "A role with that name already exists" },
          { status: 409 },
        );
      }
      throw err;
    }
  },
);
