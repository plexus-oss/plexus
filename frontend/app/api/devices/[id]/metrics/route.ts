/**
 * Device Metrics API - Get all current metric values
 *
 * GET /api/devices/[id]/metrics - Get all current values for a device
 *
 * Returns the most recent value for every metric the device has sent,
 * along with the timestamp of the last reading.
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { findSourceByRef } from "@/lib/api/find-source";
import { queryTelemetry } from "@/lib/db/clickhouse";
import { enforceSource } from "@/lib/access/sources";

export const GET = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id } = await params;

  // Resolve device
  const source = await findSourceByRef(orgId, id, isApiKeyAuth);
  if (!source) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  await enforceSource({ orgId, userId, orgRole, isApiKeyAuth }, source, "view");

  const sourceId = source.slug || source.id;

  // Query latest values for all metrics from this device (last 5 minutes)
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
    const results = await queryTelemetry({
      orgId,
      sourceId,
      startTime: fiveMinAgo,
      endTime: new Date(),
      limit: 1000,
    });

    // Build a map of metric -> latest value
    const metrics: Record<
      string,
      { value: number | string; timestamp: string; unit?: string }
    > = {};

    if (results && Array.isArray(results)) {
      for (const row of results) {
        metrics[row.metric] = {
          value: row.value,
          timestamp:
            typeof row.timestamp === "string"
              ? row.timestamp
              : row.timestamp.toISOString(),
        };
      }
    }

    return NextResponse.json({
      device_id: sourceId,
      metrics,
      count: Object.keys(metrics).length,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to query metrics" },
      { status: 500 },
    );
  }
});
