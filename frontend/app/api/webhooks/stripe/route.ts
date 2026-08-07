/**
 * POST /api/webhooks/stripe
 *
 * Source of truth: Stripe events drive `org_billing.stripe_subscription_status`,
 * plus disable API keys (access_enabled=false) on hard cancel. The frontend
 * reads that status via `getOrgBilling()`.
 *
 * Events handled:
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted   → status canceled + disable keys
 *   customer.updated                → re-sync key access on card add/remove
 *   invoice.payment_failed          → status past_due
 *
 * Configure the webhook in Stripe → Developers → Webhooks pointing at
 * https://app.plexus.company/api/webhooks/stripe with the five events
 * above, then drop the signing secret into STRIPE_WEBHOOK_SECRET.
 *
 * The route is also added to the public matcher in middleware.ts so it
 * doesn't try to authenticate via a user session (Stripe is the
 * authenticator here, via the signature header).
 */

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { clearOrgCache, syncApiKeyAccess } from "@/lib/billing/server";
import { adminOrgBillingQueries } from "@/lib/db/server";
import {
  findOrgAdminEmail,
  sendTransactionalEmail,
} from "@/lib/email/transactional";
import { isBillingEnabled } from "@/lib/billing/config";

function paymentFailedHtml(args: { orgName: string; appUrl: string }): string {
  return `
    <p>Hi —</p>
    <p>Stripe wasn't able to charge the card on file for your Plexus org
       <strong>${args.orgName}</strong>. Your subscription is now
       <strong>past due</strong>.</p>
    <p>Stripe will retry the charge automatically over the next few days.
       If it keeps failing, your subscription will be canceled and your
       API keys will be revoked.</p>
    <p>To avoid an interruption, update your card now:</p>
    <p><a href="${args.appUrl}/settings?tab=billing">Update payment method →</a></p>
    <p>— Plexus Billing</p>
  `;
}

type StripeStatus = "active" | "trialing" | "past_due" | "canceled";

function mapStripeStatus(status: Stripe.Subscription.Status): StripeStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
    case "paused":
      return "past_due";
    default:
      return "canceled";
  }
}

async function findOrgIdForSubscription(
  sub: Stripe.Subscription,
): Promise<string | null> {
  // Preferred: org_id in subscription metadata (set by checkout).
  const subOrg = (sub.metadata ?? {}).org_id;
  if (typeof subOrg === "string" && subOrg.length > 0) return subOrg;

  // Fallback: customer metadata (set when we created the customer).
  if (typeof sub.customer === "string") {
    const customer = await getStripe().customers.retrieve(sub.customer);
    if (!customer.deleted) {
      const orgId = (customer.metadata ?? {}).org_id;
      if (orgId) return orgId;
    }
  }
  return null;
}

async function setOrgStatus(
  orgId: string,
  status: StripeStatus,
): Promise<void> {
  await adminOrgBillingQueries.patch(orgId, { stripe_subscription_status: status });
  clearOrgCache(orgId);
}

export async function POST(request: NextRequest) {
  if (!isBillingEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 },
    );
  }

  const headerPayload = await headers();
  const signature = headerPayload.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  const body = await request.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error("[Stripe Webhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const orgId = await findOrgIdForSubscription(sub);
        if (!orgId) {
          console.warn(
            `[Stripe Webhook] ${event.type} has no org_id (sub ${sub.id})`,
          );
          break;
        }
        const mapped = mapStripeStatus(sub.status);
        await setOrgStatus(orgId, mapped);
        await syncApiKeyAccess(orgId);
        console.log(
          `[Stripe Webhook] ${orgId} → ${sub.status} (${event.type})`,
        );
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const orgId = await findOrgIdForSubscription(sub);
        if (!orgId) {
          console.warn(
            `[Stripe Webhook] subscription.deleted has no org_id (sub ${sub.id})`,
          );
          break;
        }
        await setOrgStatus(orgId, "canceled");
        await syncApiKeyAccess(orgId);
        console.log(`[Stripe Webhook] ${orgId} canceled — access_enabled=false`);
        break;
      }
      case "invoice.payment_failed": {
        // Stripe API 2026-04-22 (dahlia) removed `Invoice.subscription`.
        // Subscription id now lives on
        // `invoice.parent.subscription_details.subscription` for
        // subscription-driven invoices. Fall back to the legacy field for
        // any older event shape that might still be in flight.
        const invoice = event.data.object as Stripe.Invoice & {
          subscription?: string | Stripe.Subscription | null;
          parent?: {
            type?: string;
            subscription_details?: {
              subscription?: string | Stripe.Subscription | null;
            };
          } | null;
        };
        const subFromParent =
          invoice.parent?.subscription_details?.subscription;
        const subRef =
          typeof subFromParent !== "undefined" && subFromParent !== null
            ? subFromParent
            : invoice.subscription;
        const subId =
          typeof subRef === "string" ? subRef : subRef?.id;
        if (!subId) break;
        const sub = await stripe.subscriptions.retrieve(subId);
        const orgId = await findOrgIdForSubscription(sub);
        if (!orgId) break;
        await setOrgStatus(orgId, "past_due");
        await syncApiKeyAccess(orgId);
        console.log(`[Stripe Webhook] ${orgId} → past_due (payment failed)`);

        const to = await findOrgAdminEmail(orgId);
        if (to) {
          const billing = await adminOrgBillingQueries.findByOrgId(orgId);
          const orgName = billing?.org_name ?? orgId;
          const appUrl =
            process.env.NEXT_PUBLIC_APP_URL || "https://app.plexus.company";
          await sendTransactionalEmail({
            to,
            subject: `Plexus: payment failed for ${orgName}`,
            html: paymentFailedHtml({ orgName, appUrl }),
            idempotencyKey: `payment-failed-${invoice.id}`,
          });
        }
        break;
      }
      case "customer.updated": {
        // Fires when a card is added or removed (e.g. via the billing portal).
        // Re-evaluate access so a card removal takes effect immediately.
        const customer = event.data.object as Stripe.Customer;
        const orgId = (customer.metadata ?? {}).org_id;
        if (!orgId) break;
        await syncApiKeyAccess(orgId);
        console.log(`[Stripe Webhook] ${orgId} customer updated — access synced`);
        break;
      }
      default:
        // Ignore other events; subscribing to fewer is also fine.
        break;
    }
  } catch (error) {
    console.error("[Stripe Webhook] Handler error:", error);
    // Return 500 so Stripe retries — they auto-retry failed webhooks.
    return NextResponse.json(
      { error: "Internal error processing event" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
