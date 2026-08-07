import "server-only";

import { createHmac } from "crypto";
import {
  webhookQueries,
  webhookDeliveryQueries,
  sourceQueries,
} from "@/lib/db/supabase";
import type {
  Webhook,
  WebhookEventType,
  WebhookPayload,
  WebhookSourceFilter,
  Source,
} from "@/lib/db/types";

// Retry delays in milliseconds: 1 min, 5 min, 30 min
const RETRY_DELAYS = [60_000, 300_000, 1_800_000];
const DELIVERY_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BODY_LENGTH = 2000;

// New rows become visible to the drain loop only after this grace period so
// the inline send doesn't race a drain tick into a double-send.
const DRAIN_PICKUP_GRACE_MS = 60_000;

/**
 * Sign a webhook payload with HMAC-SHA256
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verify a webhook signature
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = signPayload(payload, secret);
  // Constant-time comparison
  if (signature.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Check if a webhook's source filter matches a given source
 */
function matchesSourceFilter(
  filter: WebhookSourceFilter | null,
  source: Source | null,
): boolean {
  // No filter means match all
  if (!filter) return true;
  if (!source) return true;

  // Check source ID filter
  if (filter.sourceIds && filter.sourceIds.length > 0) {
    if (!filter.sourceIds.includes(source.id)) return false;
  }

  // Check device type filter
  if (filter.deviceTypes && filter.deviceTypes.length > 0) {
    if (
      !source.device_type ||
      !filter.deviceTypes.includes(source.device_type)
    ) {
      return false;
    }
  }

  // Check tags filter
  if (filter.tags && filter.tags.length > 0) {
    const sourceTags = (source as Source & { tags?: string[] }).tags || [];
    if (!filter.tags.some((tag) => sourceTags.includes(tag))) {
      return false;
    }
  }

  return true;
}

/**
 * Deliver a webhook to its endpoint
 */
export async function deliverWebhook(
  webhook: Webhook,
  payload: WebhookPayload,
): Promise<{
  success: boolean;
  responseStatus?: number;
  responseBody?: string;
  responseTimeMs?: number;
  error?: string;
}> {
  const payloadString = JSON.stringify(payload);
  const signature = signPayload(payloadString, webhook.secret);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Plexus-Signature": signature,
    "X-Plexus-Event": payload.event,
    "X-Plexus-Event-Id": payload.eventId,
    "X-Plexus-Timestamp": payload.timestamp,
    ...(webhook.custom_headers as Record<string, string>),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  const startTime = Date.now();

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body: payloadString,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseTimeMs = Date.now() - startTime;
    let responseBody: string;

    try {
      responseBody = await response.text();
      if (responseBody.length > MAX_RESPONSE_BODY_LENGTH) {
        responseBody =
          responseBody.substring(0, MAX_RESPONSE_BODY_LENGTH) + "...";
      }
    } catch {
      responseBody = "";
    }

    const success = response.ok;

    return {
      success,
      responseStatus: response.status,
      responseBody,
      responseTimeMs,
      error: success
        ? undefined
        : `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startTime;

    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMessage = `Request timeout after ${DELIVERY_TIMEOUT_MS}ms`;
      } else {
        errorMessage = error.message;
      }
    }

    return {
      success: false,
      responseTimeMs,
      error: errorMessage,
    };
  }
}

/**
 * Schedule webhook deliveries for an event
 * Finds all matching webhooks and creates delivery records
 *
 * `targetIds` (per-rule notification targets) restricts delivery to those
 * webhooks, bypassing the events subscription filter; null/undefined keeps
 * the default subscribed-to-event fan-out.
 */
export async function scheduleWebhookDelivery(
  orgId: string,
  eventType: WebhookEventType,
  payload: Omit<WebhookPayload, "event" | "eventId" | "timestamp" | "orgId">,
  sourceId?: string,
  targetIds?: string[] | null,
): Promise<void> {
  // Find webhooks subscribed to this event
  const webhooks = targetIds
    ? await webhookQueries.findEnabledByIds(orgId, targetIds)
    : await webhookQueries.findByEvent(orgId, eventType);

  if (webhooks.length === 0) return;

  // Get source for filtering if sourceId provided
  let source: Source | null = null;
  if (sourceId) {
    const sources = await sourceQueries.findById(orgId, sourceId);
    source = sources.length > 0 ? sources[0] : null;
  }

  // Generate event ID
  const eventId = `${eventType}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const timestamp = new Date().toISOString();

  const fullPayload: WebhookPayload = {
    event: eventType,
    eventId,
    timestamp,
    orgId,
    data: payload.data,
  };

  // Create delivery records and attempt inline delivery
  for (const webhook of webhooks) {
    // Check source filter
    const sourceFilter = webhook.source_filter as WebhookSourceFilter | null;
    if (!matchesSourceFilter(sourceFilter, source)) {
      continue;
    }

    const deliveries = await webhookDeliveryQueries.insert(orgId, {
      webhook_id: webhook.id,
      event_type: eventType,
      event_id: eventId,
      payload: JSON.parse(JSON.stringify(fullPayload)),
      status: "pending",
      scheduled_at: new Date().toISOString(),
      next_retry_at: new Date(Date.now() + DRAIN_PICKUP_GRACE_MS).toISOString(),
    });

    // Attempt immediate inline delivery (fire-and-forget).
    // The cron job handles retries if this fails.
    const delivery = deliveries?.[0];
    if (delivery) {
      processDelivery(orgId, delivery.id).catch((err) => {
        console.error(
          `[Webhook] Inline delivery failed for ${delivery.id}, cron will retry:`,
          err,
        );
      });
    }
  }
}

/**
 * Process a pending webhook delivery
 */
export async function processDelivery(
  orgId: string,
  deliveryId: string,
): Promise<void> {
  // Get delivery and webhook
  const deliveries = await webhookDeliveryQueries.findById(orgId, deliveryId);
  if (deliveries.length === 0) return;

  const delivery = deliveries[0];
  const webhooks = await webhookQueries.findById(orgId, delivery.webhook_id);
  if (webhooks.length === 0) return;

  const webhook = webhooks[0];

  // Attempt delivery
  const result = await deliverWebhook(
    webhook,
    delivery.payload as unknown as WebhookPayload,
  );

  // Update delivery record
  if (result.success) {
    await webhookDeliveryQueries.updateAttempt(orgId, deliveryId, {
      status: "delivered",
      responseStatus: result.responseStatus,
      responseBody: result.responseBody,
      responseTimeMs: result.responseTimeMs,
      deliveredAt: new Date().toISOString(),
    });

    await webhookQueries.updateStats(orgId, webhook.id, true);
  } else {
    const newAttemptCount = delivery.attempt_count + 1;
    const maxAttempts = delivery.max_attempts;

    if (newAttemptCount >= maxAttempts) {
      // Max retries reached - mark as failed
      await webhookDeliveryQueries.updateAttempt(orgId, deliveryId, {
        status: "failed",
        responseStatus: result.responseStatus,
        responseBody: result.responseBody,
        responseTimeMs: result.responseTimeMs,
        error: result.error,
      });

      await webhookQueries.updateStats(orgId, webhook.id, false, result.error);
    } else {
      // Schedule retry
      const retryDelay =
        RETRY_DELAYS[newAttemptCount - 1] ||
        RETRY_DELAYS[RETRY_DELAYS.length - 1];
      const nextRetryAt = new Date(Date.now() + retryDelay).toISOString();

      await webhookDeliveryQueries.updateAttempt(orgId, deliveryId, {
        status: "retrying",
        responseStatus: result.responseStatus,
        responseBody: result.responseBody,
        responseTimeMs: result.responseTimeMs,
        error: result.error,
        nextRetryAt,
      });
    }
  }
}

/**
 * Process all pending deliveries
 * Should be called by a cron job or background worker
 */
export async function processPendingDeliveries(): Promise<number> {
  const pending = await webhookDeliveryQueries.findPending();
  let processed = 0;

  for (const delivery of pending) {
    try {
      await processDelivery(delivery.org_id, delivery.id);
      processed++;
    } catch (error) {
      console.error(`Error processing delivery ${delivery.id}:`, error);
    }
  }

  return processed;
}
