/**
 * POST /api/embed/panels — BATCH embed data plane. A page hosting several
 * <PlexusPanel>s fetches them all in ONE request instead of N, so a multi-panel
 * embed doesn't multiply round-trips or burn the per-viewer rate budget.
 *
 * Body: { items: [{ token, dashboardId, panelId, timeRange? }] }  (max 20)
 * → { results: [{ panelId, panel, data } | { panelId, error, status }] }
 *
 * Each item is authorized by its OWN panel-scoped token (least privilege). All
 * authorized items must belong to ONE org (a batch is one customer's page); the
 * request Origin must be a verified embed origin for that org. Per-panel failures
 * (bad token, deleted panel) come back as per-item errors, not a whole-batch fail.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminEmbedOriginQueries } from "@/lib/db/server";
import { resolveAllowedOrigin, embedCorsHeaders } from "@/lib/embed/origins";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";
import { resolveEmbedPanel, isResolveError } from "@/lib/embed/resolve-panel";

const MAX_ITEMS = 20;

interface BatchItem {
  token: string;
  dashboardId: string;
  panelId: string;
  timeRange?: string;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: embedCorsHeaders(request.headers.get("origin")),
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const cors = (allowed: string | null) => embedCorsHeaders(allowed);

  // One batch = one request against the budget (per viewer IP).
  const rate = checkRateLimit(`embed-batch:${getClientIp(request)}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      {
        status: 429,
        headers: { ...cors(null), "Retry-After": String(rate.retryAfter ?? 60) },
      },
    );
  }

  let body: { items?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: cors(null) });
  }
  const items = Array.isArray(body.items) ? (body.items as BatchItem[]) : null;
  if (!items || items.length === 0) {
    return NextResponse.json(
      { error: "items[] is required" },
      { status: 400, headers: cors(null) },
    );
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `A batch may contain at most ${MAX_ITEMS} panels.` },
      { status: 400, headers: cors(null) },
    );
  }

  const resolved = await Promise.all(
    items.map((it) =>
      resolveEmbedPanel({
        token: typeof it?.token === "string" ? it.token : "",
        dashboardId: typeof it?.dashboardId === "string" ? it.dashboardId : "",
        panelId: typeof it?.panelId === "string" ? it.panelId : "",
        timeRange: typeof it?.timeRange === "string" ? it.timeRange : undefined,
      }),
    ),
  );

  // A batch belongs to one customer → one org. Reject cross-org batches.
  const orgs = new Set<string>();
  for (const r of resolved) if (r.orgId) orgs.add(r.orgId);
  if (orgs.size > 1) {
    return NextResponse.json(
      { error: "All panels in a batch must belong to one organization." },
      { status: 400, headers: cors(null) },
    );
  }
  const orgId = orgs.size === 1 ? [...orgs][0] : undefined;

  let allowedOrigin: string | null = null;
  if (orgId) {
    const verified = await adminEmbedOriginQueries.findVerifiedOrigins(orgId);
    allowedOrigin = resolveAllowedOrigin(origin, verified);
    if (origin && !allowedOrigin) {
      return NextResponse.json(
        { error: "This origin is not an allowed embed domain for this organization." },
        { status: 403, headers: cors(null) },
      );
    }
  }

  const results = resolved.map((r, i) =>
    isResolveError(r)
      ? { panelId: items[i]?.panelId ?? null, error: r.error, status: r.status }
      : { panelId: r.panel.id, panel: r.panel, data: r.data },
  );

  return NextResponse.json(
    { results },
    { headers: { ...cors(allowedOrigin), "Cache-Control": "private, max-age=5" } },
  );
}
