/**
 * PATCH  /api/org/members/[userId] — change a member's role (admin)
 * DELETE /api/org/members/[userId] — remove a member (admin)
 *
 * Both enforce the last-admin guard: an org can never end up with zero
 * org:admin members.
 */

import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { withRoleAuth, withPermission } from "@/lib/api/with-auth";
import { adminOrgMemberQueries, adminOrgRoleQueries } from "@/lib/db/server";
import { db } from "@/lib/db/client";
import { orgMembers } from "@/lib/db/schema";
import { emitSystemEvent } from "@/lib/events/emit";

const VALID_ROLES = new Set(["org:admin", "org:editor", "org:viewer"]);

async function adminCount(orgId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(orgMembers)
    .where(and(eq(orgMembers.org_id, orgId), eq(orgMembers.role, "org:admin")));
  return count ?? 0;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PATCH = withRoleAuth(
  ["org:admin"],
  async (request, { orgId, userId: actorId, params }) => {
    const { userId: targetId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      role?: string;
      // Source scoping: null = full org access; array (incl. empty) = restricted.
      allowedSourceIds?: string[] | null;
    };
    const hasScope = Object.prototype.hasOwnProperty.call(body, "allowedSourceIds");
    if (!body.role && !hasScope) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const membership = await adminOrgMemberQueries.findMembership(orgId, targetId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member" }, { status: 404 });
    }

    // --- Role change (with last-admin guard) ---
    if (body.role) {
      // Built-in, or an existing custom role id.
      if (!VALID_ROLES.has(body.role)) {
        const custom =
          UUID_RE.test(body.role) &&
          (await adminOrgRoleQueries.findById(orgId, body.role));
        if (!custom) {
          return NextResponse.json({ error: "Invalid role" }, { status: 400 });
        }
      }
      if (
        membership.role === "org:admin" &&
        body.role !== "org:admin" &&
        (await adminCount(orgId)) <= 1
      ) {
        return NextResponse.json(
          { error: "An organization needs at least one admin." },
          { status: 409 },
        );
      }
      await adminOrgMemberQueries.upsert(orgId, targetId, { role: body.role });
      // Admins are never scoped — clear any stale allow-list on promotion so
      // a later demotion doesn't silently re-activate it.
      if (body.role === "org:admin") {
        await adminOrgMemberQueries.setAllowedSourceIds(orgId, targetId, null);
      }
      emitSystemEvent({
        orgId,
        eventType: "member.role_changed",
        category: "member",
        title: `Role changed for ${membership.email ?? targetId}`,
        actorId,
        metadata: { targetUserId: targetId, from: membership.role, to: body.role },
      });
    }

    // --- Source scoping ---
    if (hasScope) {
      const allowed = body.allowedSourceIds;
      if (allowed !== null && !Array.isArray(allowed)) {
        return NextResponse.json(
          { error: "allowedSourceIds must be an array or null" },
          { status: 400 },
        );
      }
      // Admins bypass scoping in the resolver — refuse the confusing no-op.
      const effectiveRole = body.role ?? membership.role;
      if (allowed !== null && effectiveRole === "org:admin") {
        return NextResponse.json(
          {
            error:
              "Admins have unrestricted access; lower their role before scoping.",
          },
          { status: 409 },
        );
      }
      const clean =
        allowed === null
          ? null
          : [...new Set(allowed.filter((id) => UUID_RE.test(id)))];
      await adminOrgMemberQueries.setAllowedSourceIds(orgId, targetId, clean);
      emitSystemEvent({
        orgId,
        eventType: "member.scope_changed",
        category: "member",
        title: `Source scope changed for ${membership.email ?? targetId}`,
        actorId,
        metadata: {
          targetUserId: targetId,
          scoped: clean !== null,
          count: clean?.length ?? null,
        },
      });
    }


    return NextResponse.json({ ok: true });
  },
);

// Gated by the matrix action (default org:admin) so the Access matrix row is
// truthful — role changes (PATCH) stay hard-admin above.
export const DELETE = withPermission(
  "action-remove-member",
  async (_request, { orgId, userId: actorId, params }) => {
    const { userId: targetId } = await params;

    const membership = await adminOrgMemberQueries.findMembership(orgId, targetId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member" }, { status: 404 });
    }

    if (membership.role === "org:admin" && (await adminCount(orgId)) <= 1) {
      return NextResponse.json(
        { error: "An organization needs at least one admin." },
        { status: 409 },
      );
    }

    await adminOrgMemberQueries.delete(orgId, targetId);

    emitSystemEvent({
      orgId,
      eventType: "member.removed",
      category: "member",
      title: `Removed ${membership.email ?? targetId}`,
      actorId,
      metadata: { targetUserId: targetId },
    });

    return NextResponse.json({ ok: true });
  },
);
