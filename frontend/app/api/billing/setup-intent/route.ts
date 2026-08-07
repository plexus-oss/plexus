/**
 * POST /api/billing/setup-intent
 *
 * Returns a Stripe SetupIntent client_secret for inline card collection
 * via Stripe Elements. We use a SetupIntent (not PaymentIntent) because
 * Plexus is usage-billed: we save the card now, charge nothing until the
 * end of the period when meter events accrue.
 *
 * The actual subscription is created in POST /api/billing/subscribe once
 * the SetupIntent confirms successfully on the client.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { getStripe, getOrCreateStripeCustomer } from "@/lib/stripe";
import { apiError } from "@/lib/api/errors";

export const POST = withAuth(async (_request, { userId, orgId }) => {
  const customerId = await getOrCreateStripeCustomer(orgId, userId);
  const stripe = getStripe();

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    // off_session: card will later be charged automatically as meter
    // events accrue invoices. Triggers SCA exemption flows where the
    // issuer supports them.
    usage: "off_session",
    payment_method_types: ["card"],
    metadata: { org_id: orgId },
  });

  if (!setupIntent.client_secret) {
    throw apiError("INTERNAL_ERROR", "Stripe did not return a client secret");
  }

  return NextResponse.json({
    clientSecret: setupIntent.client_secret,
    customerId,
  });
});
