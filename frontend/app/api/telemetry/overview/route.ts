import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import {
  queryTelemetryOverview,
  type TelemetryOverviewResult,
} from "@/lib/db/clickhouse";
import { cachedJson } from "@/lib/utils";
import { buildCacheKey, getCached, setCached } from "@/lib/cache/telemetry-cache";
import { filterAccessibleSlugs } from "@/lib/access/sources";
import { MINUTE_MS, DAY_MS } from "@/lib/constants/time";

const MAX_SPAN_MS = 30 * DAY_MS;
const DEFAULT_BUCKETS = 240;

/**
 * GET /api/telemetry/overview — Ingest-volume histogram for the dashboard
 * mini scrubber: exact per-bucket raw-row counts summed across metrics, from
 * the 1-min rollup in a single ClickHouse query.
 *
 * Query params:
 * - metrics: Comma-separated "sourceId:metric" pairs (bare metric = any source)
 * - start / end: Optional ISO bounds (default: last 30 days ending now)
 * - buckets: Target bucket count (default 240, clamped 24–480)
 *
 * Returns { buckets: [{t, count}], earliest, start, end, bucketSeconds,
 * serverNow }. serverNow is always fresh (never cached) so the client can
 * correct for clock skew.
 */
export const GET = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth }) => {
    const { searchParams } = new URL(request.url);
    const metricsParam = searchParams.get("metrics");

    if (!metricsParam) {
      return NextResponse.json(
        { error: "metrics parameter is required" },
        { status: 400 },
      );
    }

    // Minute-floored "now" keeps default windows stable across a cache TTL.
    const nowMs = Date.now();
    const defaultEnd = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
    const endParam = searchParams.get("end");
    const startParam = searchParams.get("start");
    const end = endParam ? Date.parse(endParam) : defaultEnd;
    let start = startParam ? Date.parse(startParam) : end - MAX_SPAN_MS;
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      return NextResponse.json(
        { error: "invalid start/end" },
        { status: 400 },
      );
    }
    start = Math.max(start, end - MAX_SPAN_MS);

    const bucketCount = Math.max(
      24,
      Math.min(480, parseInt(searchParams.get("buckets") || "", 10) || DEFAULT_BUCKETS),
    );
    const bucketSeconds = Math.max(
      60,
      Math.round((end - start) / 1000 / bucketCount),
    );

    // Same key parsing + access filtering as /api/telemetry/query: bare
    // metrics (any source) are admin/API-key only; inaccessible sources are
    // silently dropped so mixed-access dashboards still get a strip.
    const metricKeys = metricsParam.split(",").filter(Boolean);
    const allowAll = isApiKeyAuth || !userId || orgRole === "org:admin";
    const pairs: Array<{ sourceId: string; metric: string }> = [];
    for (const key of metricKeys) {
      const colonIndex = key.indexOf(":");
      if (colonIndex > 0) {
        pairs.push({
          sourceId: key.substring(0, colonIndex),
          metric: key.substring(colonIndex + 1),
        });
      } else if (allowAll) {
        pairs.push({ sourceId: "", metric: key });
      }
    }
    const requestedSlugs = [...new Set(pairs.map((p) => p.sourceId).filter(Boolean))];
    const accessible = await filterAccessibleSlugs(
      { orgId, userId, orgRole, isApiKeyAuth },
      requestedSlugs,
    );
    const effectivePairs = pairs.filter(
      (p) => !p.sourceId || accessible.has(p.sourceId),
    );

    if (effectivePairs.length === 0) {
      return NextResponse.json({
        buckets: [],
        earliest: null,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        bucketSeconds,
        serverNow: nowMs,
      });
    }

    const effectiveKeys = effectivePairs.map((p) =>
      p.sourceId ? `${p.sourceId}:${p.metric}` : p.metric,
    );
    const cacheKey = buildCacheKey(
      orgId,
      effectiveKeys,
      `overview:${start}/${end}:${bucketCount}`,
    );

    let result = getCached<TelemetryOverviewResult>(cacheKey);
    if (!result) {
      result = await queryTelemetryOverview(
        orgId,
        effectivePairs,
        new Date(start),
        new Date(end),
        bucketSeconds,
      );
      setCached(cacheKey, result, MINUTE_MS);
    }

    return cachedJson(
      {
        ...result,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        bucketSeconds,
        serverNow: nowMs,
      },
      { maxAge: 5, staleWhileRevalidate: 10 },
    );
  },
);
