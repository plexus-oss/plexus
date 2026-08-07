import "server-only";

import { scheduleWebhookDelivery } from "./dispatcher";
import { dispatchNotifications } from "@/lib/notifications/deliver";
import { emitSystemEvent } from "@/lib/events/emit";
import { alertRuleQueries } from "@/lib/db/queries/alert-rules";
import { eventMonitorQueries } from "@/lib/db/queries/sources";
import type { Alert, Source, LimitSeverity } from "@/lib/db/types";

/**
 * Resolve the alert's per-rule notification targets from its provenance:
 * rule alerts carry rule_id; event alerts map back to their monitor via
 * (source_id, metric). null = no explicit targets (default fan-out).
 * Resolution failures fall back to the default fan-out — a routing lookup
 * must never suppress an alert.
 *
 * Exported for tests; not part of the module's public surface otherwise.
 */
export async function resolveNotificationTargets(
  orgId: string,
  alert: Alert,
): Promise<string[] | null> {
  try {
    if (alert.rule_id) {
      const rule = await alertRuleQueries.findById(orgId, alert.rule_id);
      return rule?.notification_target_ids ?? null;
    }
    if (alert.trigger_type === "event" && alert.source_id && alert.metric) {
      const monitor = await eventMonitorQueries.findByMetric(
        orgId,
        alert.source_id,
        alert.metric,
      );
      return monitor?.notification_target_ids ?? null;
    }
  } catch (err) {
    console.error("[notifications] target resolution failed:", err);
  }
  return null;
}

/**
 * Trigger webhooks for alert events
 */
export async function triggerAlertWebhook(
  orgId: string,
  alert: Alert,
  source: Source | null,
  eventType: "alert.triggered" | "alert.resolved" | "alert.acknowledged",
): Promise<void> {
  const data = {
    alertId: alert.id,
    sourceId: alert.source_id || undefined,
    sourceName: source?.name || undefined,
    sourceSlug: source?.slug || undefined,
    metric: alert.metric,
    value: alert.value,
    threshold: alert.threshold || undefined,
    bound: alert.bound || undefined,
    severity: alert.severity,
    status: alert.status,
    triggerType: alert.trigger_type,
    alertStats: alert.alert_stats ?? undefined,
    contextSnapshot: alert.context_snapshot ?? undefined,
    recommendedActions: alert.recommended_actions ?? undefined,
    message:
      alert.trigger_type === "event"
        ? `New event: ${alert.metric} = ${alert.value}`
        : `${alert.metric} ${alert.bound === "max" ? "exceeded" : "below"} threshold`,
    triggeredAt: alert.triggered_at,
    acknowledgedAt: alert.acknowledged_at || undefined,
    resolvedAt: alert.resolved_at || undefined,
    resolutionNotes: alert.resolution_notes || undefined,
  };

  const targetIds = await resolveNotificationTargets(orgId, alert);

  // Dispatch to generic webhooks
  await scheduleWebhookDelivery(
    orgId,
    eventType,
    { data },
    alert.source_id || undefined,
    targetIds,
  );

  await dispatchNotifications(orgId, eventType, data, targetIds);

  // Emit system event
  emitSystemEvent({
    orgId,
    eventType: eventType as
      | "alert.triggered"
      | "alert.resolved"
      | "alert.acknowledged",
    category: "alert",
    title:
      eventType === "alert.triggered"
        ? alert.trigger_type === "event"
          ? `Alert triggered: new event on ${alert.metric}`
          : `Alert triggered: ${alert.metric} ${alert.bound === "max" ? "exceeded" : "below"} threshold`
        : eventType === "alert.resolved"
          ? `Alert on ${alert.metric} resolved`
          : `Alert on ${alert.metric} acknowledged`,
    severity:
      eventType === "alert.triggered"
        ? alert.severity === "critical"
          ? "critical"
          : "warning"
        : eventType === "alert.resolved"
          ? "success"
          : "info",
    sourceId: alert.source_id || undefined,
    sourceName: source?.name || undefined,
    sourceSlug: source?.slug || undefined,
    entityId: alert.id,
    entityType: "alert",
    metadata: {
      metric: alert.metric,
      value: alert.value,
      threshold: alert.threshold,
    },
  });
}

/**
 * Trigger webhooks for device status changes
 */
export async function triggerDeviceStatusWebhook(
  orgId: string,
  source: Source,
  eventType: "device.online" | "device.offline",
): Promise<void> {
  const data = {
    sourceId: source.id,
    sourceName: source.name || undefined,
    sourceSlug: source.slug,
    deviceType: source.device_type || undefined,
    previousStatus: eventType === "device.online" ? "offline" : "online",
    newStatus: eventType === "device.online" ? "online" : "offline",
    lastSeenAt: source.last_seen_at || undefined,
  };

  // Dispatch to generic webhooks
  await scheduleWebhookDelivery(orgId, eventType, { data }, source.id);

  await dispatchNotifications(orgId, eventType, data);

  // Emit system event
  emitSystemEvent({
    orgId,
    eventType: eventType as "device.online" | "device.offline",
    category: "device",
    title:
      eventType === "device.online"
        ? `Device ${source.name || source.slug} came online`
        : `Device ${source.name || source.slug} went offline`,
    severity: eventType === "device.online" ? "success" : "warning",
    sourceId: source.id,
    sourceName: source.name || source.slug,
    sourceSlug: source.slug,
  });
}

/**
 * Trigger webhooks for threshold warnings/criticals
 * This is different from alerts - it's for real-time threshold crossings
 * that may not yet have triggered a full alert
 */
export async function triggerThresholdWebhook(
  orgId: string,
  sourceId: string,
  sourceName: string | null,
  sourceSlug: string,
  metric: string,
  value: number,
  threshold: number,
  severity: LimitSeverity,
  bound: "min" | "max",
): Promise<void> {
  const eventType =
    severity === "critical" ? "threshold.critical" : "threshold.warning";

  const data = {
    sourceId,
    sourceName: sourceName || undefined,
    sourceSlug,
    metric,
    value,
    threshold,
    severity,
    bound,
    message: `${metric} ${bound === "max" ? "exceeded" : "below"} ${severity} threshold (${value} vs ${threshold})`,
  };

  // Dispatch to generic webhooks
  await scheduleWebhookDelivery(orgId, eventType, { data }, sourceId);

  await dispatchNotifications(orgId, eventType, data);
}
