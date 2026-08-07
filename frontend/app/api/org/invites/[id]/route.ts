/**
 * DELETE /api/org/invites/[id] — revoke a pending invite (admin).
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withRoleAuth } from "@/lib/api/with-auth";
import { db } from "@/lib/db/client";
import { orgInvites } from "@/lib/db/schema";

export const DELETE = withRoleAuth(["org:admin"], async (_req, { orgId, params }) => {
  const { id } = await params;
  await db
    .delete(orgInvites)
    .where(and(eq(orgInvites.org_id, orgId), eq(orgInvites.id, id)));
  return NextResponse.json({ ok: true });
});
