/**
 * GET /api/embed/frame-origins?token=emb_... — the framing allowlist for a hosted
 * embed. Middleware calls this to build the `Content-Security-Policy:
 * frame-ancestors` header on the /embed/<token> document, so the browser only lets
 * the token org's DNS-verified domains iframe it. Public (authed by the token
 * itself); returns [] for an unknown/revoked token, which becomes frame-ancestors
 * 'none' — framable nowhere.
 *
 * Node runtime: it reads Postgres (the edge middleware that calls it cannot).
 */

import { NextResponse } from "next/server";
import { isDurableEmbedToken, resolveDurableToken } from "@/lib/embed/publish";
import { adminEmbedOriginQueries } from "@/lib/db/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token || !isDurableEmbedToken(token)) {
    return NextResponse.json({ origins: [] });
  }
  const scope = await resolveDurableToken(token);
  if (!scope) return NextResponse.json({ origins: [] });

  const origins = await adminEmbedOriginQueries.findVerifiedOrigins(scope.orgId);
  // Short private cache: framing rarely changes, but a revoke/new-domain should
  // take effect within a minute without a redeploy.
  return NextResponse.json(
    { origins },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
