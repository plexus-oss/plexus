/**
 * Full org deletion — used by account deletion when the user is the sole
 * member of an org.
 *
 * There is no organizations table: an org is an `org_id` string spread across
 * the tables below with no FK cascades on org_id, so deletion is an explicit
 * per-table sweep. External state (Stripe subscription/customer) is purged
 * BEFORE the Postgres transaction so a failure leaves the org rows
 * (including `org_billing.stripe_customer_id`) intact and the whole
 * operation retryable. ClickHouse telemetry is deliberately left in place —
 * see purgeOrgExternal.
 */

import "server-only";

import { and, count, eq } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getStripe } from "@/lib/stripe";
import { db } from "../client";
import {
  orgRolePermissions,
  orgRoles,
  alertEvents,
  alertRules,
  alerts,
  annotations,
  apiKeys,
  aiUsage,
  columnMetadata,
  dashboardIconAssets,
  dashboardPermissions,
  dashboardShareLinks,
  dashboardViews,
  dashboards,
  deviceAuthRequests,
  deviceSchemas,
  emailIntegrations,
  eventMonitors,
  feedback,
  notificationDeliveries,
  oauthAuthorizationCodes,
  orgBilling,
  orgInvites,
  orgMembers,
  recordings,
  runs,
  slackIntegrations,
  slackOauthStates,
  sourceAssociations,
  sourceContext,
  sourceGroups,
  sourceLimits,
  sourcePermissions,
  sources,
  systemEvents,
  terminalConversations,
  usage,
  userNotificationState,
  userSettings,
  users,
  webhookDeliveries,
  webhooks,
} from "../schema";

type OrgScopedTable = PgTable & { org_id: AnyPgColumn };

/**
 * Every table carrying an org_id column, children before parents so the sweep
 * works even without the inter-table FK cascades. `org_billing` is last — it
 * holds the Stripe customer id and acts as the retry anchor if an earlier
 * external purge failed. The drift-guard test in
 * lib/db/__tests__/org-delete.test.ts asserts this list stays in sync with
 * the schema.
 */
export const ORG_SCOPED_TABLES: OrgScopedTable[] = [
  alertEvents,
  alerts,
  alertRules,
  sourceLimits,
  eventMonitors,
  dashboardViews,
  dashboardShareLinks,
  dashboardPermissions,
  dashboards,
  dashboardIconAssets,
  webhookDeliveries,
  webhooks,
  sourceAssociations,
  sourceContext,
  sourcePermissions,
  sourceGroups,
  sources,
  deviceSchemas,
  columnMetadata,
  deviceAuthRequests,
  // Before apiKeys: codes FK-reference api_keys (SET NULL), and org deletion
  // must sweep pending consent grants with everything else.
  oauthAuthorizationCodes,
  apiKeys,
  aiUsage,
  annotations,
  runs,
  recordings,
  terminalConversations,
  emailIntegrations,
  slackIntegrations,
  slackOauthStates,
  notificationDeliveries,
  userNotificationState,
  orgInvites,
  orgRolePermissions,
  orgRoles,
  usage,
  systemEvents,
  feedback,
  orgMembers,
  orgBilling,
] as OrgScopedTable[];

export interface OrgDeleteResult {
  orgId: string;
  tablesCleared: number;
}

/** Delete every Postgres row belonging to the org, in one transaction. */
export async function deleteOrgCascade(orgId: string): Promise<OrgDeleteResult> {
  await db.transaction(async (tx) => {
    for (const table of ORG_SCOPED_TABLES) {
      await tx.delete(table).where(eq(table.org_id, orgId));
    }
  });
  console.log(
    `[org-delete] purged org ${orgId} across ${ORG_SCOPED_TABLES.length} tables`,
  );
  return { orgId, tablesCleared: ORG_SCOPED_TABLES.length };
}

/**
 * Purge external state for an org: cancel Stripe subscriptions + delete the
 * customer. Runs BEFORE deleteOrgCascade. Throws on real failures (caller
 * maps to a retryable 502); missing configuration or already-deleted
 * resources are skipped.
 *
 * ClickHouse telemetry is deliberately NOT purged (decision 2026-07-20):
 * every access path is org-scoped, so once the org rows are gone the data
 * is unreachable, and purging would require a write-capable ClickHouse
 * credential the app intentionally doesn't hold.
 */
export async function purgeOrgExternal(orgId: string): Promise<void> {
  await purgeStripeForOrg(orgId);
}

async function purgeStripeForOrg(orgId: string): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) return;

  const rows = await db
    .select({ customerId: orgBilling.stripe_customer_id })
    .from(orgBilling)
    .where(eq(orgBilling.org_id, orgId))
    .limit(1);
  const customerId = rows[0]?.customerId;
  if (!customerId) return;

  const stripe = getStripe();
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    for (const sub of subscriptions.data) {
      if (sub.status !== "canceled") {
        await stripe.subscriptions.cancel(sub.id);
      }
    }
    await stripe.customers.del(customerId);
  } catch (error) {
    if (isStripeResourceMissing(error)) return;
    throw error;
  }
}

function isStripeResourceMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "resource_missing"
  );
}

/**
 * Delete the user's own rows. Org rows are handled separately (deleteOrgCascade
 * for purged orgs, per-org membership deletes for surviving orgs) — the
 * org_members/notification/oauth-state sweeps here are idempotent safety nets.
 * Deleting `users` cascades auth_sessions + auth_accounts via FK.
 */
export async function deleteUserRows(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userSettings).where(eq(userSettings.user_id, userId));
    await tx
      .delete(userNotificationState)
      .where(eq(userNotificationState.user_id, userId));
    await tx
      .delete(slackOauthStates)
      .where(eq(slackOauthStates.user_id, userId));
    await tx.delete(orgMembers).where(eq(orgMembers.user_id, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });
}

// =============================================================================
// Account-deletion preflight
// =============================================================================

export type OrgDeletionAction = "delete_org" | "leave" | "blocked_last_admin";

export interface OrgDeletionPlan {
  orgId: string;
  name: string | null;
  role: string;
  memberCount: number;
  action: OrgDeletionAction;
}

/**
 * Pure classifier for one membership. Sole member → the org must be deleted
 * with the account; last admin of a multi-member org → the whole account
 * deletion is blocked until another admin exists.
 */
export function classifyMembership(
  role: string,
  memberCount: number,
  adminCount: number,
): OrgDeletionAction {
  if (memberCount <= 1) return "delete_org";
  if (role === "org:admin" && adminCount <= 1) return "blocked_last_admin";
  return "leave";
}

/** Per-org consequences of deleting the user's account. */
export async function getAccountDeletionPlan(
  userId: string,
): Promise<OrgDeletionPlan[]> {
  const memberships = await db
    .select({ org_id: orgMembers.org_id, role: orgMembers.role })
    .from(orgMembers)
    .where(eq(orgMembers.user_id, userId))
    .orderBy(orgMembers.created_at);

  const plans: OrgDeletionPlan[] = [];
  for (const membership of memberships) {
    const [memberRow] = await db
      .select({ members: count() })
      .from(orgMembers)
      .where(eq(orgMembers.org_id, membership.org_id));

    const [adminRow] = await db
      .select({ admins: count() })
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.org_id, membership.org_id),
          eq(orgMembers.role, "org:admin"),
        ),
      );

    const [billing] = await db
      .select({ name: orgBilling.org_name })
      .from(orgBilling)
      .where(eq(orgBilling.org_id, membership.org_id))
      .limit(1);

    const memberCount = memberRow?.members ?? 1;
    plans.push({
      orgId: membership.org_id,
      name: billing?.name ?? null,
      role: membership.role,
      memberCount,
      action: classifyMembership(
        membership.role,
        memberCount,
        adminRow?.admins ?? 0,
      ),
    });
  }
  return plans;
}
