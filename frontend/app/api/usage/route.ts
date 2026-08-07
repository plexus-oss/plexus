import { NextResponse } from "next/server";
import { withOrgAuth } from "@/lib/api/with-auth";
import { sourceQueries, dashboardQueries } from "@/lib/db";
import {
  getOrgBilling,
  estimateMonthlyChargeUsd,
  TEAM_TIER_METRICS,
  TEAM_TIER_LOGS,
  PRICE_PER_MILLION_METRICS_USD,
  PRICE_PER_MILLION_LOGS_USD,
  PRICE_PER_VIDEO_HOUR_USD,
} from "@/lib/billing/server";
import { getUsageInfo, getRetentionInfo } from "@/lib/db/clickhouse";
import { RETENTION } from "@/lib/retention";

async function getOrgBillingWithRetry(orgId: string) {
  try {
    return await getOrgBilling(orgId);
  } catch (err: unknown) {
    if (err != null && typeof err === "object" && "status" in err && (err as { status: number }).status === 503) {
      await new Promise((r) => setTimeout(r, 2500));
      return await getOrgBilling(orgId);
    }
    throw err;
  }
}

/**
 * GET /api/usage - Org usage summary.
 *
 * Returns raw usage counters plus billing info. Usage-based pricing —
 * there are no per-plan quotas.
 */
export const GET = withOrgAuth(async (_request, { orgId }) => {
  try {
    const [usageInfo, retentionInfo, deviceCount, billing, dashboardCount] =
      await Promise.all([
        getUsageInfo(orgId),
        getRetentionInfo(orgId),
        sourceQueries.countByType(orgId).then((c) => c.device),
        getOrgBillingWithRetry(orgId),
        dashboardQueries.count(orgId),
      ]);

    const isEnterprise = billing.tier === "tier_2";

    const charge = estimateMonthlyChargeUsd({
      metrics: usageInfo.metricsThisMonth,
      logs: usageInfo.logsThisMonth,
      videoHours: usageInfo.videoHoursThisMonth,
    });

    return NextResponse.json({
      currentPeriod: {
        dataPoints: usageInfo.dataPointsThisMonth,
        bytesIngested: usageInfo.bytesThisMonth,
        devicesActive: deviceCount,
        dashboardsUsed: dashboardCount,
        metrics: usageInfo.metricsThisMonth,
        logs: usageInfo.logsThisMonth,
        videoHours: usageInfo.videoHoursThisMonth,
      },
      plan: {
        id: isEnterprise ? "enterprise" : "self_serve",
        name: isEnterprise ? "Enterprise" : "Self-Serve",
        retentionDays: RETENTION.rawTelemetryDays,
        isEnterprise,
        contractInfo: null,
      },
      billing: {
        tier: billing.tier,
        status: billing.status,
        isPaid: billing.isPaid,
        enterpriseInfo: billing.enterpriseInfo ?? null,
        monthlySpendCapUsd: billing.monthlySpendCapUsd,
        platformFeeUsd: billing.platformFeeUsd,
        teamTierMetrics: TEAM_TIER_METRICS,
        teamTierLogs: TEAM_TIER_LOGS,
        rates: {
          pricePerMillionMetricsUsd: PRICE_PER_MILLION_METRICS_USD,
          pricePerMillionLogsUsd: PRICE_PER_MILLION_LOGS_USD,
          pricePerVideoHourUsd: PRICE_PER_VIDEO_HOUR_USD,
        },
        estimatedCharge: charge,
        estimatedChargeUsd: charge.total,
      },
      retention: {
        totalRows: retentionInfo.totalRows,
        oldestData: retentionInfo.oldestData,
        newestData: retentionInfo.newestData,
        expiringIn48Hours: retentionInfo.expiringIn48Hours,
      },
    });
  } catch (error) {
    console.error("Usage API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch usage" },
      { status: 500 },
    );
  }
});
