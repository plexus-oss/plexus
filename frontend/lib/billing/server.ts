/**
 * Billing — dead simple.
 *
 * Two tiers:
 *   tier_1 — self-serve, billed monthly via Stripe meter events.
 *            UI is restricted to: Data, API keys, Cost, Settings.
 *   tier_2 — sales-led (headless cloud, contract-based).
 *            UI is the full Plexus app. No Stripe required.
 *
 * Billing state lives in the `org_billing` Supabase table — one row per
 * org, service-role access only (see adminOrgBillingQueries):
 *   tier:                       "tier_1" | "tier_2"
 *   stripe_subscription_status: relevant for tier_1 only
 *
 * Orgs without a row resolve to tier_1/none and a default row is
 * self-healed on first read.
 *
 * isPaid:
 *   tier_2                                     → true (always)
 *   tier_1 + status active|trialing|past_due   → true (past_due is a grace
 *                                                window — Stripe retries
 *                                                payment for ~3 weeks via
 *                                                Smart Retries before
 *                                                giving up. Locking the
 *                                                customer out on the first
 *                                                failed retry is too
 *                                                aggressive; we wait for
 *                                                subscription.deleted to
 *                                                hard-revoke.)
 *   tier_1 + status missing|canceled           → false
 */

import "server-only";
import { getStripe } from "@/lib/stripe";
import { adminApiKeyQueries, adminOrgBillingQueries } from "@/lib/db/server";
import { isBillingEnabled } from "./config";
import type { OrgBillingRow } from "@/lib/db/server";

export type Tier = "tier_1" | "tier_2";

export type BillingStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "bypassed" // tier_2: no Stripe required
  | "none";

/**
 * Optional contract metadata for tier_2 customers, stored in
 * org_billing.enterprise_info. Surfaced in the subscription tab so
 * customers know who their account team is and when their contract renews.
 */
export interface EnterpriseInfo {
  accountManager?: string;
  accountManagerEmail?: string;
  contractRenewalDate?: string; // ISO date or YYYY-MM-DD
}

/**
 * Pricing constants. Plexus is usage-priced across three categories that
 * map 1:1 to three Stripe meters:
 *
 *   metrics    — numeric telemetry rows (battery_v, temp_c, etc.)
 *   logs       — string/event rows (status changes, structured logs)
 *   videoHours — hours of streamed video relayed through the gateway
 *
 * The Stripe dashboard must mirror this: three metered prices, one per
 * meter, each unit-priced as below. Keeping the two aligned is a
 * sales/ops responsibility.
 *
 * There is no free usage allotment (TEAM_TIER_* default to 0 below):
 * everything is billed from the first data point / first video hour, and a
 * card is required to keep ingesting. Self-serve subscriptions instead get
 * a $5/month Stripe coupon credit (MONTHLY_CREDIT_USD, coupon
 * "first_5_free" applied in app/api/billing/subscribe) so new users can
 * feel the product before real charges land. UI copy, enforcement, and
 * projected-charge math all read from these constants so a single env var
 * moves the wall.
 */
export const PRICE_PER_MILLION_METRICS_USD = Number(
  process.env.BILLING_PRICE_PER_MILLION_METRICS_USD ?? "0.10",
);
export const PRICE_PER_MILLION_LOGS_USD = Number(
  process.env.BILLING_PRICE_PER_MILLION_LOGS_USD ?? "0.10",
);
export const PRICE_PER_VIDEO_HOUR_USD = Number(
  process.env.BILLING_PRICE_PER_VIDEO_HOUR_USD ?? "0.25",
);
// No free allotment: Plexus is usage-priced from the first data point and a
// card is required to keep ingesting. A cardless org that sends any data trips
// the report-usage enforcement, which soft-disables its keys (restorable the
// moment a card is added). Overridable via env if a promo allotment is ever
// reintroduced. (The old 100k/10k free rows were replaced by the live
// $5/month Stripe coupon credit — see MONTHLY_CREDIT_USD below and the
// "first_5_free" coupon in app/api/billing/subscribe/route.ts.)
export const TEAM_TIER_METRICS = Number(
  process.env.BILLING_TEAM_TIER_METRICS ?? "0",
);
export const TEAM_TIER_LOGS = Number(
  process.env.BILLING_TEAM_TIER_LOGS ?? "0",
);

/**
 * $5/month Stripe coupon credit ("first_5_free", amount_off: 500, repeating)
 * applied to self-serve subscriptions in app/api/billing/subscribe/route.ts.
 * Keep in sync with the Stripe coupon amount.
 */
export const MONTHLY_CREDIT_USD = 5;

export interface BillableUsage {
  metrics: number;
  logs: number;
  videoHours: number;
}

export interface ChargeBreakdown {
  metrics: number;
  logs: number;
  video: number;
  total: number;
}

/** Estimated monthly charge in USD given month-to-date usage by category. */
export function estimateMonthlyChargeUsd(
  usage: BillableUsage | number,
): ChargeBreakdown {
  // Back-compat: a bare number is treated as metrics-only usage. New
  // callers should pass a BillableUsage object.
  const u: BillableUsage =
    typeof usage === "number"
      ? { metrics: usage, logs: 0, videoHours: 0 }
      : usage;

  const billableMetrics = Math.max(0, u.metrics - TEAM_TIER_METRICS);
  const metrics = (billableMetrics / 1_000_000) * PRICE_PER_MILLION_METRICS_USD;
  const billableLogs = Math.max(0, u.logs - TEAM_TIER_LOGS);
  const logs = (billableLogs / 1_000_000) * PRICE_PER_MILLION_LOGS_USD;
  const video = Math.max(0, u.videoHours) * PRICE_PER_VIDEO_HOUR_USD;
  return { metrics, logs, video, total: metrics + logs + video };
}

export interface OrgBilling {
  tier: Tier;
  status: BillingStatus;
  isPaid: boolean;
  enterpriseInfo?: EnterpriseInfo;
  /** User-configured monthly spend cap in USD; null = no cap. */
  monthlySpendCapUsd: number | null;
  /**
   * Negotiated recurring platform fee in USD/month for this org, billed on
   * the same subscription as metered usage (one invoice). Stored in
   * `org_billing.platform_fee_usd` (set by sales). null = no platform fee,
   * the default for ordinary usage-only customers.
   */
  platformFeeUsd: number | null;
}

const cache = new Map<string, { value: OrgBilling; expiresAt: number }>();
const TTL_MS = 30 * 1000; // 30s — DB reads are fast; short TTL avoids stale feature gates

const BILLING_DISABLED_RESPONSE: OrgBilling = {
  tier: "tier_2",
  status: "bypassed",
  isPaid: true,
  enterpriseInfo: undefined,
  monthlySpendCapUsd: null,
  platformFeeUsd: null,
};

function rowToOrgBilling(row: OrgBillingRow): OrgBilling {
  const tier: Tier = row.tier === "tier_2" ? "tier_2" : "tier_1";

  let status: BillingStatus = "none";
  if (tier === "tier_2") {
    status = "bypassed";
  } else if (row.stripe_subscription_status) {
    const s = row.stripe_subscription_status;
    if (s === "active" || s === "trialing" || s === "past_due" || s === "canceled") {
      status = s;
    }
  }

  const eiRaw = row.enterprise_info as Record<string, unknown> | null;
  const enterpriseInfo: EnterpriseInfo | undefined =
    tier === "tier_2" && eiRaw
      ? {
          accountManager: typeof eiRaw.accountManager === "string" ? eiRaw.accountManager : undefined,
          accountManagerEmail: typeof eiRaw.accountManagerEmail === "string" ? eiRaw.accountManagerEmail : undefined,
          contractRenewalDate: typeof eiRaw.contractRenewalDate === "string" ? eiRaw.contractRenewalDate : undefined,
        }
      : undefined;

  return {
    tier,
    status,
    isPaid: status === "active" || status === "trialing" || status === "past_due" || status === "bypassed",
    enterpriseInfo,
    monthlySpendCapUsd: typeof row.monthly_spend_cap_usd === "number" && row.monthly_spend_cap_usd > 0
      ? row.monthly_spend_cap_usd : null,
    platformFeeUsd: typeof row.platform_fee_usd === "number" && row.platform_fee_usd > 0
      ? row.platform_fee_usd : null,
  };
}

export async function getOrgBilling(orgId: string): Promise<OrgBilling> {
  if (!isBillingEnabled()) return BILLING_DISABLED_RESPONSE;

  const cached = cache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const row = await adminOrgBillingQueries.findByOrgId(orgId);
    if (!row) {
      // Self-heal: org predates the org_billing table or its creation
      // webhook was missed. Insert a default row so later writes (spend
      // cap, Stripe status) and cron enforcement can see this org.
      // Fire-and-forget — this request still serves the tier_1 default.
      adminOrgBillingQueries.upsert(orgId, {}).catch((err) => {
        console.warn(`[Billing] could not self-heal org_billing row for ${orgId}`, err);
      });
    }
    const value = row ? rowToOrgBilling(row) : {
      tier: "tier_1" as Tier,
      status: "none" as BillingStatus,
      isPaid: false,
      enterpriseInfo: undefined,
      monthlySpendCapUsd: null,
      platformFeeUsd: null,
    };
    cache.set(orgId, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch (error) {
    if (cached) {
      console.warn(`[Billing] DB read failed for ${orgId}, serving stale cache`, error);
      return cached.value;
    }
    console.error(`[Billing] DB read failed for ${orgId}, no cache`, error);
    throw error;
  }
}

export const clearOrgCache = (orgId: string): void => {
  cache.delete(orgId);
};

/**
 * Determine whether an org should have API access:
 *   tier_2 (enterprise) → always true
 *   otherwise           → true only if a default Stripe payment method is on file
 */
export async function computeAccessEnabled(orgId: string): Promise<boolean> {
  if (!isBillingEnabled()) return true;

  const row = await adminOrgBillingQueries.findByOrgId(orgId);
  if (row?.tier === "tier_2") return true;

  const customerId = row?.stripe_customer_id;
  if (!customerId) return false;

  const customer = await getStripe().customers.retrieve(customerId);
  if (customer.deleted) return false;
  return !!customer.invoice_settings?.default_payment_method;
}

/**
 * Recompute access for an org and bulk-update all its API keys.
 * Call this from any billing event that might change access (subscription
 * changes, card add/remove, payment failure).
 */
export async function syncApiKeyAccess(orgId: string): Promise<void> {
  const enabled = await computeAccessEnabled(orgId);
  const updated = await adminApiKeyQueries.setAccessEnabledForOrg(
    orgId,
    enabled,
  );
  console.log(
    `[billing] syncApiKeyAccess ${orgId} → ${enabled} (${updated} keys)`,
  );
}

/** Compatibility shim — old name. New code should use clearOrgCache. */
export const clearPlanCache = clearOrgCache;
