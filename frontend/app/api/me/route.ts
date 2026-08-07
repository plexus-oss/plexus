/**
 * GET /api/me — current session identity + profile, provider-agnostic.
 *
 * Backs the authjs branch of usePlexusSession(). Returns nulls (200)
 * when signed out so the client shim doesn't special-case status codes.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users, orgMembers, orgBilling } from "@/lib/db/schema";

const SIGNED_OUT = {
  userId: null,
  orgId: null,
  orgRole: null,
  roleId: null,
  roleName: null,
  email: null,
  firstName: null,
  name: null,
  imageUrl: null,
  isStaff: false,
  impersonatingOrg: null,
};

export async function PATCH(request: Request) {
  const { userId } = await getAuth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    firstName?: string | null;
    lastName?: string | null;
  };
  const firstName = body.firstName?.trim() || null;
  const lastName = body.lastName?.trim() || null;
  await db
    .update(users)
    .set({ first_name: firstName, last_name: lastName } as Partial<typeof users.$inferInsert>)
    .where(eq(users.id, userId));
  // Keep the org_members mirror (activity feed, member lists) in sync.
  await db
    .update(orgMembers)
    .set({ first_name: firstName, last_name: lastName } as Partial<typeof orgMembers.$inferInsert>)
    .where(eq(orgMembers.user_id, userId));
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const { userId, orgId, orgRole, roleId, impersonating } = await getAuth();
  if (!userId) return NextResponse.json(SIGNED_OUT);

  // Display name for a held custom role (orgRole is always the base).
  let roleName: string | null = null;
  if (roleId && orgId) {
    const { adminOrgRoleQueries } = await import("@/lib/db/server");
    roleName = (await adminOrgRoleQueries.findById(orgId, roleId))?.name ?? null;
  }

  let impersonatingOrg: { id: string; name: string } | null = null;
  if (impersonating && orgId) {
    const orgRows = await db
      .select({ org_name: orgBilling.org_name })
      .from(orgBilling)
      .where(eq(orgBilling.org_id, orgId))
      .limit(1);
    impersonatingOrg = {
      id: orgId,
      name: orgRows[0]?.org_name ?? orgId,
    };
  }

  const rows = await db
    .select({
      email: users.email,
      first_name: users.first_name,
      last_name: users.last_name,
      image_url: users.image_url,
      is_staff: users.is_staff,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = (rows[0] ?? null) as {
    email: string;
    first_name: string | null;
    last_name: string | null;
    image_url: string | null;
    is_staff: boolean;
  } | null;

  return NextResponse.json({
    userId,
    orgId,
    orgRole,
    roleId: roleId ?? null,
    roleName,
    email: row?.email ?? null,
    firstName: row?.first_name ?? null,
    name: [row?.first_name, row?.last_name].filter(Boolean).join(" ") || null,
    imageUrl: row?.image_url ?? null,
    isStaff: row?.is_staff === true,
    impersonatingOrg,
  });
}
