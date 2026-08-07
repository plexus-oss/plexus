/**
 * GET /api/fleet/health — Aggregate fleet health from ClickHouse.
 *
 * Uses ClickHouse GROUP BY for efficient server-side aggregation
 * instead of fetching raw rows and aggregating in JavaScript.
 */

import { withDualAuth } from "@/lib/api/with-auth";
import { queryFleetHealth } from "@/lib/db/clickhouse";
import { cachedJson } from "@/lib/utils";
import { filterAccessibleSlugs } from "@/lib/access/sources";

const HEALTH_METRICS = [
  "battery",
  "cpu",
  "error_count",
  "temperature",
  "memory",
];

export const GET = withDualAuth(
  async (_req, { orgId, userId, orgRole, isApiKeyAuth }) => {
  // Single efficient GROUP BY query instead of fetching 50K rows
  const rows = await queryFleetHealth(orgId, HEALTH_METRICS, 3600000);

  // Group by source
  const sourceMap = new Map<
    string,
    {
      source_id: string;
      point_count: number;
      metrics: Record<
        string,
        { avg: number; min: number; max: number; latest: number; count: number }
      >;
      last_data_at: string;
    }
  >();

  for (const row of rows) {
    let stats = sourceMap.get(row.source_id);
    if (!stats) {
      stats = {
        source_id: row.source_id,
        point_count: 0,
        metrics: {},
        last_data_at: row.last_data_at,
      };
      sourceMap.set(row.source_id, stats);
    }

    stats.point_count += Number(row.point_count);
    if (row.last_data_at > stats.last_data_at) {
      stats.last_data_at = row.last_data_at;
    }

    stats.metrics[row.metric] = {
      avg: Number(row.avg_value),
      min: Number(row.min_value),
      max: Number(row.max_value),
      latest: Number(row.last_value),
      count: Number(row.point_count),
    };
  }

  let fleet = Array.from(sourceMap.values());

  // Access filter: a session user only sees devices they can view. fleet
  // source_id is the device slug. API-key/admin see everything.
  if (!isApiKeyAuth && userId && orgRole !== "org:admin") {
    const accessible = await filterAccessibleSlugs(
      { orgId, userId, orgRole, isApiKeyAuth },
      fleet.map((s) => s.source_id),
    );
    fleet = fleet.filter((s) => accessible.has(s.source_id));
  }

  // Summary
  const totalSources = fleet.length;
  const totalPoints = fleet.reduce((sum, s) => sum + s.point_count, 0);
  const missingData = fleet.filter((s) => {
    const lastData = new Date(s.last_data_at).getTime();
    return Date.now() - lastData > 5 * 60 * 1000;
  }).length;

  return cachedJson(
    {
      fleet,
      summary: { totalSources, totalPoints, missingData },
    },
    { maxAge: 10, staleWhileRevalidate: 30 },
  );
});
