/**
 * Email Integration API
 *
 * GET  - List all email integrations for the org
 * POST - Create a new email integration
 */

import { NextResponse } from "next/server";
import { withAuth, withPermission } from "@/lib/api/with-auth";
import { emailIntegrationQueries } from "@/lib/db/supabase";
import { emitSystemEvent } from "@/lib/events/emit";
import type {
  EmailIntegration,
  EmailIntegrationPublic,
  NewEmailIntegration,
  WebhookEventType,
} from "@/lib/db/types";

function toPublic(integration: EmailIntegration): EmailIntegrationPublic {
  // Strip the private `created_by` field; `rest` is the public projection.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { created_by, ...rest } = integration;
  return rest;
}

/**
 * GET /api/integrations/email
 */
export const GET = withAuth(async (_request, { orgId }) => {
  const integrations = await emailIntegrationQueries.findAll(orgId);
  const publicIntegrations: EmailIntegrationPublic[] =
    integrations.map(toPublic);

  return NextResponse.json({ integrations: publicIntegrations });
});

/**
 * POST /api/integrations/email
 */
export const POST = withPermission("action-manage-integrations", async (request, { userId, orgId }) => {
  try {
    const body = await request.json();

    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 },
      );
    }

    if (!body.emailAddress || typeof body.emailAddress !== "string") {
      return NextResponse.json(
        { error: "Email address is required" },
        { status: 400 },
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.emailAddress)) {
      return NextResponse.json(
        { error: "Invalid email address format" },
        { status: 400 },
      );
    }

    const newIntegration: NewEmailIntegration = {
      org_id: orgId,
      name: body.name.trim(),
      email_address: body.emailAddress.trim().toLowerCase(),
      enabled: body.enabled !== false,
      events: (body.events as WebhookEventType[]) || [
        "alert.triggered",
        "alert.resolved",
      ],
      created_by: userId,
    };

    const integration = await emailIntegrationQueries.create(newIntegration);

    emitSystemEvent({
      orgId,
      eventType: "integration.email_connected",
      category: "integration",
      title: `Email integration "${body.name}" created`,
      severity: "success",
      entityId: integration.id,
      entityType: "integration",
      actorId: userId,
    });

    return NextResponse.json(
      { integration: toPublic(integration) },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating email integration:", error);

    // Drizzle wraps the pg error: unique-violation code (23505) is on err.cause;
    // err.message is just "Failed query: …".
    const pgCode = (error as { cause?: { code?: string } })?.cause?.code;
    if (
      pgCode === "23505" ||
      (error instanceof Error && error.message.includes("duplicate"))
    ) {
      return NextResponse.json(
        { error: "An integration with this email address already exists" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Failed to create integration" },
      { status: 500 },
    );
  }
});
