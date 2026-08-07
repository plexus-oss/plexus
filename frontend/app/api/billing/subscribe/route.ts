/**
 * POST /api/billing/subscribe
 *
 * Body: { setupIntentId: string }
 *
 * Called from the AddCardModal after the inline SetupIntent confirms
 * client-side. We look up the SetupIntent, attach its payment method as
 * the customer's default for invoices, and create the metered tier_1
 * subscription. The webhook fires `customer.subscription.created`
 * straight after, which flips `stripe_subscription_status` to active and
 * restores any revoked keys (no-op for new orgs).
 *
 * Idempotent: if the customer already has a subscription, we return it
 * instead of creating a duplicate.
 */

import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { resolveOrgRole } from "@/lib/auth/org-role";
import type Stripe from "stripe";
import { getStripe, getOrCreateStripeCustomer } from "@/lib/stripe";
import { apiError, errorResponse } from "@/lib/api/errors";
import {
  clearOrgCache,
  getOrgBilling,
  syncApiKeyAccess,
} from "@/lib/billing/server";
import { adminOrgBillingQueries } from "@/lib/db/server";
import { isBillingEnabled } from "@/lib/billing/config";

type StoredStatus = "active" | "trialing" | "past_due" | "canceled";

function mapStripeStatus(status: string): StoredStatus {
  // The webhook is the source of truth long-term; this just buys us
  // a synchronous write so /api/usage doesn't lie about isPaid for the
  // few seconds it takes Stripe to deliver subscription.created.
  if (status === "trialing") return "trialing";
  if (status === "past_due") return "past_due";
  if (status === "canceled" || status === "unpaid") return "canceled";
  // active, incomplete, default-on-create: treat as active for UI
  // purposes. The webhook will downgrade later if the card 3DS-fails.
  return "active";
}

export async function POST(request: Request) {
  if (!isBillingEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const { userId, orgId, orgRole } = await getAuth();
    if (!userId || !orgId) {
      throw apiError("UNAUTHORIZED", "Sign in and select an organization first");
    }
    // Billing is admin-only.
    if ((await resolveOrgRole(orgId, userId, orgRole)) !== "org:admin") {
      throw apiError("FORBIDDEN", "Billing is managed by org admins");
    }

    // Three metered prices, one per category, billed against the matching
    // Stripe meter. The cron in app/api/cron/report-usage emits separate
    // meter events for plexus_metrics / plexus_logs / plexus_video_hours.
    const priceIds = [
      process.env.STRIPE_PRICE_ID_METRICS,
      process.env.STRIPE_PRICE_ID_LOGS,
      process.env.STRIPE_PRICE_ID_VIDEO_HOURS,
    ];
    if (priceIds.some((id) => !id)) {
      throw apiError(
        "INTERNAL_ERROR",
        "STRIPE_PRICE_ID_METRICS, STRIPE_PRICE_ID_LOGS, and STRIPE_PRICE_ID_VIDEO_HOURS must all be configured",
      );
    }

    // AI tokens (Anthropic COGS) — a fourth metered price bound to the
    // plexus_ai_tokens meter. Optional: attached only when STRIPE_PRICE_ID_AI_TOKENS
    // is set, so orgs still subscribe cleanly before AI billing is turned on.
    // Emitting the meter events (STRIPE_AI_TOKENS_METER in the report-usage cron)
    // records usage on the meter; this subscription item is what actually bills it.
    // Existing subscriptions predating this env are not backfilled here — add the
    // item to them via the Stripe dashboard or a one-off script if needed.
    if (process.env.STRIPE_PRICE_ID_AI_TOKENS) {
      priceIds.push(process.env.STRIPE_PRICE_ID_AI_TOKENS);
    }

    const body = (await request.json().catch(() => ({}))) as {
      setupIntentId?: string;
    };
    if (typeof body.setupIntentId !== "string" || body.setupIntentId.length === 0) {
      throw apiError("VALIDATION_ERROR", "setupIntentId is required");
    }

    const stripe = getStripe();
    const setupIntent = await stripe.setupIntents.retrieve(body.setupIntentId);

    if (setupIntent.metadata?.org_id !== orgId) {
      throw apiError(
        "FORBIDDEN",
        "SetupIntent does not belong to this organization",
      );
    }
    if (setupIntent.status !== "succeeded") {
      throw apiError(
        "VALIDATION_ERROR",
        `SetupIntent is ${setupIntent.status}, expected succeeded`,
      );
    }
    const paymentMethodId =
      typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id;
    if (!paymentMethodId) {
      throw apiError("VALIDATION_ERROR", "SetupIntent has no payment method");
    }

    const customerId = await getOrCreateStripeCustomer(orgId, userId);

    // Make this card the default for both new invoices and any existing
    // subscription. Stripe charges meter-based invoices using
    // invoice_settings.default_payment_method.
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Idempotency: if this org already has an active/incomplete sub, don't
    // create a second one — just hand it back. Reaching this branch
    // usually means a duplicate modal submit or a webhook race.
    const existing = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 1,
    });
    const reusable = existing.data.find(
      (s) => s.status !== "canceled" && s.status !== "incomplete_expired",
    );
    if (reusable) {
      await syncOrgStatus(orgId, mapStripeStatus(reusable.status));
      await syncApiKeyAccess(orgId);
      return NextResponse.json({ subscriptionId: reusable.id, status: reusable.status });
    }

    // A negotiated recurring platform fee (set on org_billing as
    // `platform_fee_usd`) rides on this same subscription as a flat monthly
    // line item ahead of the meters, so the customer gets one invoice — fee
    // + usage — not two. Ordinary usage-only orgs have no fee and this block
    // is skipped, leaving their subscription created exactly as before.
    const { platformFeeUsd } = await getOrgBilling(orgId);

    const items: Stripe.SubscriptionCreateParams.Item[] = priceIds.map(
      (price) => ({ price: price as string }),
    );
    if (platformFeeUsd) {
      const feeProduct = process.env.STRIPE_PRODUCT_ID_PLATFORM_FEE;
      if (!feeProduct) {
        throw apiError(
          "INTERNAL_ERROR",
          "STRIPE_PRODUCT_ID_PLATFORM_FEE must be set to bill a platform fee",
        );
      }
      items.unshift({
        price_data: {
          currency: "usd",
          product: feeProduct,
          unit_amount: Math.round(platformFeeUsd * 100),
          recurring: { interval: "month" },
        },
        quantity: 1,
      });
    }

    const couponId = process.env.STRIPE_MONTHLY_CREDIT_COUPON_ID ?? "first_5_free";
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items,
      default_payment_method: paymentMethodId,
      metadata: { org_id: orgId },
      // Usage-only subs have a $0 first invoice and activate immediately under
      // default_incomplete. With a platform fee the first invoice is the full
      // month's fee, which we charge against the just-saved card right away —
      // error_if_incomplete makes the create call throw on a decline/SCA bounce
      // instead of leaving the subscription dangling in `incomplete`.
      payment_behavior: platformFeeUsd
        ? "error_if_incomplete"
        : "default_incomplete",
      // No proration math needed — usage is metered and the platform fee is
      // billed as a full month from the start of each period.
      proration_behavior: "none",
      // $5/month credit — coupon "first_5_free" (amount_off: 500, repeating).
      // Override via STRIPE_MONTHLY_CREDIT_COUPON_ID for staging environments.
      // Platform-fee customers are on a negotiated plan and don't get the
      // credit; their invoice is exactly platform fee + usage.
      ...(platformFeeUsd ? {} : { discounts: [{ coupon: couponId }] }),
    });

    await syncOrgStatus(orgId, mapStripeStatus(subscription.status));
    await syncApiKeyAccess(orgId);

    return NextResponse.json({
      subscriptionId: subscription.id,
      status: subscription.status,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Write `stripe_subscription_status` to org_billing and bust the
 * billing cache so the next /api/usage read reflects reality. Best-effort:
 * a failure here doesn't fail the request — the webhook will still
 * eventually sync, and the worst case is a few extra seconds of stale
 * isPaid=false on the dashboard.
 */
async function syncOrgStatus(orgId: string, status: StoredStatus): Promise<void> {
  try {
    await adminOrgBillingQueries.patch(orgId, { stripe_subscription_status: status });
    clearOrgCache(orgId);
  } catch (err) {
    console.warn(
      `[billing/subscribe] could not sync org ${orgId} status=${status} (will be reconciled by webhook):`,
      err,
    );
  }
}
