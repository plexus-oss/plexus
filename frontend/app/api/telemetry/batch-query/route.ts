/**
 * POST /api/telemetry/batch-query — Batch multiple telemetry queries into one request.
 *
 * Accepts { queries: [{ id, metrics, timeRange, sourceId? }] }
 * Returns  { results: { [id]: { data: Record<metric, points[]>, resolution } } }
 *
 * Uses adaptive query to auto-select resolution based on time range.
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { BatchQuerySchema } from "@/lib/validation/api-schemas";
import { queryTelemetryAdaptive, type ResolutionLevel } from "@/lib/db/clickhouse";
import { buildCacheKey, getCached, setCached, getTtlForTimeRange } from "@/lib/cache/telemetry-cache";
import { parseTimeRangeParam } from "@/lib/telemetry/time-range-param";
import { filterAccessibleSlugs } from "@/lib/access/sources";

export const POST = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth }) => {
  const { queries } = await validateBody(request, BatchQuerySchema);

  // sum/count = per-bucket totals of raw events, for tier-independent client aggregation (see AdaptivePoint)
  type PointRow = { timestamp: string; value: number; min?: number; max?: number; sum?: number; count?: number; source_id?: string | null };
  const results: Record<string, { data: Record<string, PointRow[]>; resolution: ResolutionLevel }> = {};

  // Deduplicate: group by (timeRange, sourceId?) → set of metrics
  type GroupKey = string;
  const groups = new Map<GroupKey, { timeRange: string; sourceId?: string; metrics: Set<string>; queryIds: string[] }>();

  for (const q of queries) {
    const key = `${q.timeRange}:${q.sourceId || "*"}`;
    let group = groups.get(key);
    if (!group) {
      group = { timeRange: q.timeRange, sourceId: q.sourceId, metrics: new Set(), queryIds: [] };
      groups.set(key, group);
    }
    for (const m of q.metrics) group.metrics.add(m);
    group.queryIds.push(q.id);
    results[q.id] = { data: {}, resolution: "raw" };
    for (const m of q.metrics) results[q.id].data[m] = [];
  }

  // Access filter: gather every candidate slug, resolve which the user may
  // view, and drop inaccessible metrics. Filtering BEFORE the cache key means
  // users with different access never share a cache entry. "*"/unscoped is
  // admin/API-key only.
  const ctx = { orgId, userId, orgRole, isApiKeyAuth };
  const allowAll = isApiKeyAuth || !userId || orgRole === "org:admin";
  const candidateSlugs = new Set<string>();
  for (const group of groups.values()) {
    if (group.sourceId && group.sourceId !== "*") candidateSlugs.add(group.sourceId);
    for (const m of group.metrics) {
      const colon = m.indexOf(":");
      if (colon > 0) candidateSlugs.add(m.substring(0, colon));
    }
  }
  const accessible = await filterAccessibleSlugs(ctx, [...candidateSlugs]);
  const slugOk = (src: string | undefined): boolean =>
    !src || src === "*" ? allowAll : accessible.has(src);

  // Execute one adaptive query per unique (group, metric) pair
  await Promise.all(
    Array.from(groups.values()).map(async (group) => {
      const allMetrics = Array.from(group.metrics).filter((m) => {
        const colon = m.indexOf(":");
        const src = colon > 0 ? m.substring(0, colon) : group.sourceId;
        return slugOk(src);
      });
      if (allMetrics.length === 0) return; // nothing accessible; leave [] results
      const cacheKey = buildCacheKey(orgId, allMetrics, group.timeRange, group.sourceId);
      type CachedData = { data: Record<string, PointRow[]>; resolution: ResolutionLevel };
      let cached = getCached<CachedData>(cacheKey);

      if (!cached) {
        const { startTime: start, endTime: end } = parseTimeRangeParam(
          group.timeRange,
        );
        const data: Record<string, PointRow[]> = {};
        let resolution: ResolutionLevel = "raw";

        // Parse source:metric pairs and query each metric adaptively
        const metricPromises = allMetrics.map(async (m) => {
          const colon = m.indexOf(":");
          const sourceId = colon > 0 ? m.substring(0, colon) : (group.sourceId || "");
          const metricName = colon > 0 ? m.substring(colon + 1) : m;

          const result = await queryTelemetryAdaptive(
            orgId,
            sourceId === "*" ? "" : sourceId,
            metricName,
            start,
            end,
            10000,
          );

          resolution = result.resolution;
          data[m] = result.points.map((p) => ({
            timestamp: p.timestamp,
            value: p.value,
            ...(p.min !== undefined && { min: p.min }),
            ...(p.max !== undefined && { max: p.max }),
            ...(p.sum !== undefined && { sum: p.sum }),
            ...(p.count !== undefined && { count: p.count }),
            ...(sourceId && sourceId !== "*" && { source_id: sourceId }),
          }));
        });

        await Promise.all(metricPromises);
        cached = { data, resolution };
        setCached(cacheKey, cached, getTtlForTimeRange(group.timeRange));
      }

      // Distribute results to each query that requested these metrics
      for (const qId of group.queryIds) {
        const qDef = queries.find((q) => q.id === qId)!;
        results[qId].resolution = cached.resolution;
        for (const m of qDef.metrics) {
          results[qId].data[m] = cached.data[m] || [];
        }
      }
    })
  );

  return NextResponse.json({ results });
});
