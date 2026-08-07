/**
 * Internal Admin: remove a member from any org.
 *
 * DELETE /api/internal/orgs/[orgId]/members/[userId]
 *
 * Staff-only. Deliberately has NO last-admin guard (unlike the org-scoped
 * /api/org/members/[userId]) — staff must be able to empty an org, e.g.
 * ahead of deleting it. The UI shows role badges so the operator can see
 * when they're removing the last admin.
 */

import { NextResponse } from "next/server";
import { withPlexusStaff } from "@/lib/api/with-auth";
import { adminOrgMemberQueries } from "@/lib/db/server";
import { emitSystemEvent } from "@/lib/events/emit";

export const DELETE = withPlexusStaff(async (_request, { userId, params }) => {
  const { orgId, userId: targetId } = (await params) as {
    orgId: string;
    userId: string;
  };

  const membership = await adminOrgMemberQueries.findMembership(orgId, targetId);
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 404 });
  }

  await adminOrgMemberQueries.delete(orgId, targetId);

  emitSystemEvent({
    orgId,
    eventType: "member.removed",
    category: "member",
    title: `Removed ${membership.email ?? targetId} (Plexus staff)`,
    actorId: userId,
    metadata: { targetUserId: targetId, internal: true },
  });

  console.log("[internal] member removed", {
    staffUserId: userId,
    orgId,
    targetUserId: targetId,
  });

  return NextResponse.json({ ok: true });
});
