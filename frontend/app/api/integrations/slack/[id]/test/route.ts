/**
 * Slack Integration Test
 *
 * POST - Send a test message through the real delivery pipeline (delivery
 * record, engine send, stats) so a passing test proves the production path.
 */

import { NextResponse } from "next/server";
import { withAuth, withPermission } from "@/lib/api/with-auth";
import { slackIntegrationQueries } from "@/lib/db/supabase";
import { sendTestNotification } from "@/lib/notifications/deliver";

/**
 * POST /api/integrations/slack/[id]/test
 */
export const POST = withPermission("action-manage-integrations", async (_request, { orgId, params }) => {
  try {
    const { id } = await params;
    const integration = await slackIntegrationQueries.findById(orgId, id);

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 },
      );
    }

    const delivery = await sendTestNotification(orgId, "slack", id);
    const success = delivery?.status === "delivered";

    if (!success) {
      return NextResponse.json({
        success: false,
        responseStatus: delivery?.response_status ?? undefined,
        responseBody: delivery?.response_body ?? undefined,
        responseTimeMs: delivery?.response_time_ms ?? undefined,
        error: delivery?.error || "Test delivery failed",
      });
    }

    return NextResponse.json({
      success: true,
      responseStatus: delivery.response_status ?? undefined,
      responseBody: delivery.response_body ?? undefined,
      responseTimeMs: delivery.response_time_ms ?? undefined,
      message: `Test message sent to #${integration.channel_name}`,
    });
  } catch (error) {
    console.error("Error testing Slack integration:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to send test message",
      },
      { status: 500 },
    );
  }
});
