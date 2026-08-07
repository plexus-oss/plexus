/**
 * GET /api/cron/email-drip
 *
 * Daily cron (external runner; the app deploys to Fly, not Vercel). Walks
 * every org_billing row, picks the tier_1 ones,
 * and lets `evaluateAndSendDrip` decide whether any drip should fire
 * today. The orchestrator owns ordering and idempotency; this endpoint
 * just gathers the per-org context (signup time, first-data time, current
 * usage vs team-tier ceiling) and hands it off.
 *
 * The welcome drip is intentionally NOT here — it fires from POST
 * /api/orgs on org creation so brand-new users see it within seconds, not
 * up to 24 hours later.
 *
 * Auth: shared CRON_SECRET in Authorization: Bearer header. The external cron
 * runner sends this automatically when configured.
 */

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminOrgBillingQueries } from "@/lib/db/server";
import { getRetentionInfo, getUsageInfo } from "@/lib/db/clickhouse";
import {
  MONTHLY_CREDIT_USD,
  PRICE_PER_MILLION_METRICS_USD,
  PRICE_PER_MILLION_LOGS_USD,
  PRICE_PER_VIDEO_HOUR_USD,
} from "@/lib/billing/server";
import { evaluateAndSendDrip } from "@/lib/email/drip";

interface DripReportRow {
  orgId: string;
  status: "ok" | "skipped" | "error";
  key?: string;
  error?: string;
}

function authorize(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows: DripReportRow[] = [];
  const now = Date.now();
  let scanned = 0;
  let tier1Eligible = 0;
  let skippedNoCreatedAt = 0;

  const allBillingRows = await adminOrgBillingQueries.findAll();

  for (const billing of allBillingRows) {
    scanned++;
    if (billing.tier !== "tier_1") continue;
    tier1Eligible++;

    const orgId = billing.org_id;
    const createdAtMs = billing.org_created_at
      ? new Date(billing.org_created_at).getTime()
      : null;
    if (createdAtMs === null) {
      // Sync gap (backfill or webhook miss) — surface it in the report
      // instead of silently never dripping this org.
      skippedNoCreatedAt++;
      continue;
    }

    try {
      const [usage, retention] = await Promise.all([
        getUsageInfo(orgId),
        getRetentionInfo(orgId),
      ]);

      const status = billing.stripe_subscription_status;
      const isPaid = status === "active" || status === "trialing" || status === "past_due";

      const hasDataThisMonth = usage.metricsThisMonth + usage.logsThisMonth > 0;
      const oldestMs = retention.oldestData
        ? new Date(retention.oldestData).getTime()
        : null;
      const daysSinceFirstData = oldestMs !== null ? (now - oldestMs) / DAY_MS : null;
      const firstDataInLast24h = daysSinceFirstData !== null && daysSinceFirstData <= 1;
      const daysSinceSignup = (now - createdAtMs) / DAY_MS;

      const creditsUsedUsd =
        (usage.metricsThisMonth / 1_000_000) * PRICE_PER_MILLION_METRICS_USD +
        (usage.logsThisMonth / 1_000_000) * PRICE_PER_MILLION_LOGS_USD +
        usage.videoHoursThisMonth * PRICE_PER_VIDEO_HOUR_USD;
      const creditUsedFraction = creditsUsedUsd / MONTHLY_CREDIT_USD;

      const result = await evaluateAndSendDrip({
        orgId,
        orgName: billing.org_name ?? orgId,
        createdAtMs,
        dripMarkers: (billing.drip_markers as Record<string, unknown>) ?? {},
        hasDataThisMonth,
        firstDataInLast24h,
        daysSinceFirstData,
        daysSinceSignup,
        isPaid,
        creditUsedFraction,
        creditsUsedUsd,
      });

      if (!result) {
        rows.push({ orgId, status: "skipped" });
      } else if (result.sent) {
        rows.push({ orgId, status: "ok", key: result.key });
      } else {
        rows.push({ orgId, status: "skipped", key: result.key, error: result.reason });
      }
    } catch (err) {
      rows.push({ orgId, status: "error", error: err instanceof Error ? err.message : "Unknown error" });
      console.error(`[cron/email-drip] failed for ${orgId}:`, err);
    }
  }

  return NextResponse.json({
    scanned,
    tier1Eligible,
    skippedNoCreatedAt,
    sent: rows.filter((r) => r.status === "ok").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    errors: rows.filter((r) => r.status === "error").length,
    rows,
  });
}
