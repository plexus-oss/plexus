import "server-only";

/**
 * Server-side capability enforcement — the counterpart to the pure matrix in
 * `capabilities.ts` (which is import-safe from client code).
 *
 *   const caps = await getOrgCapabilities(orgId);
 *   // or, in a route:
 *   const denied = await requireCapability(orgId, "alerts");
 *   if (denied) return denied;
 */

import { NextResponse } from "next/server";
import { getOrgBilling } from "./server";
import {
  resolveCapabilities,
  type TierCapabilities,
  type BooleanCapabilityKey,
} from "./capabilities";

/** Resolve the full capability map for an org from its billing state. */
export async function getOrgCapabilities(
  orgId: string,
): Promise<TierCapabilities> {
  const billing = await getOrgBilling(orgId);
  return resolveCapabilities({ tier: billing.tier, isPaid: billing.isPaid });
}

/**
 * Gate an API route on a capability. Returns a 403 NextResponse when the org's
 * tier doesn't include it (null when allowed), so routes read:
 *
 *   const denied = await requireCapability(orgId, "alerts");
 *   if (denied) return denied;
 */
export async function requireCapability(
  orgId: string,
  key: BooleanCapabilityKey,
): Promise<NextResponse | null> {
  const caps = await getOrgCapabilities(orgId);
  if (caps[key]) return null;
  return NextResponse.json(
    { error: "upgrade_required", capability: key },
    { status: 403 },
  );
}
