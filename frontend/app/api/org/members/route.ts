/**
 * GET /api/org/members — list the current org's members from the
 * org_members mirror.
 */

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api/with-auth";
import { db } from "@/lib/db/client";
import { orgMembers } from "@/lib/db/schema";

export const GET = withAuth(async (_req, { orgId, orgRole }) => {
  const isAdmin = orgRole === "org:admin";
  const data = await db
    .select({
      user_id: orgMembers.user_id,
      email: orgMembers.email,
      first_name: orgMembers.first_name,
      last_name: orgMembers.last_name,
      image_url: orgMembers.image_url,
      role: orgMembers.role,
      allowed_source_ids: orgMembers.allowed_source_ids,
    })
    .from(orgMembers)
    .where(eq(orgMembers.org_id, orgId))
    .orderBy(asc(orgMembers.created_at));

  const members = data.map((m) => ({
    userId: m.user_id,
    email: m.email,
    firstName: m.first_name,
    lastName: m.last_name,
    name: [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email || m.user_id,
    imageUrl: m.image_url,
    role: m.role,
    // Scope config is admin-facing; non-admins get the identity fields only.
    // null = full org access; array (incl. empty) = restricted to these sources.
    allowedSourceIds: isAdmin ? m.allowed_source_ids ?? null : null,
  }));

  return NextResponse.json({ members });
});
