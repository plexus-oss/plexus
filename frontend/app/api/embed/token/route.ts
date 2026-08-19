/**
 * POST /api/embed/token — mint a browser-safe, read-only, panel-scoped embed
 * token. SERVER-TO-SERVER only: the embedding company's backend calls this with
 * their `plx_` API key (x-api-key). Never call it from a browser — that would
 * expose the API key.
 *
 * Body: { dashboardId, panelId, expiresIn? }  (expiresIn seconds, clamped 60–3600)
 * → { token, expiresAt, expiresIn }
 *
 * Guards, in order: valid API key → org entitled to embed → dashboard owned by
 * that org → panel exists in that dashboard. The minted token can read ONLY that
 * one panel's data (enforced later by authorizeEmbedRead), so it is safe to send
 * to the org's own customers.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-keys";
import { adminDashboardQueries } from "@/lib/db/server";
import { mintEmbedToken, clampTtl } from "@/lib/auth/embed-token";
import { isEmbedEntitled } from "@/lib/embed/entitlement";
import type { DashboardConfig } from "@/lib/types/dashboard";

export async function POST(request: NextRequest) {
  // Server-to-server contract: require the API-key header explicitly so a
  // stray browser session can never mint an embed token.
  if (!request.headers.get("x-api-key")) {
    return NextResponse.json(
      { error: "x-api-key required (mint server-to-server, never from a browser)" },
      { status: 401 },
    );
  }

  const auth = await authenticateRequest(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // The embed capability is a paid entitlement; the API key's own scopes are not
  // the gate here (a write-only ingest key mints only read tokens for its OWN
  // org's panels — no escalation). A dedicated `embed` key scope is future
  // hardening handled with the pricing chunk.
  if (!isEmbedEntitled(auth.orgId)) {
    return NextResponse.json(
      { error: "Embed is not enabled for this organization" },
      { status: 403 },
    );
  }

  let body: { dashboardId?: unknown; panelId?: unknown; expiresIn?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dashboardId = typeof body.dashboardId === "string" ? body.dashboardId : "";
  const panelId = typeof body.panelId === "string" ? body.panelId : "";
  if (!dashboardId || !panelId) {
    return NextResponse.json(
      { error: "dashboardId and panelId are required" },
      { status: 400 },
    );
  }

  // Ownership: findById is org-scoped, so a dashboard from another org returns
  // empty → 404. A caller can never mint a token for a panel it doesn't own.
  const [dashboard] = await adminDashboardQueries.findById(auth.orgId, dashboardId);
  if (!dashboard) {
    return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
  }

  const config = dashboard.config as unknown as DashboardConfig;
  const panel = config?.panels?.find((p) => p.id === panelId);
  if (!panel) {
    return NextResponse.json(
      { error: "Panel not found in dashboard" },
      { status: 404 },
    );
  }

  const ttl = clampTtl(
    typeof body.expiresIn === "number" ? body.expiresIn : undefined,
  );
  const result = await mintEmbedToken(
    { orgId: auth.orgId, dashboardId, panelId },
    ttl,
  );
  return NextResponse.json(result);
}
