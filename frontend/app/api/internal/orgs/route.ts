/**
 * Internal Admin: Org Search/List
 *
 * GET /api/internal/orgs?q=<search>&limit=<n>
 * Staff-only. Searches the org_billing mirror (name or org id) for the
 * admin org picker.
 */

import { NextResponse } from "next/server";
import { ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgBilling, orgMembers } from "@/lib/db/schema";
import { withPlexusStaff } from "@/lib/api/with-auth";

export const GET = withPlexusStaff(async (request) => {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);

  // Strip PostgREST or() syntax characters; escape ilike wildcards.
  const where = query
    ? (() => {
        const safe = query.replace(/[,()]/g, "").replace(/[%_]/g, "\\$&");
        return or(
          ilike(orgBilling.org_name, `%${safe}%`),
          ilike(orgBilling.org_id, `%${safe}%`),
        );
      })()
    : undefined;

  const rows = (await db
    .select({
      org_id: orgBilling.org_id,
      org_name: orgBilling.org_name,
      org_created_at: orgBilling.org_created_at,
      tier: orgBilling.tier,
    })
    .from(orgBilling)
    .where(where)
    // NULLS LAST matches the old PostgREST order({nullsFirst:false}); Postgres
    // DESC defaults to NULLS FIRST, which would float null-created orgs to the top.
    .orderBy(sql`${orgBilling.org_created_at} desc nulls last`)
    .limit(limit)) as Array<{
    org_id: string;
    org_name: string | null;
    org_created_at: string | null;
    tier: string;
  }>;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(orgBilling)
    .where(where);

  const memberCounts = new Map<string, number>();
  if (rows.length > 0) {
    const members = await db
      .select({ org_id: orgMembers.org_id })
      .from(orgMembers)
      .where(inArray(orgMembers.org_id, rows.map((r) => r.org_id)));
    for (const m of (members ?? []) as Array<{ org_id: string }>) {
      memberCounts.set(m.org_id, (memberCounts.get(m.org_id) ?? 0) + 1);
    }
  }

  const results = rows.map((r) => ({
    id: r.org_id,
    name: r.org_name ?? r.org_id,
    slug: null,
    membersCount: memberCounts.get(r.org_id) ?? 0,
    createdAt: r.org_created_at ? new Date(r.org_created_at).getTime() : 0,
    imageUrl: "",
    plan: r.tier === "tier_2" ? "enterprise" : "free",
  }));

  return NextResponse.json({ orgs: results, totalCount: count ?? results.length });
});
