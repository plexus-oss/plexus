/**
 * POST /api/ai/suggest-thresholds
 *
 * Returns statistical threshold suggestions for a source's numeric metrics.
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { sourceQueries, sourceLimitQueries } from "@/lib/db";
import { suggestThresholds } from "@/lib/ai/threshold-suggestions";
import { checkRateLimit } from "@/lib/rate-limiter";

export const POST = withDualAuth(async (request, { orgId }) => {
  // Compute-heavy suggestion generation — limit per org
  const rate = checkRateLimit(`suggest-thresholds:${orgId}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } },
    );
  }

  const body = await request.json();

  const { sourceId } = body as { sourceId?: string };

  if (!sourceId || typeof sourceId !== "string") {
    return NextResponse.json(
      { error: "sourceId is required" },
      { status: 400 },
    );
  }

  // Resolve UUID to slug (ClickHouse uses slug as source_id)
  const sources = await sourceQueries.findById(orgId, sourceId);
  if (!sources || sources.length === 0) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  const sourceSlug = sources[0].slug;

  // Fetch existing limits so we can skip metrics that already have them
  const limitRecords = await sourceLimitQueries.findBySource(orgId, sourceId);
  const existingLimits: Record<string, { min?: number; max?: number }> = {};
  for (const record of limitRecords) {
    existingLimits[record.metric] = {
      min: record.min ?? undefined,
      max: record.max ?? undefined,
    };
  }

  const suggestions = await suggestThresholds({
    orgId,
    sourceId: sourceSlug,
    existingLimits,
  });

  return NextResponse.json({ suggestions });
});
