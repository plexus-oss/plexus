import { NextResponse } from "next/server";
import { withRoleAuth, withPermission } from "@/lib/api/with-auth";
import { webhookQueries } from "@/lib/db/supabase";
import { emitSystemEvent } from "@/lib/events/emit";
import type { WebhookEventType } from "@/lib/db/types";

const VALID_EVENT_TYPES: WebhookEventType[] = [
  "alert.triggered",
  "alert.resolved",
  "alert.acknowledged",
  "device.online",
  "device.offline",
  "threshold.warning",
  "threshold.critical",
];

/**
 * GET /api/webhooks/[id] - Get webhook details
 */
export const GET = withPermission("action-edit-webhook", async (_request, { orgId, params }) => {
  const { id } = await params;

  const webhooks = await webhookQueries.findById(orgId, id);

  if (webhooks.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  // Don't expose the full secret
  const webhook = {
    ...webhooks[0],
    secret: undefined,
    secretPrefix: webhooks[0].secret.substring(0, 8) + "...",
  };

  return NextResponse.json({ webhook });
});

/**
 * PATCH /api/webhooks/[id] - Update a webhook
 */
export const PATCH = withPermission("action-edit-webhook", async (request, { orgId, params }) => {
  const { id } = await params;
  const body = await request.json();
  const { name, description, url, events, sourceFilter, customHeaders, enabled } = body;

  // Validate URL if provided
  if (url !== undefined) {
    try {
      const parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return NextResponse.json(
          { error: "URL must use HTTP or HTTPS protocol" },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }
  }

  // Validate events if provided
  if (events !== undefined) {
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: "At least one event type is required" },
        { status: 400 }
      );
    }

    for (const event of events) {
      if (!VALID_EVENT_TYPES.includes(event)) {
        return NextResponse.json(
          { error: `Invalid event type: ${event}` },
          { status: 400 }
        );
      }
    }
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (description !== undefined) updateData.description = description?.trim() || null;
  if (url !== undefined) updateData.url = url;
  if (events !== undefined) updateData.events = events;
  if (sourceFilter !== undefined) updateData.source_filter = sourceFilter;
  if (customHeaders !== undefined) updateData.custom_headers = customHeaders;
  if (enabled !== undefined) updateData.enabled = enabled;

  const webhooks = await webhookQueries.update(orgId, id, updateData);

  if (webhooks.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  // Don't expose the full secret
  const webhook = {
    ...webhooks[0],
    secret: undefined,
    secretPrefix: webhooks[0].secret.substring(0, 8) + "...",
  };

  return NextResponse.json({ webhook });
});

/**
 * DELETE /api/webhooks/[id] - Delete a webhook
 */
export const DELETE = withPermission("action-delete-webhook", async (_request, { userId, orgId, params }) => {
  const { id } = await params;

  const webhooks = await webhookQueries.delete(orgId, id);

  if (webhooks.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  emitSystemEvent({
    orgId,
    eventType: "webhook.deleted",
    category: "webhook",
    title: `Webhook deleted`,
    severity: "warning",
    entityId: id,
    entityType: "webhook",
    actorId: userId,
  });

  return NextResponse.json({ success: true });
});
