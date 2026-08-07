/**
 * PUT /api/billing/spend-cap
 *
 * Body: { monthlySpendCapUsd: number | null }
 *
 * Stores the org's monthly spend cap and reconciles enforcement state
 * immediately. If the user just raised (or removed) the cap and they
 * were previously revoked for a cap breach, we restore their keys
 * straight away — they don't have to wait for the next cron tick.
 */

import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { resolveOrgRole } from "@/lib/auth/org-role";
import { clearOrgCache, estimateMonthlyChargeUsd } from "@/lib/billing/server";
import { restoreFromSpendCap } from "@/lib/billing/team-tier-enforcement";
import { adminOrgBillingQueries } from "@/lib/db/server";
import { getUsageInfo } from "@/lib/db/clickhouse";
import { apiError, errorResponse } from "@/lib/api/errors";
import { isBillingEnabled } from "@/lib/billing/config";

export async function PUT(request: Request) {
  if (!isBillingEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const { userId, orgId, orgRole } = await getAuth();
    if (!userId || !orgId) {
      throw apiError("UNAUTHORIZED", "Sign in and select an organization");
    }
    // Billing is admin-only.
    if ((await resolveOrgRole(orgId, userId, orgRole)) !== "org:admin") {
      throw apiError("FORBIDDEN", "Billing is managed by org admins");
    }

    const body = (await request.json().catch(() => ({}))) as {
      monthlySpendCapUsd?: number | null;
    };

    const value = body.monthlySpendCapUsd;
    if (value !== null && value !== undefined) {
      // Zero is rejected rather than treated as "block all spend" — reads
      // collapse caps <= 0 to "no cap" (rowToOrgBilling), so accepting 0
      // here would store a cap that's silently never enforced.
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw apiError(
          "VALIDATION_ERROR",
          "monthlySpendCapUsd must be a positive number or null",
        );
      }
    }

    const newCap = value === null || value === undefined ? null : value;

    await adminOrgBillingQueries.patch(orgId, { monthly_spend_cap_usd: newCap });
    clearOrgCache(orgId);

    // If the new cap is null (removed) or above the current projected
    // charge, and we previously revoked keys for a cap breach, bring
    // them back online immediately.
    let restored = 0;
    if (newCap === null) {
      const r = await restoreFromSpendCap(orgId);
      restored = r.restored;
    } else {
      const usage = await getUsageInfo(orgId);
      const projected = estimateMonthlyChargeUsd({
        metrics: usage.metricsThisMonth,
        logs: usage.logsThisMonth,
        videoHours: usage.videoHoursThisMonth,
      });
      if (projected.total < newCap) {
        const r = await restoreFromSpendCap(orgId);
        restored = r.restored;
      }
    }

    return NextResponse.json({
      monthlySpendCapUsd: newCap,
      restoredKeys: restored,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
