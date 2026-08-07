/**
 * Bulk Acknowledge API
 *
 * POST /api/alerts/acknowledge-all - Acknowledge every open alert for the org.
 * Returns { count } where count is the number of alerts that transitioned.
 */

import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import { alertEventQueries, alertQueries } from "@/lib/db";
import { emitSystemEvent } from "@/lib/events/emit";

export const POST = withDualAuth(async (_request, { orgId, userId, orgRole, isApiKeyAuth }) => {
  if (!isApiKeyAuth) {
    await requirePermission({ orgId, orgRole, userId }, "action-acknowledge-alert");
  }

  const openAlerts = await alertQueries.findAll(orgId, {
    status: ["open"],
    limit: 1000,
  });

  if (openAlerts.length === 0) {
    return NextResponse.json({ count: 0 });
  }

  const actor = userId || "system";

  const results = await Promise.allSettled(
    openAlerts.map(async (alert) => {
      const updated = await alertQueries.acknowledge(orgId, alert.id, actor);
      if (!updated) return null;

      await alertEventQueries.create(orgId, alert.id, "acknowledged", {
        actorId: userId || undefined,
        message: "Alert acknowledged (bulk)",
      });

      emitSystemEvent({
        orgId,
        eventType: "alert.acknowledged",
        category: "alert",
        title: `Alert on ${alert.metric} acknowledged`,
        sourceId: alert.source_id || undefined,
        entityId: alert.id,
        entityType: "alert",
        actorId: userId,
      });

      return updated;
    }),
  );

  const count = results.filter(
    (r) => r.status === "fulfilled" && r.value !== null,
  ).length;

  return NextResponse.json({ count });
});
