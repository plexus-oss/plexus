import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  adminDashboardShareQueries,
  adminDashboardQueries,
  adminSourceQueries,
} from "@/lib/db/server";
import { runQueries } from "@/lib/db/queries/runs";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";
import { cachedJson } from "@/lib/utils";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

interface RouteParams {
  params: Promise<{ token: string }>;
}

/**
 * GET /api/shared/[token]/runs — test runs visible to a shared dashboard
 * (public access; powers the Compare picker on shared links).
 *
 * Same token-validation ladder as /api/shared/[token]/telemetry. Scope:
 * only runs on sources this dashboard actually plots (plus org-wide runs
 * with no source), and only the fields the picker needs — a share link
 * exposes the dashboard's data, not the org's whole run library.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;

    const rate = checkRateLimit(
      `shared-runs:${token}:${getClientIp(request)}`,
      60,
      60_000,
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } },
      );
    }

    const providedPassword = request.nextUrl.searchParams.get("password");

    const shareLink = await adminDashboardShareQueries.findByToken(token);
    if (!shareLink) {
      return NextResponse.json({ error: "Share link not found" }, { status: 404 });
    }
    if (shareLink.status !== "active") {
      return NextResponse.json(
        { error: "This share link has been revoked" },
        { status: 403 },
      );
    }
    if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "This share link has expired" },
        { status: 403 },
      );
    }
    if (
      shareLink.max_views !== null &&
      shareLink.view_count >= shareLink.max_views
    ) {
      return NextResponse.json(
        { error: "This share link has reached its maximum view limit" },
        { status: 403 },
      );
    }
    if (shareLink.password_hash) {
      if (!providedPassword) {
        return NextResponse.json(
          { error: "Password required", requiresPassword: true },
          { status: 401 },
        );
      }
      if (hashPassword(providedPassword) !== shareLink.password_hash) {
        return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
      }
    }

    const orgId = shareLink.org_id;

    // Collect the source refs (slugs or uuids) the dashboard's panels plot
    // and resolve them to uuids for matching against runs.source_id.
    const [dashboard] = await adminDashboardQueries.findById(
      orgId,
      shareLink.dashboard_id,
    );
    const refs = new Set<string>();
    const dashConfig = dashboard?.config as
      | {
          panels?: Array<{
            sources?: string[];
            metrics?: string[];
            config?: { sourceId?: string };
          }>;
        }
      | null
      | undefined;
    const panels = dashConfig?.panels ?? [];
    for (const p of panels) {
      if (p.config?.sourceId) refs.add(p.config.sourceId);
      for (const s of p.sources ?? []) refs.add(s);
      for (const m of p.metrics ?? []) {
        // "source:metric" keys — the prefix is a source ref
        const i = m.lastIndexOf(":");
        if (i > 0) refs.add(m.substring(0, i));
      }
    }
    const allowedSourceIds = new Set<string>();
    await Promise.all(
      Array.from(refs).map(async (ref) => {
        const src = await adminSourceQueries.resolveRef(orgId, ref);
        if (src) allowedSourceIds.add(src.id);
      }),
    );

    const runs = (await runQueries.findByOrg(orgId)).filter(
      (r) => !r.source_id || allowedSourceIds.has(r.source_id),
    );

    return cachedJson(
      {
        runs: runs.map((r) => ({
          id: r.id,
          name: r.name,
          source_id: r.source_id,
          status: r.status,
          started_at: r.started_at,
          ended_at: r.ended_at,
        })),
      },
      { maxAge: 5, staleWhileRevalidate: 15 },
    );
  } catch (error) {
    console.error("Shared runs query error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
