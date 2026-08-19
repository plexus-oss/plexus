/**
 * Embed origins management — self-service, session-authed (Settings).
 *
 * GET  /api/embed/origins        — list the org's origins + verification status.
 * POST /api/embed/origins        — add an origin; returns the DNS TXT to publish.
 *
 * An origin authorizes CORS only once its domain ownership is verified
 * (POST .../[id]/verify). See lib/embed/origins.ts.
 */

import { NextResponse } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { adminEmbedOriginQueries } from "@/lib/db/server";
import {
  normalizeOrigin,
  domainOf,
  generateVerificationToken,
  verificationRecord,
} from "@/lib/embed/origins";
// NOTE: adding/verifying an origin is a security-relevant config change and
// should be recorded by the Phase-0 audit log (dedicated append-only table),
// not the fire-and-forget activity feed. Wired there, not here.

export const GET = withRoleAuth(
  ["org:admin", "org:editor"],
  async (_request, { orgId }) => {
    const rows = await adminEmbedOriginQueries.findAll(orgId);
    const origins = rows.map((r) => ({
      id: r.id,
      origin: r.origin,
      domain: r.domain,
      verified: r.verified_at !== null,
      verifiedAt: r.verified_at,
      createdAt: r.created_at,
      // The record stays visible so an unverified origin can be (re)published.
      record: r.verified_at
        ? null
        : verificationRecord(r.domain, r.verification_token),
    }));
    return NextResponse.json({ origins });
  },
);

export const POST = withRoleAuth(
  ["org:admin", "org:editor"],
  async (request, { orgId, userId }) => {
    let body: { origin?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const origin = normalizeOrigin(
      typeof body.origin === "string" ? body.origin : "",
    );
    if (!origin) {
      return NextResponse.json(
        {
          error:
            "Enter a valid origin, e.g. https://app.yourdomain.com (scheme + host, no path).",
        },
        { status: 400 },
      );
    }

    const domain = domainOf(origin)!;
    const token = generateVerificationToken();

    let row;
    try {
      row = await adminEmbedOriginQueries.create(orgId, {
        origin,
        domain,
        verification_token: token,
        created_by: userId,
      });
    } catch (err) {
      // Only a unique (org_id, origin) violation is "already added" (409); any
      // other DB error is a real 500, not a false duplicate.
      if ((err as { code?: string })?.code === "23505") {
        return NextResponse.json(
          { error: "That origin is already registered." },
          { status: 409 },
        );
      }
      throw err;
    }

    return NextResponse.json(
      {
        id: row.id,
        origin: row.origin,
        domain: row.domain,
        verified: false,
        record: verificationRecord(domain, token),
      },
      { status: 201 },
    );
  },
);
