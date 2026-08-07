/**
 * GET /api/cron/report-usage
 *
 * Daily cron (external runner; the app deploys to Fly, not Vercel). Two jobs
 * in one pass over org_billing:
 *
 *   Active/trialing tier_1 orgs:
 *     - Reports the previous full UTC day to Stripe as a metered event per
 *       category (metrics, logs, video). Identifier is
 *       `${meter}-${orgId}-${YYYY-MM-DD}` (yesterday's date), so re-runs on
 *       the same day are silently deduplicated by Stripe. No stored
 *       `lastReportedAt` state needed.
 *     - Queries month-to-date totals for spend-cap and burn-rate checks.
 *       The single MTD result is passed to both, so one ClickHouse query
 *       per org total (plus one for the Stripe window).
 *
 *   Unsubscribed tier_1 orgs:
 *     - Queries MTD metrics and enforces the team-tier hard stop if crossed.
 *
 *   tier_2 orgs: skipped (no Stripe required).
 *
 * Setup — Stripe dashboard:
 *   1. Billing → Meters → New (one per category):
 *        plexus_metrics / plexus_logs / plexus_video_hours
 *   2. Products → three metered prices, one per meter; bind IDs to
 *      STRIPE_PRICE_ID_METRICS / _LOGS / _VIDEO_HOURS.
 *   3. Override event names via STRIPE_METER_*_EVENT_NAME if needed.
 */

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { adminOrgBillingQueries } from "@/lib/db/server";
import { isBillingEnabled } from "@/lib/billing/config";
import { getUsageInfo } from "@/lib/db/clickhouse";
import type { UsageInfo } from "@/lib/db/clickhouse";
import { getAiTokensForDay } from "@/lib/ai/usage";
import {
  TEAM_TIER_METRICS,
  estimateMonthlyChargeUsd,
} from "@/lib/billing/server";
import {
  enforceTeamTierBreach,
  enforceSpendCap,
  restoreFromSpendCap,
} from "@/lib/billing/team-tier-enforcement";
import {
  findOrgAdminEmail,
  sendTransactionalEmail,
} from "@/lib/email/transactional";

interface OrgReport {
  orgId: string;
  reported: number;
  status: "ok" | "skipped" | "error";
  error?: string;
}

function authorize(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function spendCapBreachHtml(args: {
  orgName: string;
  capUsd: number;
  projectedUsd: number;
  appUrl: string;
}): string {
  return `
    <p>Hi —</p>
    <p>Your Plexus org <strong>${args.orgName}</strong> just crossed your
       monthly spend cap of <strong>${fmtUsd(args.capUsd)}</strong>
       (projected charge is <strong>${fmtUsd(args.projectedUsd)}</strong>).</p>
    <p>To prevent surprise bills, we've paused ingestion for the rest of
       this billing period. Your existing data is unaffected — query and
       export still work.</p>
    <p>To resume ingest, raise or remove the cap in Settings → Subscription.
       We'll re-enable your API keys automatically.</p>
    <p><a href="${args.appUrl}/settings?tab=billing">Adjust spend cap →</a></p>
    <p>— Plexus Billing</p>
  `;
}

function spendCapResumeHtml(args: { orgName: string; appUrl: string }): string {
  return `
    <p>Your Plexus org <strong>${args.orgName}</strong> is back online —
       ingestion has resumed.</p>
    <p>Your spend is now under your configured cap. We re-enabled the API
       keys we paused earlier.</p>
    <p><a href="${args.appUrl}/settings?tab=billing">View usage →</a></p>
    <p>— Plexus Billing</p>
  `;
}

/**
 * Burn-rate alert thresholds (USD). When an org's projected month-end
 * charge crosses any of these for the first time this calendar month,
 * we send a single heads-up email. Tunable via env without redeploy.
 */
const HIGH_BURN_THRESHOLDS_USD: number[] = (() => {
  const raw = process.env.BILLING_HIGH_BURN_THRESHOLDS_USD;
  if (!raw) return [10, 50, 100, 500, 1000];
  const parsed = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  return parsed.length > 0 ? parsed : [10, 50, 100, 500, 1000];
})();

function highBurnAlertHtml(args: {
  orgName: string;
  threshold: number;
  projectedUsd: number;
  capUsd: number | null;
  appUrl: string;
}): string {
  const capLine = args.capUsd
    ? `<p>Your monthly spend cap is <strong>${fmtUsd(args.capUsd)}</strong>; once projected charges hit it we'll pause ingest until you raise or remove the cap.</p>`
    : `<p>You haven't set a monthly spend cap. If you'd rather have us pause ingest at a specific number, set one in Subscription → Spend cap.</p>`;
  return `
    <p>Hi —</p>
    <p>Heads-up — Plexus projects <strong>${args.orgName}</strong> will spend
       around <strong>${fmtUsd(args.projectedUsd)}</strong> this month if
       the current pace continues. That's the first time you've crossed the
       <strong>${fmtUsd(args.threshold)}</strong> mark this billing period.</p>
    ${capLine}
    <p><a href="${args.appUrl}/settings?tab=billing">Open billing &amp; usage →</a></p>
    <p>— Plexus Billing</p>
  `;
}

function subscriptionRequiredEmailHtml(args: {
  orgName: string;
  dataPoints: number;
  appUrl: string;
}): string {
  const fmt = new Intl.NumberFormat("en-US");
  return `
    <p>Hi —</p>
    <p>Your Plexus org <strong>${args.orgName}</strong> ingested
       <strong>${fmt.format(args.dataPoints)}</strong> data points without
       a card on file. Plexus is usage-priced from the first point — we
       can't keep ingesting until you add a payment method.</p>
    <p>We've paused your API keys. Stored data is unaffected; query and
       export still work.</p>
    <p><a href="${args.appUrl}/settings?tab=billing">Add a card →</a></p>
    <p>Once you've subscribed, we automatically re-enable the keys we
       paused. No reconfiguration needed.</p>
    <p>— Plexus Billing</p>
  `;
}

interface MeterDef {
  key: "metrics" | "logs" | "video_hours";
  eventName: string;
  quantity: (u: UsageInfo) => number;
}

const METERS: MeterDef[] = [
  {
    key: "metrics",
    eventName: process.env.STRIPE_METER_METRICS_EVENT_NAME ?? "plexus_metrics",
    quantity: (u) => u.metricsThisMonth,
  },
  {
    key: "logs",
    eventName: process.env.STRIPE_METER_LOGS_EVENT_NAME ?? "plexus_logs",
    quantity: (u) => u.logsThisMonth,
  },
  {
    key: "video_hours",
    eventName:
      process.env.STRIPE_METER_VIDEO_HOURS_EVENT_NAME ?? "plexus_video_hours",
    quantity: (u) => Math.round(u.videoHoursThisMonth),
  },
];

const MONTH_KEY = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;


interface SpendCapOrg {
  orgId: string;
  orgName: string;
  monthlySpendCapUsd: number | null;
  spendCapRevokedKeyIds: string[];
}

async function reconcileSpendCapForOrg(
  org: SpendCapOrg,
  mtdUsage: UsageInfo,
  now: Date,
): Promise<void> {
  const cap = org.monthlySpendCapUsd;
  if (cap === null) return;

  const projected = estimateMonthlyChargeUsd({
    metrics: mtdUsage.metricsThisMonth,
    logs: mtdUsage.logsThisMonth,
    videoHours: mtdUsage.videoHoursThisMonth,
  }).total;
  const currentlyRevoked = org.spendCapRevokedKeyIds.length > 0;
  const overCap = projected >= cap;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://app.plexus.company";
  const monthKey = MONTH_KEY(now);

  if (overCap && !currentlyRevoked) {
    try {
      const { revoked } = await enforceSpendCap({
        orgId: org.orgId,
        orgName: org.orgName,
      });
      if (revoked === 0) return;
      console.log(
        `[report-usage] spend cap hit for ${org.orgId}: projected=${projected.toFixed(2)} cap=${cap.toFixed(2)}, revoked ${revoked} keys`,
      );
      const to = await findOrgAdminEmail(org.orgId);
      if (to) {
        await sendTransactionalEmail({
          to,
          subject: `Plexus: ${org.orgName} hit your spend cap — ingest paused`,
          html: spendCapBreachHtml({
            orgName: org.orgName,
            capUsd: cap,
            projectedUsd: projected,
            appUrl,
          }),
          idempotencyKey: `spend-cap-breach-${org.orgId}-${monthKey}`,
        });
      }
    } catch (err) {
      console.error(
        `[report-usage] spend cap enforcement failed for ${org.orgId}`,
        err,
      );
    }
    return;
  }

  if (!overCap && currentlyRevoked) {
    try {
      const { restored } = await restoreFromSpendCap(org.orgId);
      if (restored === 0) return;
      console.log(
        `[report-usage] spend cap cleared for ${org.orgId}, restored ${restored} keys`,
      );
      const to = await findOrgAdminEmail(org.orgId);
      if (to) {
        await sendTransactionalEmail({
          to,
          subject: `Plexus: ${org.orgName} is back online`,
          html: spendCapResumeHtml({ orgName: org.orgName, appUrl }),
          idempotencyKey: `spend-cap-resume-${org.orgId}-${monthKey}`,
        });
      }
    } catch (err) {
      console.error(
        `[report-usage] spend cap restore failed for ${org.orgId}`,
        err,
      );
    }
  }
}

interface BurnRateOrg {
  orgId: string;
  orgName: string;
  monthlySpendCapUsd: number | null;
  spendAlertSentForMonth: string | undefined;
}

async function reconcileBurnRateForOrg(
  org: BurnRateOrg,
  mtdUsage: UsageInfo,
  now: Date,
): Promise<void> {
  if (HIGH_BURN_THRESHOLDS_USD.length === 0) return;

  const projected = estimateMonthlyChargeUsd({
    metrics: mtdUsage.metricsThisMonth,
    logs: mtdUsage.logsThisMonth,
    videoHours: mtdUsage.videoHoursThisMonth,
  }).total;

  if (projected <= 0) return;

  const monthKey = MONTH_KEY(now);
  const billingRow = await adminOrgBillingQueries.findByOrgId(org.orgId);
  const alertedRaw = billingRow?.high_burn_thresholds_alerted as
    | Record<string, number[]>
    | null
    | undefined;
  const alertedThisMonth = Array.isArray(alertedRaw?.[monthKey])
    ? alertedRaw[monthKey]
    : [];

  const newlyCrossed = HIGH_BURN_THRESHOLDS_USD.filter(
    (t) => projected >= t && !alertedThisMonth.includes(t),
  );
  if (newlyCrossed.length === 0) return;

  const highest = newlyCrossed[newlyCrossed.length - 1];
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://app.plexus.company";

  const to = await findOrgAdminEmail(org.orgId);
  if (!to) return;

  const result = await sendTransactionalEmail({
    to,
    subject: `Plexus: ${org.orgName} projected to spend ${fmtUsd(projected)} this month`,
    html: highBurnAlertHtml({
      orgName: org.orgName,
      threshold: highest,
      projectedUsd: projected,
      capUsd: org.monthlySpendCapUsd,
      appUrl,
    }),
    idempotencyKey: `burn-alert-${org.orgId}-${monthKey}-${highest}`,
  });
  if (!result.success) {
    console.warn(
      `[report-usage] burn alert send failed for ${org.orgId}:`,
      result.error,
    );
    return;
  }

  const merged: Record<string, number[]> = {
    ...(alertedRaw && typeof alertedRaw === "object" ? alertedRaw : {}),
    [monthKey]: Array.from(
      new Set([...alertedThisMonth, ...newlyCrossed]),
    ).sort((a, b) => a - b),
  };
  await adminOrgBillingQueries.patch(org.orgId, { high_burn_thresholds_alerted: merged });
  console.log(
    `[report-usage] burn alert sent to ${org.orgId} at ${fmtUsd(highest)} (projected ${fmtUsd(projected)})`,
  );
}

export async function GET(request: NextRequest) {
  if (!isBillingEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripe();
  const now = new Date();

  // Fixed daily reporting window: previous full UTC day.
  // Identifier uses yesterdayKey so Stripe deduplicates any same-day re-runs.
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const startOfYesterday = new Date(
    startOfToday.getTime() - 24 * 60 * 60 * 1000,
  );
  const yesterdayKey = startOfYesterday.toISOString().slice(0, 10);
  const monthKey = MONTH_KEY(now);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://app.plexus.company";

  const reports: OrgReport[] = [];
  let enforced = 0;
  let emailed = 0;
  let scanned = 0;

  const allBillingRows = await adminOrgBillingQueries.findAll();

  for (const billing of allBillingRows) {
    scanned++;
    const tier = billing.tier === "tier_2" ? "tier_2" : "tier_1";
    if (tier !== "tier_1") continue;

    const orgId = billing.org_id;
    const orgName = billing.org_name ?? orgId;
    const status = billing.stripe_subscription_status;
    // past_due is a grace window: the billing gate keeps these orgs ingesting,
    // so their metered usage must still be reported to Stripe (Stripe accrues
    // it and bills once the payment recovers). Excluding past_due here dropped
    // usage on the floor for every org in dunning — matches the gate's own
    // isPaid definition (active | trialing | past_due).
    const isPaid =
      status === "active" || status === "trialing" || status === "past_due";
    const customerId = billing.stripe_customer_id;

    if (isPaid) {
      if (!customerId) {
        reports.push({ orgId, reported: 0, status: "skipped", error: "no stripe_customer_id" });
        continue;
      }

      // Two ClickHouse queries in parallel:
      //   stripeUsage — previous full day, sent to Stripe
      //   mtdUsage   — month-to-date, used for enforcement only
      let stripeUsage: UsageInfo;
      let mtdUsage: UsageInfo;
      try {
        [stripeUsage, mtdUsage] = await Promise.all([
          getUsageInfo(orgId, { from: startOfYesterday, to: startOfToday }),
          getUsageInfo(orgId),
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "clickhouse error";
        console.error(`[report-usage] usage query failed for ${orgId}:`, message);
        reports.push({ orgId, reported: 0, status: "error", error: message });
        continue;
      }

      // Report to Stripe
      let totalReported = 0;
      try {
        for (const meter of METERS) {
          const quantity = meter.quantity(stripeUsage);
          if (quantity <= 0) continue;
          await stripe.billing.meterEvents.create({
            event_name: meter.eventName,
            identifier: `${meter.key}-${orgId}-${yesterdayKey}`,
            timestamp: Math.floor(startOfYesterday.getTime() / 1000),
            payload: {
              stripe_customer_id: customerId,
              value: String(quantity),
            },
          });
          totalReported += quantity;
        }

        // AI tokens (Anthropic COGS). Staged off until STRIPE_AI_TOKENS_METER is
        // set to the meter's event name (confirmed: plexus_ai_tokens). Meter object:
        // mtr_61V4rJyhcz6nZnLVz41B3KofXyEDWSCG. Setting the env makes Stripe RECORD
        // the usage; to BILL it, bind a metered price to the meter and set
        // STRIPE_PRICE_ID_AI_TOKENS so the subscribe route attaches it as an item.
        const aiEventName = process.env.STRIPE_AI_TOKENS_METER;
        if (aiEventName) {
          const aiTokens = await getAiTokensForDay(orgId, startOfYesterday);
          if (aiTokens > 0) {
            await stripe.billing.meterEvents.create({
              event_name: aiEventName,
              identifier: `ai_tokens-${orgId}-${yesterdayKey}`,
              timestamp: Math.floor(startOfYesterday.getTime() / 1000),
              payload: {
                stripe_customer_id: customerId,
                value: String(aiTokens),
              },
            });
            totalReported += aiTokens;
          }
        }
        reports.push({ orgId, reported: totalReported, status: "ok" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "stripe error";
        console.error(`[report-usage] Stripe reporting failed for ${orgId}:`, message);
        reports.push({ orgId, reported: 0, status: "error", error: message });
      }

      // Spend cap and burn rate share mtdUsage — no extra ClickHouse queries
      const monthlySpendCapUsd =
        typeof billing.monthly_spend_cap_usd === "number" && billing.monthly_spend_cap_usd > 0
          ? billing.monthly_spend_cap_usd
          : null;
      const spendCapRevokedKeyIds = billing.spend_cap_revoked_key_ids ?? [];

      await reconcileSpendCapForOrg(
        { orgId, orgName, monthlySpendCapUsd, spendCapRevokedKeyIds },
        mtdUsage,
        now,
      );

      try {
        await reconcileBurnRateForOrg(
          { orgId, orgName, monthlySpendCapUsd, spendAlertSentForMonth: undefined },
          mtdUsage,
          now,
        );
      } catch (burnErr) {
        console.error(`[report-usage] burn-rate watcher failed for ${orgId}`, burnErr);
      }
    } else {
      // Unsubscribed tier_1: enforce team-tier hard stop if metrics exceeded
      let mtdUsage: UsageInfo;
      try {
        mtdUsage = await getUsageInfo(orgId);
      } catch {
        continue;
      }

      if (mtdUsage.metricsThisMonth <= TEAM_TIER_METRICS) continue;

      try {
        const { revoked } = await enforceTeamTierBreach({ orgId, orgName });

        const emailedFor = billing.free_tier_breach_email_sent_for_month;
        let didEmail = false;
        if (emailedFor !== monthKey) {
          const to = await findOrgAdminEmail(orgId);
          if (to) {
            const result = await sendTransactionalEmail({
              to,
              subject: `Plexus: ${orgName} needs a card on file`,
              html: subscriptionRequiredEmailHtml({
                orgName,
                dataPoints: mtdUsage.dataPointsThisMonth,
                appUrl,
              }),
              idempotencyKey: `subscription-required-${orgId}-${monthKey}`,
            });
            if (result.success) {
              await adminOrgBillingQueries.patch(orgId, {
                free_tier_breach_email_sent_for_month: monthKey,
              });
              didEmail = true;
            }
          }
        }

        if (revoked > 0) enforced++;
        if (didEmail) emailed++;
      } catch (err) {
        console.error(`[report-usage] team-tier enforcement failed for ${orgId}`, err);
      }
    }
  }

  return NextResponse.json({
    ranAt: now.toISOString(),
    reportingWindow: {
      from: startOfYesterday.toISOString(),
      to: startOfToday.toISOString(),
    },
    orgs: reports.length,
    reported: reports.filter((r) => r.status === "ok").length,
    skipped: reports.filter((r) => r.status === "skipped").length,
    errored: reports.filter((r) => r.status === "error").length,
    enforcement: { scanned, enforced, emailed },
    reports,
  });
}
