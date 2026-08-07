/**
 * GET /api/me/orgs — the current user's org memberships with names,
 * plus which org is active. Backs the authjs org switcher / org guard.
 */

import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { getAuth } from "@/lib/auth/session";
import { adminOrgMemberQueries } from "@/lib/db/server";
import { db } from "@/lib/db/client";
import { orgBilling } from "@/lib/db/schema";

export async function GET() {
  const { userId, orgId: activeOrgId } = await getAuth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memberships = await adminOrgMemberQueries.findByUser(userId);
  type OrgInfo = { org_name: string | null; logo_url: string | null };
  let info = new Map<string, OrgInfo>();
  if (memberships.length > 0) {
    const data = await db
      .select({
        org_id: orgBilling.org_id,
        org_name: orgBilling.org_name,
        logo_url: orgBilling.logo_url,
      })
      .from(orgBilling)
      .where(inArray(orgBilling.org_id, memberships.map((m) => m.org_id)));
    info = new Map(
      ((data ?? []) as ({ org_id: string } & OrgInfo)[]).map((r) => [
        r.org_id,
        r,
      ]),
    );
  }

  return NextResponse.json({
    activeOrgId,
    orgs: memberships.map((m) => ({
      orgId: m.org_id,
      name: info.get(m.org_id)?.org_name ?? m.org_id,
      imageUrl: info.get(m.org_id)?.logo_url ?? null,
      role: m.role,
    })),
  });
}
