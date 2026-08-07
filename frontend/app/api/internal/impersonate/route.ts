/**
 * Staff org impersonation.
 *
 * POST /api/internal/impersonate { orgId } — staff-only; sets the
 * impersonation cookie after validating the org exists. The cookie is
 * only ever a hint; getAuth() honors it solely for is_staff users,
 * re-checked on every request.
 *
 * DELETE /api/internal/impersonate — clears the cookie. Gated on a
 * plain session (not staff) so a just-revoked staff user can still
 * exit cleanly.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgBilling } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth/session";
import { IMPERSONATE_ORG_COOKIE } from "@/lib/auth/constants";
import { withPlexusStaff } from "@/lib/api/with-auth";

// 4h hygiene bound against forgotten sessions; the real authority is the
// per-request is_staff check in getAuth(), not the cookie lifetime.
const IMPERSONATION_MAX_AGE_SECONDS = 60 * 60 * 4;

export const POST = withPlexusStaff(async (request, { userId }) => {
  const body = (await request.json().catch(() => ({}))) as { orgId?: string };
  if (typeof body.orgId !== "string" || !body.orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }

  const rows = await db
    .select({ org_id: orgBilling.org_id })
    .from(orgBilling)
    .where(eq(orgBilling.org_id, body.orgId))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  console.log("[impersonation] start", { staffUserId: userId, orgId: body.orgId });

  const res = NextResponse.json({ ok: true, orgId: body.orgId });
  res.cookies.set(IMPERSONATE_ORG_COOKIE, body.orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: IMPERSONATION_MAX_AGE_SECONDS,
  });
  return res;
});

export async function DELETE() {
  const { userId } = await getAuth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[impersonation] stop", { staffUserId: userId });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(IMPERSONATE_ORG_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
