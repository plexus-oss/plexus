/**
 * GET /api/embed/panel — the browser-facing embed data plane. A <PlexusPanel>
 * calls this with its token to get exactly one panel's data. For multiple panels
 * on one page, prefer POST /api/embed/panels (batch).
 *
 * Contract:
 *   headers: x-embed-token: <token>
 *   query:   dashboardId, panelId, timeRange?
 *   → { panel: {id,type,title}, data: { "<source:metric>": [{timestamp,value,source_id}] } }
 *
 * Security: the token binds to exactly this dashboard+panel (resolveEmbedPanel);
 * the request Origin must be a VERIFIED embed origin for the token's org; metrics
 * come from stored panel config, never client params.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminEmbedOriginQueries } from "@/lib/db/server";
import { resolveAllowedOrigin, embedCorsHeaders } from "@/lib/embed/origins";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";
import { resolveEmbedPanel, isResolveError } from "@/lib/embed/resolve-panel";

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: embedCorsHeaders(request.headers.get("origin")),
  });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const cors = (allowed: string | null) => embedCorsHeaders(allowed);

  const token = request.headers.get("x-embed-token");
  if (!token) {
    return NextResponse.json(
      { error: "x-embed-token header is required" },
      { status: 401, headers: cors(null) },
    );
  }

  const rate = checkRateLimit(
    `embed-panel:${token.slice(0, 16)}:${getClientIp(request)}`,
    120,
    60_000,
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      {
        status: 429,
        headers: { ...cors(null), "Retry-After": String(rate.retryAfter ?? 60) },
      },
    );
  }

  const params = request.nextUrl.searchParams;
  const result = await resolveEmbedPanel({
    token,
    // Optional — the token already carries dashboard+panel.
    dashboardId: params.get("dashboardId") ?? undefined,
    panelId: params.get("panelId") ?? undefined,
    timeRange: params.get("timeRange") ?? undefined,
  });

  // Origin check (browser defense) once we know the org.
  let allowedOrigin: string | null = null;
  if (result.orgId) {
    const verified = await adminEmbedOriginQueries.findVerifiedOrigins(result.orgId);
    allowedOrigin = resolveAllowedOrigin(origin, verified);
    if (origin && !allowedOrigin) {
      return NextResponse.json(
        { error: "This origin is not an allowed embed domain for this organization." },
        { status: 403, headers: cors(null) },
      );
    }
  }

  if (isResolveError(result)) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status, headers: cors(allowedOrigin) },
    );
  }

  return NextResponse.json(
    { panel: result.panel, data: result.data },
    {
      headers: {
        ...cors(allowedOrigin),
        "Cache-Control": "private, max-age=5",
      },
    },
  );
}
