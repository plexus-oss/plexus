/**
 * GET /api/billing/usage-progress
 *
 * A lightweight progress endpoint for the team-tier banner. The full
 * /api/usage payload is heavy (retention, rates, dashboard counts,
 * etc.); the home banner just needs to know how close the org is to
 * the team-tier ceiling and whether to nudge the user toward a card.
 *
 * Returns the higher of (metrics-pct, logs-pct) as the headline pct so
 * one bar can stand in for both signals — most users only ingest one
 * type, and the bar should track whichever one will hit the wall first.
 */

import { NextResponse } from "next/server";
import { withOrgAuth } from "@/lib/api/with-auth";
import {
  getOrgBilling,
  TEAM_TIER_METRICS,
  TEAM_TIER_LOGS,
} from "@/lib/billing/server";
import { getUsageInfo } from "@/lib/db/clickhouse";

export type UsageStatus =
  | "fresh" // < 60% of free tier — show calmly
  | "approaching" // 60-90% — nudge: "add card to keep flowing"
  | "over"; // ≥ 90% (or hard breach) — block-soon / blocked

export interface UsageProgress {
  tier: "tier_1" | "tier_2";
  isPaid: boolean;
  status: UsageStatus;
  pct: number; // 0..1, capped at 1
  metrics: { used: number; limit: number };
  logs: { used: number; limit: number };
}

export const GET = withOrgAuth(async (_request, { orgId }) => {
  try {
    const [billing, usage] = await Promise.all([
      getOrgBilling(orgId),
      getUsageInfo(orgId),
    ]);

    const metricsPct =
      TEAM_TIER_METRICS > 0
        ? Math.min(1, usage.metricsThisMonth / TEAM_TIER_METRICS)
        : 0;
    const logsPct =
      TEAM_TIER_LOGS > 0
        ? Math.min(1, usage.logsThisMonth / TEAM_TIER_LOGS)
        : 0;
    const pct = Math.max(metricsPct, logsPct);

    const status: UsageStatus =
      billing.isPaid || pct < 0.6
        ? "fresh"
        : pct < 0.9
          ? "approaching"
          : "over";

    const body: UsageProgress = {
      tier: billing.tier,
      isPaid: billing.isPaid,
      status,
      pct,
      metrics: {
        used: usage.metricsThisMonth,
        limit: TEAM_TIER_METRICS,
      },
      logs: {
        used: usage.logsThisMonth,
        limit: TEAM_TIER_LOGS,
      },
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error("[billing/usage-progress] error:", err);
    return NextResponse.json(
      { error: "Failed to read usage" },
      { status: 500 },
    );
  }
});
