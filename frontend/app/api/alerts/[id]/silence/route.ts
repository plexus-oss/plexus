/**
 * POST /api/alerts/[id]/silence — silence the MONITOR behind an alert.
 *
 * Body: { hours: number } (1–168). Sets silenced_until = now + hours on the
 * owning rule/monitor, so no NEW alerts fire from it until then. This alert
 * itself is untouched (acknowledge/resolve it separately); houston keeps
 * evaluating so hysteresis/cooldown state survives — the frontend drops the
 * insert, which also suppresses every notification.
 *
 * Resolution, mirroring how each engine keys its monitor:
 *  - alert.rule_id set (houston thresholds, offline monitors) → alert_rules
 *    by id; threshold rules ALSO mirror onto source_limits (double-write).
 *  - trigger_type "event" → event_monitors by (source UUID, metric).
 *  - trigger_type "limit_violation" → source_limits by (source UUID, metric)
 *    + threshold alert_rules by (slug, metric) via the mirror setter.
 */

import { NextResponse } from "next/server";
import { withDualAuth, requirePermission } from "@/lib/api/with-auth";
import {
  adminAlertQueries,
  adminAlertEventQueries,
  adminAlertRuleQueries,
  adminEventMonitorQueries,
  adminSourceLimitQueries,
  adminSourceQueries,
} from "@/lib/db/server";
import { emitSystemEvent } from "@/lib/events/emit";

const MAX_HOURS = 168; // one week

export const POST = withDualAuth(
  async (request, { userId, orgId, orgRole, isApiKeyAuth, params }) => {
    const { id } = await params;
    if (!isApiKeyAuth) {
      // Same capability as creating/reconfiguring a monitor.
      await requirePermission({ orgId, orgRole, userId }, "action-new-alert");
    }

    const body = (await request.json().catch(() => ({}))) as {
      hours?: number;
    };
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours < 1 || hours > MAX_HOURS) {
      return NextResponse.json(
        { error: `hours must be between 1 and ${MAX_HOURS}` },
        { status: 400 },
      );
    }

    const alert = await adminAlertQueries.findById(orgId, id);
    if (!alert) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    const until = new Date(Date.now() + hours * 3600_000).toISOString();
    let silencedTargets = 0;

    if (alert.rule_id) {
      silencedTargets += await adminAlertRuleQueries.setSilencedUntilById(
        orgId,
        alert.rule_id,
        until,
      );
      const rule = await adminAlertRuleQueries.findByIdForOrg(
        orgId,
        alert.rule_id,
      );
      if (rule?.type === "threshold" && alert.source_id && alert.metric) {
        // Keep the double-written source_limits row in step.
        silencedTargets += await adminSourceLimitQueries.setSilencedUntil(
          orgId,
          alert.source_id,
          alert.metric,
          until,
        );
      }
    } else if (
      alert.trigger_type === "event" &&
      alert.source_id &&
      alert.metric
    ) {
      silencedTargets += await adminEventMonitorQueries.setSilencedUntil(
        orgId,
        alert.source_id,
        alert.metric,
        until,
      );
    } else if (
      alert.trigger_type === "limit_violation" &&
      alert.source_id &&
      alert.metric
    ) {
      silencedTargets += await adminSourceLimitQueries.setSilencedUntil(
        orgId,
        alert.source_id,
        alert.metric,
        until,
      );
      const source = await adminSourceQueries.resolveRef(
        orgId,
        alert.source_id,
      );
      if (source?.slug) {
        silencedTargets += await adminAlertRuleQueries.setThresholdSilencedUntil(
          orgId,
          source.slug,
          alert.metric,
          until,
        );
      }
    }

    if (silencedTargets === 0) {
      return NextResponse.json(
        { error: "Couldn't resolve this alert's monitor" },
        { status: 422 },
      );
    }

    const untilLabel = hours === 1 ? "1 hour" : `${hours} hours`;
    await adminAlertEventQueries.create(orgId, id, "comment", {
      actorId: userId || undefined,
      message: `Silenced this monitor for ${untilLabel} — no new alerts until ${until}`,
    });
    emitSystemEvent({
      orgId,
      eventType: "alert.silenced",
      category: "alert",
      title: `Monitor silenced for ${untilLabel}`,
      description: `${alert.metric} — no new alerts until ${until}`,
      severity: "info",
      entityId: id,
      entityType: "alert",
      actorId: userId || undefined,
      metadata: { silenced_until: until, hours },
    });

    return NextResponse.json({ silenced_until: until, targets: silencedTargets });
  },
);
