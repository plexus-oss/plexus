/**
 * Team-tier enforcement.
 *
 * The cron (`/api/cron/report-usage`) calls `enforceTeamTierBreach` for
 * every tier_1 org without an active subscription that has crossed the
 * team monthly data-point limit. We:
 *   1. Soft-disable every active API key for the org (access_enabled=false)
 *      so ingest stops at the gateway's verify-key check (403) — the key
 *      row survives, so restore is instant and no device is re-flashed.
 *   2. Persist the list of disabled key ids in org_billing.free_tier_revoked_key_ids.
 *   3. Email an admin: "you crossed the free tier; subscribe to continue".
 *
 * The Stripe webhook (`/api/webhooks/stripe`) calls
 * `restoreFromTeamTierBreach` when a tier_1 org transitions to active or
 * trialing — it re-enables exactly the keys we disabled. The user's
 * existing keys keep working without them having to do anything, which is
 * what the breach email promises.
 */

import "server-only";

import { adminApiKeyQueries, adminOrgBillingQueries } from "@/lib/db/server";
import { clearOrgCache } from "./server";

interface OrgContext {
  orgId: string;
  orgName: string;
}

export async function enforceTeamTierBreach(
  ctx: OrgContext,
): Promise<{ revoked: number }> {
  const revokedIds = await adminApiKeyQueries.disableAllForOrgAndCollect(ctx.orgId);
  if (revokedIds.length === 0) return { revoked: 0 };

  const row = await adminOrgBillingQueries.findByOrgId(ctx.orgId);
  const existing = row?.free_tier_revoked_key_ids ?? [];
  const merged = Array.from(new Set([...existing, ...revokedIds]));

  await adminOrgBillingQueries.patch(ctx.orgId, { free_tier_revoked_key_ids: merged });
  clearOrgCache(ctx.orgId);

  return { revoked: revokedIds.length };
}

export async function restoreFromTeamTierBreach(
  orgId: string,
): Promise<{ restored: number }> {
  const row = await adminOrgBillingQueries.findByOrgId(orgId);
  const ids = row?.free_tier_revoked_key_ids ?? [];
  if (ids.length === 0) return { restored: 0 };

  const restored = await adminApiKeyQueries.setAccessEnabledByIds(ids, true);

  await adminOrgBillingQueries.patch(orgId, { free_tier_revoked_key_ids: [] });
  clearOrgCache(orgId);

  return { restored };
}

export async function enforceSpendCap(
  ctx: OrgContext,
): Promise<{ revoked: number }> {
  const revokedIds = await adminApiKeyQueries.disableAllForOrgAndCollect(ctx.orgId);
  if (revokedIds.length === 0) return { revoked: 0 };

  const row = await adminOrgBillingQueries.findByOrgId(ctx.orgId);
  const existing = row?.spend_cap_revoked_key_ids ?? [];
  const merged = Array.from(new Set([...existing, ...revokedIds]));

  await adminOrgBillingQueries.patch(ctx.orgId, { spend_cap_revoked_key_ids: merged });
  clearOrgCache(ctx.orgId);

  return { revoked: revokedIds.length };
}

export async function restoreFromSpendCap(
  orgId: string,
): Promise<{ restored: number }> {
  const row = await adminOrgBillingQueries.findByOrgId(orgId);
  const ids = row?.spend_cap_revoked_key_ids ?? [];
  if (ids.length === 0) return { restored: 0 };

  const restored = await adminApiKeyQueries.setAccessEnabledByIds(ids, true);

  await adminOrgBillingQueries.patch(orgId, { spend_cap_revoked_key_ids: [] });
  clearOrgCache(orgId);

  return { restored };
}
