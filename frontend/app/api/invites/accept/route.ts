/**
 * POST /api/invites/accept — redeem an invite token for org membership.
 *
 * Requires a session whose email matches the invited address (the invite
 * isn't a bearer grant — forwarding the email doesn't transfer it).
 * On success the org becomes active.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth/session";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth/constants";
import { hashInviteToken } from "@/lib/auth/invites";
import { adminOrgMemberQueries } from "@/lib/db/server";
import { db } from "@/lib/db/client";
import { orgInvites, users } from "@/lib/db/schema";
import { emitSystemEvent } from "@/lib/events/emit";

export async function POST(request: Request) {
  const { userId } = await getAuth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { token?: string };
  if (typeof body.token !== "string" || !body.token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const inviteRows = await db
    .select({
      id: orgInvites.id,
      org_id: orgInvites.org_id,
      email: orgInvites.email,
      role: orgInvites.role,
      allowed_source_ids: orgInvites.allowed_source_ids,
      expires_at: orgInvites.expires_at,
      accepted_at: orgInvites.accepted_at,
    })
    .from(orgInvites)
    .where(eq(orgInvites.token_hash, hashInviteToken(body.token)))
    .limit(1);

  const row = inviteRows[0] ?? null;

  if (!row || row.accepted_at || new Date(row.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "This invitation is invalid or has expired." },
      { status: 410 },
    );
  }

  const userRows = await db
    .select({
      email: users.email,
      first_name: users.first_name,
      last_name: users.last_name,
      image_url: users.image_url,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const profile = userRows[0] ?? null;

  if (!profile || profile.email.toLowerCase() !== row.email.toLowerCase()) {
    return NextResponse.json(
      {
        error: `This invitation was sent to ${row.email}. Sign in with that email to accept it.`,
      },
      { status: 403 },
    );
  }

  await adminOrgMemberQueries.upsert(row.org_id, userId, {
    email: profile.email,
    first_name: profile.first_name,
    last_name: profile.last_name,
    image_url: profile.image_url,
    role: row.role,
    // Scope chosen at invite time (null = full access).
    allowed_source_ids: row.allowed_source_ids,
  });

  await db
    .update(orgInvites)
    .set({ accepted_at: new Date().toISOString() } as Partial<
      typeof orgInvites.$inferInsert
    >)
    .where(eq(orgInvites.id, row.id));

  emitSystemEvent({
    orgId: row.org_id,
    eventType: "member.invited",
    category: "member",
    title: `${profile.email} joined`,
    actorId: userId,
    metadata: { email: profile.email, role: row.role, accepted: true },
  });

  const res = NextResponse.json({ ok: true, orgId: row.org_id });
  res.cookies.set(ACTIVE_ORG_COOKIE, row.org_id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
