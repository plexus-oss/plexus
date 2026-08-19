/**
 * DELETE /api/embed/publishes/[id] — revoke a published embed. The token stops
 * working immediately (embed reads check revoked_at); the row is kept for audit.
 */

import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { adminEmbedPublishQueries } from "@/lib/db/server";

export const DELETE = withRoleAuth(
  ["org:admin", "org:editor"],
  async (_request, { orgId, params }) => {
    const { id } = await params;
    const row = await adminEmbedPublishQueries.revoke(orgId, id);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  },
);
