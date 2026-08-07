import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api/with-auth";
import { webhookQueries } from "@/lib/db/supabase";
import { deliverWebhook } from "@/lib/webhooks/dispatcher";
import type { WebhookPayload } from "@/lib/db/types";

/**
 * POST /api/webhooks/[id]/test - Send a test webhook
 */
export const POST = withPermission("action-test-webhook", async (_request, { orgId, params }) => {
  const { id } = await params;

  // Get the webhook
  const webhooks = await webhookQueries.findById(orgId, id);

  if (webhooks.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  const webhook = webhooks[0];

  // Create test payload
  const testPayload: WebhookPayload = {
    event: "alert.triggered",
    eventId: `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    orgId,
    data: {
      alertId: "test-alert-id",
      sourceId: "test-source-id",
      sourceName: "Test Device",
      sourceSlug: "test-device",
      metric: "temperature",
      value: 85.5,
      threshold: 80,
      severity: "warning",
      message: "This is a test webhook delivery from Plexus",
    },
  };

  // Attempt delivery
  const result = await deliverWebhook(webhook, testPayload);

  return NextResponse.json({
    success: result.success,
    responseStatus: result.responseStatus,
    responseBody: result.responseBody,
    responseTimeMs: result.responseTimeMs,
    error: result.error,
    payload: testPayload,
  });
});
