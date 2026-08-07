import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { webhookQueries, webhookDeliveryQueries } from "@/lib/db/supabase";
import type { WebhookDeliveryStatus } from "@/lib/db/types";

/**
 * GET /api/webhooks/[id]/logs - Get delivery history for a webhook
 */
export const GET = withAuth(async (request, { orgId, params }) => {
  const { id } = await params;
  const { searchParams } = new URL(request.url);

  const status = searchParams.get("status") as WebhookDeliveryStatus | null;
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  // Verify webhook exists
  const webhooks = await webhookQueries.findById(orgId, id);
  if (webhooks.length === 0) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  // Get deliveries
  const deliveries = await webhookDeliveryQueries.findByWebhook(orgId, id, {
    status: status || undefined,
    limit,
    offset,
  });

  // Get stats
  const stats = await webhookDeliveryQueries.getStats(orgId, id);

  return NextResponse.json({
    deliveries,
    stats,
    pagination: {
      limit,
      offset,
      hasMore: deliveries.length === limit,
    },
  });
});
