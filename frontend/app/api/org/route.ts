/**
 * PATCH /api/org — rename the active org. Admin only.
 */

import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { adminOrgBillingQueries } from "@/lib/db/server";
import { clearOrgCache } from "@/lib/billing/server";

export const PATCH = withRoleAuth(["org:admin"], async (request, { orgId }) => {
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name || name.length > 100) {
    return NextResponse.json(
      { error: "name is required (max 100 chars)" },
      { status: 400 },
    );
  }
  await adminOrgBillingQueries.patch(orgId, { org_name: name });
  clearOrgCache(orgId);
  return NextResponse.json({ orgId, name });
});
