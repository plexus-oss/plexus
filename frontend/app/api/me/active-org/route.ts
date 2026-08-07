/**
 * POST /api/me/active-org — set the active-org cookie after validating
 * the caller actually belongs to that org. The cookie is only ever a
 * hint; getAuth() re-validates it on every request.
 */

import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth/constants";
import { adminOrgMemberQueries } from "@/lib/db/server";

export async function POST(request: Request) {
  const { userId } = await getAuth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { orgId?: string };
  if (typeof body.orgId !== "string" || !body.orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }

  const membership = await adminOrgMemberQueries.findMembership(
    body.orgId,
    userId,
  );
  if (!membership) {
    return NextResponse.json({ error: "Not a member of that org" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true, orgId: body.orgId });
  res.cookies.set(ACTIVE_ORG_COOKIE, body.orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
