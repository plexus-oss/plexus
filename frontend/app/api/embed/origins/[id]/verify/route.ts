/**
 * POST /api/embed/origins/[id]/verify — check the DNS TXT record and, if it
 * matches, mark the origin verified. Idempotent: an already-verified origin
 * returns verified. On failure, returns the record to (re)publish.
 */

import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { adminEmbedOriginQueries } from "@/lib/db/server";
import { verifyDomainOwnership, verificationRecord } from "@/lib/embed/origins";

export const POST = withRoleAuth(
  ["org:admin", "org:editor"],
  async (_request, { orgId, params }) => {
    const { id } = await params;
    const row = await adminEmbedOriginQueries.findById(orgId, id);
    if (!row) {
      return NextResponse.json({ error: "Origin not found" }, { status: 404 });
    }
    if (row.verified_at) {
      return NextResponse.json({ verified: true, verifiedAt: row.verified_at });
    }

    const ok = await verifyDomainOwnership(row.domain, row.verification_token);
    if (!ok) {
      return NextResponse.json(
        {
          verified: false,
          error:
            "The DNS TXT record wasn't found yet. It can take a few minutes to propagate — publish it and try again.",
          record: verificationRecord(row.domain, row.verification_token),
        },
        { status: 422 },
      );
    }

    const updated = await adminEmbedOriginQueries.markVerified(orgId, id);
    return NextResponse.json({
      verified: true,
      verifiedAt: updated?.verified_at ?? null,
    });
  },
);
