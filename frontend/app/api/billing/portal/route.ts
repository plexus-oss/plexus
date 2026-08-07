/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Customer Portal session for the current org and
 * redirects there. The portal handles upgrade/downgrade/cancel/payment
 * method UI for free, so we don't build any of that.
 *
 * 303 redirect; safe to use as <Link href="/api/billing/portal">.
 */

import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { resolveOrgRole } from "@/lib/auth/org-role";
import { getStripe, getAppUrl } from "@/lib/stripe";
import { adminOrgBillingQueries } from "@/lib/db/server";
import { apiError, errorResponse } from "@/lib/api/errors";
import { isBillingEnabled } from "@/lib/billing/config";

export async function POST() {
  if (!isBillingEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const { userId, orgId, orgRole } = await getAuth();
    if (!userId || !orgId) {
      throw apiError(
        "UNAUTHORIZED",
        "Sign in and select an organization first",
      );
    }
    // Billing is admin-only.
    if ((await resolveOrgRole(orgId, userId, orgRole)) !== "org:admin") {
      throw apiError("FORBIDDEN", "Billing is managed by org admins");
    }

    const row = await adminOrgBillingQueries.findByOrgId(orgId);
    const customerId = row?.stripe_customer_id;

    if (!customerId) {
      throw apiError(
        "NOT_FOUND",
        "No card on file yet. Add one from the dashboard first.",
      );
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getAppUrl()}/settings?tab=billing`,
    });

    return NextResponse.redirect(session.url, { status: 303 });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = POST;
