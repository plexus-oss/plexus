import { withAuth } from "@/lib/api/with-auth";
import { sourceQueries, deviceSchemaQueries } from "@/lib/db";
import { getAllSourceMetrics } from "@/lib/db/clickhouse";
import { loadAllowedSourceIds } from "@/lib/access/sources";
import { cachedJson } from "@/lib/utils";

/**
 * GET /api/telemetry/metrics — Available metrics for the organization.
 * Returns metrics grouped by source. Sources are fleet-registered devices.
 *
 * Metric discovery has two backing stores so sources with
 * `config.recording=false` (live-only pass-through) still surface their
 * metrics in the UI:
 *   1. ClickHouse — distinct metric names actually persisted to
 *      `telemetry.metrics`. Only populated when a source is recording.
 *   2. `device_schemas` table — schema snapshots captured at registration
 *      or via ingest-time schema capture. Populated regardless of
 *      recording. This is the fallback for live-only sources.
 * Metrics from both stores are merged per source.
 */
export const GET = withAuth(async (_request, { orgId, userId }) => {
  const [allFleetSources, allMetricsMap, schemas, allowed] = await Promise.all([
    sourceQueries.findByType(orgId, "device"),
    getAllSourceMetrics(orgId),
    deviceSchemaQueries.findByOrg(orgId),
    loadAllowedSourceIds(orgId, userId),
  ]);

  // Scoped members only see metrics for their allow-listed sources. Schema
  // rows are keyed by slug; unknown slugs are hidden from scoped users
  // (deny-by-default, matching filterAccessibleSlugs).
  const fleetSources = allowed
    ? allFleetSources.filter((s) => allowed.has(s.id))
    : allFleetSources;
  const visibleSlugs = allowed
    ? new Set(fleetSources.map((s) => s.slug))
    : null;

  const schemaMetricsBySource = new Map<string, Set<string>>();
  for (const row of schemas) {
    if (visibleSlugs && !visibleSlugs.has(row.source_id)) continue;
    const key = row.source_id;
    if (!schemaMetricsBySource.has(key)) {
      schemaMetricsBySource.set(key, new Set());
    }
    schemaMetricsBySource.get(key)!.add(row.metric);
  }

  const allSourceIds = new Set<string>([
    ...fleetSources.map((s) => s.slug),
    ...schemaMetricsBySource.keys(),
  ]);

  const metricsBySource = Array.from(allSourceIds).map((source_id) => {
    const merged = new Set<string>(allMetricsMap.get(source_id) || []);
    const fromSchemas = schemaMetricsBySource.get(source_id);
    if (fromSchemas) for (const m of fromSchemas) merged.add(m);
    return {
      source_id,
      metrics: Array.from(merged).sort(),
      isRegistered: fleetSources.some((s) => s.slug === source_id),
    };
  });

  metricsBySource.sort((a, b) => {
    if (a.isRegistered !== b.isRegistered) {
      return a.isRegistered ? -1 : 1;
    }
    return a.source_id.localeCompare(b.source_id);
  });

  const allMetricsSet = new Set<string>();
  for (const source of metricsBySource) {
    for (const metric of source.metrics) allMetricsSet.add(metric);
  }
  const metrics = Array.from(allMetricsSet)
    .sort()
    .map((metric) => ({ metric }));

  return cachedJson(
    { metrics, metricsBySource },
    { maxAge: 30, staleWhileRevalidate: 60 },
  );
});
