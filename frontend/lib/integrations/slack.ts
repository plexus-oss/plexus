/**
 * Slack Webhook Client
 *
 * Sends alert notifications to Slack using incoming webhooks.
 */

import "server-only";

import { decrypt } from "@/lib/encryption";
import type { SlackIntegration, WebhookEventType } from "@/lib/db/types";

const DELIVERY_TIMEOUT_MS = 30_000;

export interface SlackDeliveryResult {
  success: boolean;
  responseStatus?: number;
  responseBody?: string;
  responseTimeMs?: number;
  error?: string;
}

/**
 * Map event types to Slack color indicators
 */
function getSeverityColor(eventType: WebhookEventType): string {
  switch (eventType) {
    case "alert.triggered":
    case "threshold.critical":
      return "#E01E5A"; // red
    case "threshold.warning":
    case "device.offline":
      return "#ECB22E"; // yellow
    case "alert.resolved":
    case "device.online":
      return "#2EB67D"; // green
    case "alert.acknowledged":
      return "#36C5F0"; // blue
    default:
      return "#808080"; // gray
  }
}

/**
 * Map event types to human-readable labels
 */
function getEventLabel(eventType: WebhookEventType): string {
  switch (eventType) {
    case "alert.triggered":
      return "Alert Triggered";
    case "alert.resolved":
      return "Alert Resolved";
    case "alert.acknowledged":
      return "Alert Acknowledged";
    case "device.online":
      return "Device Online";
    case "device.offline":
      return "Device Offline";
    case "threshold.warning":
      return "Threshold Warning";
    case "threshold.critical":
      return "Threshold Critical";
    default:
      return eventType;
  }
}

/**
 * Scalar context-snapshot entries (same filter as the email renderer):
 * underscore-prefixed and object-valued keys are internal detail.
 */
const MAX_CONTEXT_FIELDS = 5;

function contextFields(
  data: Record<string, unknown>,
): Array<{ type: string; text: string }> {
  const ctx = data.contextSnapshot;
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return [];
  return Object.entries(ctx as Record<string, unknown>)
    .filter(
      ([k, v]) =>
        !k.startsWith("_") && k !== "attachments" && typeof v !== "object",
    )
    .slice(0, MAX_CONTEXT_FIELDS)
    .map(([k, v]) => ({
      type: "mrkdwn",
      text: `*${k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}:*\n${String(v)}`,
    }));
}

/**
 * Build Slack Block Kit message blocks for alert/device/threshold events
 */
export function buildAlertBlocks(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): unknown[] {
  const color = getSeverityColor(eventType);
  const label = getEventLabel(eventType);
  const sourceName = data.sourceName || data.sourceSlug || "Unknown source";
  const metric = data.metric as string | undefined;

  // Build summary text
  let summary: string;
  if (data.message) {
    summary = String(data.message);
  } else if (metric) {
    summary = `${metric} on ${sourceName}`;
  } else {
    summary = `${label} for ${sourceName}`;
  }

  const fields: Array<{ type: string; text: string }> = [];

  if (sourceName) {
    fields.push({ type: "mrkdwn", text: `*Source:*\n${sourceName}` });
  }
  if (metric) {
    fields.push({ type: "mrkdwn", text: `*Metric:*\n${metric}` });
  }
  if (data.value !== undefined) {
    fields.push({ type: "mrkdwn", text: `*Value:*\n${data.value}` });
  }
  if (data.threshold !== undefined) {
    fields.push({ type: "mrkdwn", text: `*Threshold:*\n${data.threshold}` });
  }
  if (data.severity) {
    fields.push({ type: "mrkdwn", text: `*Severity:*\n${data.severity}` });
  }

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${label}*\n${summary}`,
      },
    },
  ];

  if (fields.length > 0) {
    blocks.push({
      type: "section",
      fields,
    });
  }

  // Row context from the snapshot (e.g. Email / Name for event alerts).
  const ctxFields = contextFields(data);
  if (ctxFields.length > 0) {
    blocks.push({
      type: "section",
      fields: ctxFields,
    });
  }

  // Add link to Plexus dashboard if we have source info
  if (data.sourceSlug) {
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://app.plexus.company";
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in Plexus" },
          url: `${appUrl}/devices/${data.sourceSlug}`,
        },
      ],
    });
  }

  // Wrap in an attachment for the color sidebar
  return [
    {
      color,
      blocks,
    },
  ];
}

/**
 * Send a message to a Slack webhook URL
 */
export async function sendToSlack(
  webhookUrl: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): Promise<SlackDeliveryResult> {
  const attachments = buildAlertBlocks(eventType, data);

  const payload = {
    attachments,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  const startTime = Date.now();

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startTime;

    let responseBody = "";
    try {
      responseBody = await response.text();
    } catch {
      // ignore
    }

    const success = response.ok;

    return {
      success,
      responseStatus: response.status,
      responseBody,
      responseTimeMs,
      error: success
        ? undefined
        : `Slack returned ${response.status}: ${responseBody}`,
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
 * Send an event to a single Slack integration.
 * Iteration and durability (delivery records, retries) live in
 * lib/notifications/deliver.ts.
 */
export async function deliverToSlackIntegration(
  integration: SlackIntegration,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): Promise<SlackDeliveryResult> {
  const webhookUrl = decrypt(integration.webhook_url_encrypted);
  return sendToSlack(webhookUrl, eventType, data);
}
