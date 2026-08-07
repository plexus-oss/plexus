/**
 * GET /api/alerts/live-stats?rule=<ruleID>&source=<sourceID>
 *
 * Proxy to the alert-service /stats endpoint. Returns the live incident
 * profile for an in-flight alert (threshold/outlier rules only).
 *
 * 404 when the alert is not currently open or recovering — caller should
 * fall back to the closed alert_stats column on the alerts row.
 */

import { NextResponse } from "next/server";
import { withDualAuth } from "@/lib/api/with-auth";
import type { LiveStats } from "@/lib/db/types";

export const GET = withDualAuth(async (request) => {
  const alertServiceUrl = process.env.PLEXUS_ALERT_SERVICE_URL;
  const secret = process.env.PLEXUS_INTERNAL_SECRET;

  if (!alertServiceUrl || !secret) {
    return NextResponse.json(
      { error: "Alert service not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const ruleId = searchParams.get("rule");
  const sourceId = searchParams.get("source");

  if (!ruleId || !sourceId) {
    return NextResponse.json(
      { error: "rule and source query params required" },
      { status: 400 },
    );
  }

  const upstream = new URL(`${alertServiceUrl}/stats`);
  upstream.searchParams.set("rule", ruleId);
  upstream.searchParams.set("source", sourceId);

  let response: Response;
  try {
    response = await fetch(upstream.toString(), {
      headers: { "x-internal-secret": secret },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error("[live-stats] alert-service unreachable:", err);
    return NextResponse.json(
      { error: "Alert service unavailable" },
      { status: 503 },
    );
  }

  if (response.status === 404) {
    return new NextResponse(null, { status: 404 });
  }

  if (!response.ok) {
    console.error(`[live-stats] alert-service responded ${response.status}`);
    return NextResponse.json(
      { error: "Upstream error" },
      { status: 502 },
    );
  }

  const data = (await response.json()) as LiveStats;
  return NextResponse.json(data);
});
