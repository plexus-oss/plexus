/**
 * Email Integration Test
 *
 * POST - Send a test email through the real delivery pipeline (delivery
 * record, engine send, stats) so a passing test proves the production path.
 */

import { NextResponse } from "next/server";
import { withAuth, withPermission } from "@/lib/api/with-auth";
import { emailIntegrationQueries } from "@/lib/db/supabase";
import { sendTestNotification } from "@/lib/notifications/deliver";

/**
 * POST /api/integrations/email/[id]/test
 */
export const POST = withPermission("action-manage-integrations", async (_request, { orgId, params }) => {
  try {
    const { id } = await params;
    const integration = await emailIntegrationQueries.findById(orgId, id);

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 },
      );
    }

    const delivery = await sendTestNotification(orgId, "email", id);
    const success = delivery?.status === "delivered";

    if (!success) {
      return NextResponse.json({
        success: false,
        responseStatus: delivery?.response_status ?? undefined,
        responseTimeMs: delivery?.response_time_ms ?? undefined,
        error: delivery?.error || "Test delivery failed",
      });
    }

    return NextResponse.json({
      success: true,
      responseStatus: delivery.response_status ?? undefined,
      responseTimeMs: delivery.response_time_ms ?? undefined,
      message: `Test email sent to ${integration.email_address}`,
    });
  } catch (error) {
    console.error("Error testing email integration:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to send test email",
      },
      { status: 500 },
    );
  }
});
