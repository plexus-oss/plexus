/**
 * POST /api/orgs — create an organization. Creator becomes org:admin and
 * the new org becomes active.
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth/session";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth/constants";
import {
  adminOrgBillingQueries,
  adminOrgMemberQueries,
} from "@/lib/db/server";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { sendWelcomeDrip } from "@/lib/email/drip";

export async function POST(request: Request) {
  const { userId } = await getAuth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name || name.length > 100) {
    return NextResponse.json(
      { error: "name is required (max 100 chars)" },
      { status: 400 },
    );
  }

  const orgId = `org_${randomUUID().replace(/-/g, "")}`;

  await adminOrgBillingQueries.upsert(orgId, {
    org_name: name,
    org_created_at: new Date().toISOString(),
    tier: "tier_1",
  });

  // Creator profile from the users mirror for the membership row.
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
  const profile = (userRows[0] ?? null) as {
    email: string;
    first_name: string | null;
    last_name: string | null;
    image_url: string | null;
  } | null;

  await adminOrgMemberQueries.upsert(orgId, userId, {
    email: profile?.email ?? null,
    first_name: profile?.first_name ?? null,
    last_name: profile?.last_name ?? null,
    image_url: profile?.image_url ?? null,
    role: "org:admin",
  });

  // Welcome drip — fires the moment the org exists, mirroring the original
  // org-created webhook. Idempotent via the per-org marker, so a retried
  // request won't double-send; a failure must never break org creation.
  try {
    await sendWelcomeDrip(orgId);
  } catch (error) {
    console.error(`[orgs] welcome drip failed for ${orgId}:`, error);
  }

  const res = NextResponse.json({ orgId, name });
  res.cookies.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
