/**
 * Device Metric API - Get a single metric with history
 *
 * GET /api/devices/[id]/metrics/[name] - Get a specific metric
 *
 * Query params:
 *   timeRange: "1m" | "5m" | "1h" | "24h" | "7d" (default: "1h")
 *   limit: Max data points (default: 1000)
 */

import { NextRequest, NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import { findSourceByRef } from "@/lib/api/find-source";
import { queryTelemetry } from "@/lib/db/clickhouse";
import { MINUTE_MS, HOUR_MS, DAY_MS } from "@/lib/constants/time";
import { enforceSource } from "@/lib/access/sources";

export const GET = withDualAuth(
  async (request, { orgId, userId, orgRole, isApiKeyAuth, params }) => {
  const { id, name } = await params;

  // Resolve device
  const source = await findSourceByRef(orgId, id, isApiKeyAuth);
  if (!source) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  await enforceSource({ orgId, userId, orgRole, isApiKeyAuth }, source, "view");

  const sourceId = source.slug || source.id;

  const searchParams = (request as NextRequest).nextUrl.searchParams;
  const timeRange = searchParams.get("timeRange") || "1h";
  const limit = Math.min(
    parseInt(searchParams.get("limit") || "1000", 10),
    100000,
  );

  // Convert timeRange string to startTime/endTime
  const rangeMs: Record<string, number> = {
    "1m": MINUTE_MS,
    "5m": 5 * MINUTE_MS,
    "1h": HOUR_MS,
    "24h": 24 * HOUR_MS,
    "7d": 7 * DAY_MS,
  };
  const ms = rangeMs[timeRange] ?? HOUR_MS;
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - ms);

  try {
    const results = await queryTelemetry({
      orgId,
      sourceId,
      metrics: [name],
      startTime,
      endTime,
      limit,
    });

    if (!results || results.length === 0) {
      return NextResponse.json({
        device_id: sourceId,
        metric: name,
        data: [],
        count: 0,
      });
    }

    return NextResponse.json({
      device_id: sourceId,
      metric: name,
      data: results.map((r: { value: number; timestamp: string | Date }) => ({
        value: r.value,
        timestamp: r.timestamp,
      })),
      count: results.length,
      latest: {
        value: results[0].value,
        timestamp: results[0].timestamp,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to query metric" },
      { status: 500 },
    );
  }
});
