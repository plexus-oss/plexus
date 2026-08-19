/**
 * DELETE /api/embed/origins/[id] — remove an origin. Once removed, embeds from
 * that origin stop being authorized on the next request (no ACAO reflected).
 */

import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { adminEmbedOriginQueries } from "@/lib/db/server";

export const DELETE = withRoleAuth(
  ["org:admin", "org:editor"],
  async (_request, { orgId, params }) => {
    const { id } = await params;
    const row = await adminEmbedOriginQueries.findById(orgId, id);
    if (!row) {
      return NextResponse.json({ error: "Origin not found" }, { status: 404 });
    }
    await adminEmbedOriginQueries.delete(orgId, id);
    return NextResponse.json({ ok: true });
  },
);
