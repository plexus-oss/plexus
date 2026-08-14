import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { queryTelemetryAdaptive, type ResolutionLevel } from "@/lib/db/clickhouse";
import { parseTimeRangeParam } from "@/lib/telemetry/time-range-param";
import { cachedJson } from "@/lib/utils";
import { buildCacheKey, getCached, setCached, getTtlForTimeRange } from "@/lib/cache/telemetry-cache";
import { filterAccessibleSlugs } from "@/lib/access/sources";

/**
 * GET /api/telemetry/query — Query ClickHouse telemetry for a set of metrics.
 *
 * Query params:
 * - metrics: Comma-separated list of "sourceId:metric" pairs
 * - timeRange: "1m" | "5m" | "1h" | "24h" | "7d" (default "1h")
 * - limit: Max data points per metric (default 10000)
 */
export const GET = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth }) => {
    const { searchParams } = new URL(request.url);
    const metricsParam = searchParams.get("metrics");
    const timeRange = searchParams.get("timeRange") || "1h";
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "10000", 10),
      100000,
    );

    if (!metricsParam) {
      return NextResponse.json(
        { error: "metrics parameter is required" },
        { status: 400 },
      );
    }

    const metricKeys = metricsParam.split(",").filter(Boolean);
    if (metricKeys.length === 0) {
      return NextResponse.json({ data: {} });
    }

    const { startTime, endTime } = parseTimeRangeParam(timeRange);

    const metricsBySource = new Map<string, string[]>();
    for (const key of metricKeys) {
      const colonIndex = key.indexOf(":");
      if (colonIndex > 0) {
        const sourceId = key.substring(0, colonIndex);
        const metric = key.substring(colonIndex + 1);
        if (!metricsBySource.has(sourceId)) metricsBySource.set(sourceId, []);
        metricsBySource.get(sourceId)!.push(metric);
      } else {
        if (!metricsBySource.has("*")) metricsBySource.set("*", []);
        metricsBySource.get("*")!.push(key);
      }
    }

    // Access filter: drop sources the session user can't view. The "*" wildcard
    // (all org sources) is admin/API-key only. Inaccessible metrics are simply
    // omitted so mixed-access dashboard panels still render.
    const ctx = { orgId, userId, orgRole, isApiKeyAuth };
    const allowAll = isApiKeyAuth || !userId || orgRole === "org:admin";
    const requestedSlugs = [...metricsBySource.keys()].filter((s) => s !== "*");
    const accessible = await filterAccessibleSlugs(ctx, requestedSlugs);
    for (const src of [...metricsBySource.keys()]) {
      if (src === "*") {
        if (!allowAll) metricsBySource.delete("*");
      } else if (!accessible.has(src)) {
        metricsBySource.delete(src);
      }
    }

    // Effective key list reflects only what we'll actually query — also used as
    // the cache key so users with different access never share a cache entry.
    const effectiveKeys: string[] = [];
    for (const [src, metrics] of metricsBySource) {
      for (const m of metrics) {
        effectiveKeys.push(src === "*" ? m : `${src}:${m}`);
      }
    }
    if (effectiveKeys.length === 0) {
      return NextResponse.json({ data: {} });
    }

    const cacheKey = buildCacheKey(orgId, effectiveKeys, timeRange);
    type PointType = {
      timestamp: string;
      value: number;
      min?: number;
      max?: number;
      /** Per-bucket sum/count of raw events — lets clients compute tier-independent totals (see AdaptivePoint). */
      sum?: number;
      count?: number;
      source_id?: string | null;
    };
    type ResultType = Record<string, PointType[]>;
    const cached = getCached<{
      data: ResultType;
      resolution: ResolutionLevel;
      truncated: boolean;
    }>(cacheKey);
    if (cached) {
      return cachedJson(cached, { maxAge: 5, staleWhileRevalidate: 10 });
    }

    const result: ResultType = {};
    // One resolution describes the whole response; with the density-aware
    // raw tier, metrics sharing a window can now come back mixed (sparse →
    // raw, dense → downsampled). Report the non-raw tier whenever any
    // series was bucketed so the client is never told "raw" for data that
    // isn't. `truncated` mirrors AdaptiveQueryResult.truncated (set only
    // when a series is STILL row-capped after tier selection).
    let resolution: ResolutionLevel = "raw";
    let truncated = false;
    for (const key of effectiveKeys) result[key] = [];

    const queryPromises: Promise<void>[] = [];

    for (const [sourceId, metrics] of metricsBySource) {
      for (const metric of metrics) {
        const promise = (async () => {
          const adaptiveResult = await queryTelemetryAdaptive(
            orgId,
            sourceId === "*" ? "" : sourceId,
            metric,
            startTime,
            endTime,
            limit,
          );
          if (adaptiveResult.resolution !== "raw") {
            resolution = adaptiveResult.resolution;
          }
          if (adaptiveResult.truncated) truncated = true;
          const key = sourceId === "*" ? metric : `${sourceId}:${metric}`;
          if (!result[key]) result[key] = [];
          for (const point of adaptiveResult.points) {
            result[key].push({
              timestamp: point.timestamp,
              value: point.value,
              ...(point.min !== undefined && { min: point.min }),
              ...(point.max !== undefined && { max: point.max }),
              ...(point.sum !== undefined && { sum: point.sum }),
              ...(point.count !== undefined && { count: point.count }),
              ...(sourceId !== "*" && { source_id: sourceId }),
            });
          }
        })();
        queryPromises.push(promise);
      }
    }

    await Promise.all(queryPromises);

    const responseData = { data: result, resolution, truncated };
    setCached(cacheKey, responseData, getTtlForTimeRange(timeRange));
    return cachedJson(responseData, { maxAge: 5, staleWhileRevalidate: 10 });
});
