/**
 * Notification Delivery Engine
 *
 * Durable dispatch for integration notifications (Slack, email).
 * Every notification is persisted as a notification_deliveries row BEFORE any
 * network send, then attempted inline; failures are retried by the drain loop
 * (lib/notifications/drain.ts) with the same backoff schedule as generic
 * webhooks. Nothing is fire-and-lose.
 *
 * Callers in internal (sessionless) contexts must run inside
 * runWithServiceRole() — see lib/db/queries/shared.ts.
 */

import "server-only";

import {
  notificationDeliveryQueries,
  slackIntegrationQueries,
  emailIntegrationQueries,
} from "@/lib/db/supabase";
import { deliverToSlackIntegration } from "@/lib/integrations/slack";
import { deliverToEmailIntegration } from "@/lib/integrations/email";
import type {
  Json,
  NotificationChannel,
  NotificationDelivery,
  WebhookEventType,
} from "@/lib/db/types";

// Retry delays: 1 min, 5 min, 30 min (mirrors webhook dispatcher)
const RETRY_DELAYS = [60_000, 300_000, 1_800_000];

// A freshly inserted row becomes visible to the drain loop only after this
// grace period, so the inline send (below) doesn't race a drain tick into a
// double-send. If the process dies mid-send, the drain loop picks the row up.
const DRAIN_PICKUP_GRACE_MS = 60_000;

const MAX_RESPONSE_BODY_LENGTH = 2000;

interface ChannelSendResult {
  success: boolean;
  responseStatus?: number;
  responseBody?: string;
  responseTimeMs?: number;
  error?: string;
}

/**
 * Attempt the actual network send for a delivery row.
 * Returns permanent=true when retrying can never succeed (integration
 * deleted or disabled).
 */
async function attemptSend(
  delivery: NotificationDelivery,
): Promise<ChannelSendResult & { permanent?: boolean }> {
  const orgId = delivery.org_id;
  const eventType = delivery.event_type;
  const data = (delivery.payload ?? {}) as Record<string, unknown>;

  switch (delivery.channel) {
    case "slack": {
      const integration = await slackIntegrationQueries.findById(
        orgId,
        delivery.integration_id,
      );
      if (!integration || !integration.enabled) {
        return {
          success: false,
          error: "Slack integration missing or disabled",
          permanent: true,
        };
      }
      return deliverToSlackIntegration(integration, eventType, data);
    }
    case "email": {
      const integration = await emailIntegrationQueries.findById(
        orgId,
        delivery.integration_id,
      );
      if (!integration || !integration.enabled) {
        return {
          success: false,
          error: "Email integration missing or disabled",
          permanent: true,
        };
      }
      return deliverToEmailIntegration(integration, eventType, data);
    }
    default:
      // Unknown/retired channel (e.g. legacy rows) — never deliverable.
      return {
        success: false,
        error: `Unsupported notification channel: ${delivery.channel}`,
        permanent: true,
      };
  }
}

/**
 * Record per-integration health stats after an attempt.
 */
async function updateIntegrationStats(
  delivery: NotificationDelivery,
  success: boolean,
  error?: string,
): Promise<void> {
  try {
    switch (delivery.channel) {
      case "slack":
        await slackIntegrationQueries.updateStats(
          delivery.org_id,
          delivery.integration_id,
          success,
          error,
        );
        break;
      case "email":
        await emailIntegrationQueries.updateStats(
          delivery.org_id,
          delivery.integration_id,
          success,
          error,
        );
        break;
    }
  } catch (err) {
    console.error(
      `[notifications] failed to update ${delivery.channel} stats for ${delivery.integration_id}:`,
      err,
    );
  }
}

/**
 * Process one delivery row: send, then mark delivered / retrying / failed.
 */
export async function processNotificationDelivery(
  orgId: string,
  deliveryId: string,
): Promise<void> {
  const delivery = await notificationDeliveryQueries.findById(
    orgId,
    deliveryId,
  );
  if (!delivery) return;
  if (delivery.status === "delivered" || delivery.status === "failed") return;

  let result: ChannelSendResult & { permanent?: boolean };
  try {
    result = await attemptSend(delivery);
  } catch (err) {
    result = {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  const responseBody = result.responseBody
    ? result.responseBody.substring(0, MAX_RESPONSE_BODY_LENGTH)
    : undefined;

  if (result.success) {
    await notificationDeliveryQueries.updateAttempt(orgId, deliveryId, {
      status: "delivered",
      responseStatus: result.responseStatus,
      responseBody,
      responseTimeMs: result.responseTimeMs,
      nextRetryAt: null,
      deliveredAt: new Date().toISOString(),
    });
    await updateIntegrationStats(delivery, true);
    return;
  }

  const newAttemptCount = delivery.attempt_count + 1;
  const exhausted =
    result.permanent || newAttemptCount >= delivery.max_attempts;

  if (exhausted) {
    await notificationDeliveryQueries.updateAttempt(orgId, deliveryId, {
      status: "failed",
      responseStatus: result.responseStatus,
      responseBody,
      responseTimeMs: result.responseTimeMs,
      error: result.error,
      nextRetryAt: null,
    });
    console.error(
      JSON.stringify({
        event: "notification_delivery_failed",
        channel: delivery.channel,
        integrationId: delivery.integration_id,
        eventType: delivery.event_type,
        attempts: newAttemptCount,
        error: result.error,
      }),
    );
  } else {
    const retryDelay =
      RETRY_DELAYS[newAttemptCount - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
    await notificationDeliveryQueries.updateAttempt(orgId, deliveryId, {
      status: "retrying",
      responseStatus: result.responseStatus,
      responseBody,
      responseTimeMs: result.responseTimeMs,
      error: result.error,
      nextRetryAt: new Date(Date.now() + retryDelay).toISOString(),
    });
  }

  await updateIntegrationStats(delivery, false, result.error);
}

/**
 * Dispatch an event to all matching integrations for an org.
 *
 * Persists one delivery row per matching integration (awaited — durable
 * before the caller responds), then attempts the sends asynchronously. The
 * drain loop retries anything that doesn't reach `delivered`.
 *
 * `targetIds` (per-rule notification targets) restricts delivery to those
 * integrations, bypassing the events subscription filter; null/undefined
 * keeps the default subscribed-to-event fan-out.
 */
export async function dispatchNotifications(
  orgId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  targetIds?: string[] | null,
): Promise<void> {
  const [slack, email] = await Promise.all([
    (targetIds
      ? slackIntegrationQueries.findEnabledByIds(orgId, targetIds)
      : slackIntegrationQueries.findByEvent(orgId, eventType)
    ).catch((err) => {
      console.error("[notifications] slack integration lookup failed:", err);
      return [];
    }),
    (targetIds
      ? emailIntegrationQueries.findEnabledByIds(orgId, targetIds)
      : emailIntegrationQueries.findByEvent(orgId, eventType)
    ).catch((err) => {
      console.error("[notifications] email integration lookup failed:", err);
      return [];
    }),
  ]);

  const targets: Array<{ channel: NotificationChannel; id: string }> = [
    ...slack.map((i) => ({ channel: "slack" as const, id: i.id })),
    ...email.map((i) => ({ channel: "email" as const, id: i.id })),
  ];

  if (targets.length === 0) return;

  const now = Date.now();

  for (const target of targets) {
    let delivery: NotificationDelivery;
    try {
      delivery = await notificationDeliveryQueries.create({
        org_id: orgId,
        channel: target.channel,
        integration_id: target.id,
        event_type: eventType,
        payload: data as Json,
        status: "pending",
        scheduled_at: new Date(now).toISOString(),
        next_retry_at: new Date(now + DRAIN_PICKUP_GRACE_MS).toISOString(),
      });
    } catch (err) {
      console.error(
        `[notifications] failed to persist ${target.channel} delivery:`,
        err,
      );
      continue;
    }

    // Inline send — async relative to the caller; drain loop is the net.
    processNotificationDelivery(orgId, delivery.id).catch((err) => {
      console.error(
        `[notifications] inline send failed for ${delivery.id}, drain loop will retry:`,
        err,
      );
    });
  }
}

/**
 * Send a test notification through the REAL delivery path — delivery row,
 * engine send, stats update — so a green test proves the production
 * pipeline, not a parallel happy path. Single attempt, no retries.
 */
export async function sendTestNotification(
  orgId: string,
  channel: NotificationChannel,
  integrationId: string,
): Promise<NotificationDelivery | null> {
  const data: Record<string, unknown> = {
    alertId: `test-${Date.now()}`,
    sourceName: "Test Source",
    sourceSlug: "test-source",
    metric: "test_metric",
    value: 100,
    threshold: 90,
    severity: "critical",
    triggerType: "limit_violation",
    message: "Test notification from Plexus — your integration is wired up.",
    triggeredAt: new Date().toISOString(),
  };

  const delivery = await notificationDeliveryQueries.create({
    org_id: orgId,
    channel,
    integration_id: integrationId,
    event_type: "alert.triggered",
    payload: data as Json,
    status: "pending",
    max_attempts: 1,
    scheduled_at: new Date().toISOString(),
    next_retry_at: null,
  });

  await processNotificationDelivery(orgId, delivery.id);
  return notificationDeliveryQueries.findById(orgId, delivery.id);
}

/**
 * Retry every due pending/retrying delivery. Called by the drain loop and
 * the manual cron endpoint. Must run inside runWithServiceRole().
 */
export async function processPendingNotifications(): Promise<number> {
  const pending = await notificationDeliveryQueries.findPending();
  let processed = 0;

  for (const delivery of pending) {
    try {
      await processNotificationDelivery(delivery.org_id, delivery.id);
      processed++;
    } catch (err) {
      console.error(
        `[notifications] error processing delivery ${delivery.id}:`,
        err,
      );
    }
  }

  return processed;
}
