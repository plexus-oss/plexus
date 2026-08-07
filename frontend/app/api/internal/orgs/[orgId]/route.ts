/**
 * Internal Admin: Org Detail
 *
 * GET    /api/internal/orgs/[orgId] — overview: billing, counts, usage, members.
 * DELETE /api/internal/orgs/[orgId] — delete the org via the org-delete
 *        engine (Stripe purged first, then the Postgres cascade). Body
 *        { confirm, deleteUsers }: `confirm` must equal the org name
 *        (server re-check), `deleteUsers` also deletes member accounts
 *        whose ONLY membership is this org (never staff accounts, never
 *        the acting user).
 *
 * Staff-only. ClickHouse telemetry is deliberately retained (org-scoped,
 * unreachable once the org is gone — see purgeOrgExternal). Other known
 * cleanup gaps (follow-ups, not handled here): R2/Tigris frame blobs,
 * dashboard-icon + source-context bucket objects, recorder videos, loader
 * source deregistration.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  alertRules,
  alerts,
  apiKeys,
  dashboards,
  eventMonitors,
  orgBilling,
  orgMembers,
  sources,
  usage,
  users,
} from "@/lib/db/schema";
import {
  deleteOrgCascade,
  deleteUserRows,
  purgeOrgExternal,
} from "@/lib/db/queries/org-delete";
import { adminOrgMemberQueries } from "@/lib/db/server";
import { withPlexusStaff } from "@/lib/api/with-auth";
import { apiError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { IMPERSONATE_ORG_COOKIE } from "@/lib/auth/constants";
import { InternalOrgDeleteSchema } from "@/lib/validation/api-schemas";

interface OrgCore {
  billing: {
    org_name: string | null;
    tier: string;
    stripe_customer_id: string | null;
    stripe_subscription_status: string | null;
    org_created_at: string | null;
  } | null;
  members: Array<{
    user_id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    image_url: string | null;
    role: string;
    created_at: string;
  }>;
}

async function loadOrgCore(orgId: string): Promise<OrgCore> {
  const [billingRows, memberRows] = await Promise.all([
    db
      .select({
        org_name: orgBilling.org_name,
        tier: orgBilling.tier,
        stripe_customer_id: orgBilling.stripe_customer_id,
        stripe_subscription_status: orgBilling.stripe_subscription_status,
        org_created_at: orgBilling.org_created_at,
      })
      .from(orgBilling)
      .where(eq(orgBilling.org_id, orgId))
      .limit(1),
    db
      .select({
        user_id: orgMembers.user_id,
        email: orgMembers.email,
        first_name: orgMembers.first_name,
        last_name: orgMembers.last_name,
        image_url: orgMembers.image_url,
        role: orgMembers.role,
        created_at: orgMembers.created_at,
      })
      .from(orgMembers)
      .where(eq(orgMembers.org_id, orgId))
      .orderBy(orgMembers.created_at),
  ]);
  return {
    billing: (billingRows[0] ?? null) as OrgCore["billing"],
    members: memberRows as OrgCore["members"],
  };
}

export const GET = withPlexusStaff(async (_request, { params }) => {
  const { orgId } = (await params) as { orgId: string };

  const { billing, members } = await loadOrgCore(orgId);
  if (!billing && members.length === 0) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const [
    sourceCounts,
    [dashboardCount],
    [monitorCount],
    [alertRuleCount],
    [alertCount],
    [apiKeyCount],
    usageRows,
  ] = await Promise.all([
    db
      .select({ source_type: sources.source_type, n: count() })
      .from(sources)
      .where(eq(sources.org_id, orgId))
      .groupBy(sources.source_type),
    db.select({ n: count() }).from(dashboards).where(eq(dashboards.org_id, orgId)),
    db
      .select({ n: count() })
      .from(eventMonitors)
      .where(eq(eventMonitors.org_id, orgId)),
    db.select({ n: count() }).from(alertRules).where(eq(alertRules.org_id, orgId)),
    db.select({ n: count() }).from(alerts).where(eq(alerts.org_id, orgId)),
    db.select({ n: count() }).from(apiKeys).where(eq(apiKeys.org_id, orgId)),
    db
      .select({
        period_start: usage.period_start,
        data_points_ingested: usage.data_points_ingested,
        bytes_ingested: usage.bytes_ingested,
        devices_active: usage.devices_active,
      })
      .from(usage)
      .where(eq(usage.org_id, orgId))
      .orderBy(desc(usage.period_start))
      .limit(1),
  ]);

  const byType = new Map(sourceCounts.map((r) => [r.source_type, r.n]));
  const latestUsage = usageRows[0] ?? null;

  return NextResponse.json({
    org: {
      id: orgId,
      name: billing?.org_name ?? orgId,
      tier: billing?.tier ?? null,
      plan: billing?.tier === "tier_2" ? "enterprise" : "free",
      createdAt: billing?.org_created_at
        ? new Date(billing.org_created_at).getTime()
        : null,
      stripeCustomerId: billing?.stripe_customer_id ?? null,
      stripeSubscriptionStatus: billing?.stripe_subscription_status ?? null,
      billingMissing: !billing,
    },
    counts: {
      members: members.length,
      devices: byType.get("device") ?? 0,
      connections: byType.get("connection") ?? 0,
      dashboards: dashboardCount?.n ?? 0,
      monitors: monitorCount?.n ?? 0,
      alertRules: alertRuleCount?.n ?? 0,
      alerts: alertCount?.n ?? 0,
      apiKeys: apiKeyCount?.n ?? 0,
    },
    usage: latestUsage
      ? {
          periodStart: latestUsage.period_start,
          dataPointsIngested: latestUsage.data_points_ingested,
          bytesIngested: latestUsage.bytes_ingested,
          devicesActive: latestUsage.devices_active,
        }
      : null,
    members: members.map((m) => ({
      userId: m.user_id,
      email: m.email,
      name: [m.first_name, m.last_name].filter(Boolean).join(" ") || null,
      imageUrl: m.image_url,
      role: m.role,
      createdAt: m.created_at ? new Date(m.created_at).getTime() : null,
    })),
  });
});

export const DELETE = withPlexusStaff(async (request, { userId, params }) => {
  const { orgId } = (await params) as { orgId: string };
  const body = await validateBody(request, InternalOrgDeleteSchema);

  const { billing, members } = await loadOrgCore(orgId);
  if (!billing && members.length === 0) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  // Server-side re-check of the typed confirmation — never trust the dialog.
  const expected = billing?.org_name ?? orgId;
  if (body.confirm !== expected) {
    throw apiError(
      "VALIDATION_ERROR",
      "Confirmation text does not match the organization name",
    );
  }

  // Orphaned-user candidates: members whose ONLY membership is this org.
  // Staff accounts and the acting user are never deleted.
  let userIdsToDelete: string[] = [];
  if (body.deleteUsers) {
    const candidates: string[] = [];
    for (const member of members) {
      if (member.user_id === userId) continue;
      const memberships = await adminOrgMemberQueries.findByUser(member.user_id);
      if (memberships.length === 1 && memberships[0].org_id === orgId) {
        candidates.push(member.user_id);
      }
    }
    if (candidates.length > 0) {
      const staffIds = new Set(
        (
          await db
            .select({ id: users.id, is_staff: users.is_staff })
            .from(users)
            .where(inArray(users.id, candidates))
        )
          .filter((r) => r.is_staff)
          .map((r) => r.id),
      );
      userIdsToDelete = candidates.filter((id) => !staffIds.has(id));
    }
  }

  // External state first (Stripe) — a throw here surfaces as a retryable
  // error and leaves every org row intact (engine contract).
  await purgeOrgExternal(orgId);
  const { tablesCleared } = await deleteOrgCascade(orgId);

  for (const orphanId of userIdsToDelete) {
    await deleteUserRows(orphanId);
  }


  console.log("[internal] org deleted", {
    staffUserId: userId,
    orgId,
    deleteUsers: body.deleteUsers,
    deletedUserCount: userIdsToDelete.length,
    tablesCleared,
  });

  const res = NextResponse.json({
    ok: true,
    orgId,
    tablesCleared,
    deletedUserIds: userIdsToDelete,
  });

  // If the caller was impersonating the org they just deleted, clear the
  // cookie — getAuth() never re-validates the org exists, so they'd stay
  // stuck viewing a dead org otherwise.
  const cookieStore = await cookies();
  if (cookieStore.get(IMPERSONATE_ORG_COOKIE)?.value === orgId) {
    res.cookies.set(IMPERSONATE_ORG_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return res;
});
