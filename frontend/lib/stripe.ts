/**
 * Stripe singleton client.
 *
 * Required env vars (set in .env.local + production):
 *   STRIPE_SECRET_KEY            sk_test_... / sk_live_...
 *   STRIPE_WEBHOOK_SECRET        whsec_... (from the Stripe webhook endpoint)
 *   STRIPE_PRICE_ID_METRICS      price_... ($0.10/M, meter=plexus_metrics)
 *   STRIPE_PRICE_ID_LOGS         price_... ($0.10/M, meter=plexus_logs)
 *   STRIPE_PRICE_ID_VIDEO_HOURS  price_... ($0.25/hr, meter=plexus_video_hours)
 *   STRIPE_PRODUCT_ID_PLATFORM_FEE  prod_... (optional; shared product that
 *                                per-org recurring platform-fee line items
 *                                attach to. Required only for orgs whose
 *                                org_billing.platform_fee_usd is set.)
 *   NEXT_PUBLIC_APP_URL          https://app.plexus.company (for return URLs)
 *   CRON_SECRET                  random string; sent in Authorization
 *                                header by Vercel Cron and checked by
 *                                /api/cron/* routes
 */

import "server-only";
import Stripe from "stripe";
import { adminOrgBillingQueries } from "@/lib/db/server";
import { clearOrgCache } from "@/lib/billing/server";

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  cached = new Stripe(key, {
    // Pin the API version. Bump deliberately when upgrading the SDK.
    apiVersion: "2026-04-22.dahlia",
    typescript: true,
  });
  return cached;
}

export function getAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_APP_URL is not set");
  }
  return url.replace(/\/$/, "");
}

/**
 * Returns the Stripe customer id for an org, creating one (and stashing
 * it in `org_billing`) the first time we touch billing for the org.
 * Used by setup-intent, subscribe, checkout, portal — anywhere we need
 * a guaranteed customer.
 */
export async function getOrCreateStripeCustomer(
  orgId: string,
  userId: string,
): Promise<string> {
  const row = await adminOrgBillingQueries.findByOrgId(orgId);
  if (row?.stripe_customer_id) return row.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    metadata: { org_id: orgId, user_id: userId },
  });
  await adminOrgBillingQueries.upsert(orgId, { stripe_customer_id: customer.id });
  clearOrgCache(orgId);
  return customer.id;
}
