/**
 * GET  /api/me/delete-account — preflight: what deleting the account means
 *      for each org the user belongs to.
 * POST /api/me/delete-account — delete the account. Sole-member orgs are
 *      purged entirely (Stripe, ClickHouse, Postgres) and must be explicitly
 *      acknowledged via `deleteOrgIds`; being the last admin of a
 *      multi-member org blocks the whole request.
 *
 * Session auth only — account deletion is cross-org and must never be
 * reachable with an (org-scoped) API key.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apiError, errorResponse, isApiError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { getAuth } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import {
  deleteOrgCascade,
  deleteUserRows,
  getAccountDeletionPlan,
  purgeOrgExternal,
} from "@/lib/db/queries/org-delete";
import { adminOrgMemberQueries } from "@/lib/db/server";
import { users } from "@/lib/db/schema";
import { emitSystemEvent } from "@/lib/events/emit";
import { DeleteAccountSchema } from "@/lib/validation/api-schemas";

export async function GET() {
  const { userId } = await getAuth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select({ is_staff: users.is_staff })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const plans = await getAccountDeletionPlan(userId);

  return NextResponse.json({
    isStaff: user?.is_staff ?? false,
    canDelete: plans.every((p) => p.action !== "blocked_last_admin"),
    orgs: plans.map((p) => ({
      orgId: p.orgId,
      name: p.name ?? p.orgId,
      role: p.role,
      memberCount: p.memberCount,
      action: p.action,
    })),
  });
}

export async function POST(request: Request) {
  const { userId } = await getAuth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await validateBody(request, DeleteAccountSchema);

    // Recompute consequences server-side — never trust the client's view.
    const plans = await getAccountDeletionPlan(userId);

    const blocked = plans.filter((p) => p.action === "blocked_last_admin");
    if (blocked.length > 0) {
      const names = blocked.map((p) => `"${p.name ?? p.orgId}"`).join(", ");
      throw apiError(
        "CONFLICT",
        `You are the last admin of ${names}. Promote another admin or remove the other members first.`,
      );
    }

    const orgsToDelete = plans.filter((p) => p.action === "delete_org");
    const acknowledged = new Set(body.deleteOrgIds);

    const unacknowledged = orgsToDelete.filter(
      (p) => !acknowledged.has(p.orgId),
    );
    if (unacknowledged.length > 0) {
      const names = unacknowledged
        .map((p) => `"${p.name ?? p.orgId}"`)
        .join(", ");
      throw apiError(
        "CONFLICT",
        `You are the only member of ${names} — deleting your account permanently deletes ${unacknowledged.length === 1 ? "this organization" : "these organizations"} and all data. Acknowledge the deletion to continue.`,
      );
    }

    const deletableIds = new Set(orgsToDelete.map((p) => p.orgId));
    const extra = body.deleteOrgIds.filter((id) => !deletableIds.has(id));
    if (extra.length > 0) {
      throw apiError(
        "VALIDATION_ERROR",
        `Cannot delete organizations you are not the sole member of: ${extra.join(", ")}`,
      );
    }

    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // Purge sole-member orgs. External state (Stripe, ClickHouse) goes first,
    // so a failure here leaves everything intact and the request retryable.
    for (const plan of orgsToDelete) {
      await purgeOrgExternal(plan.orgId);
      await deleteOrgCascade(plan.orgId);
    }

    // Leave surviving orgs, noting the departure in their activity feed.
    const orgsToLeave = plans.filter((p) => p.action === "leave");
    for (const plan of orgsToLeave) {
      await adminOrgMemberQueries.delete(plan.orgId, userId);
      emitSystemEvent({
        orgId: plan.orgId,
        eventType: "member.removed",
        category: "member",
        title: `${user?.email ?? userId} deleted their account`,
        actorId: userId,
        metadata: { userId },
      });
    }

    await deleteUserRows(userId);

    console.log(
      `[delete-account] user ${userId} deleted; purged orgs: ${orgsToDelete.map((p) => p.orgId).join(", ") || "none"}; left orgs: ${orgsToLeave.map((p) => p.orgId).join(", ") || "none"}`,
    );

    return NextResponse.json({
      ok: true,
      deletedOrgIds: orgsToDelete.map((p) => p.orgId),
      leftOrgIds: orgsToLeave.map((p) => p.orgId),
    });
  } catch (error) {
    if (!isApiError(error)) {
      console.error("[delete-account] failed:", error);
    }
    return errorResponse(error);
  }
}
