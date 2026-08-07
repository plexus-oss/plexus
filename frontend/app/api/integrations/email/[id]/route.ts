/**
 * Email Integration Management
 *
 * GET    - Get a single integration
 * PATCH  - Update integration
 * DELETE - Remove integration
 */

import { NextResponse } from "next/server";
import { withAuth, withPermission } from "@/lib/api/with-auth";
import { emailIntegrationQueries } from "@/lib/db/supabase";
import { emitSystemEvent } from "@/lib/events/emit";
import type {
  EmailIntegration,
  EmailIntegrationPublic,
  UpdateEmailIntegration,
  WebhookEventType,
} from "@/lib/db/types";

function toPublic(integration: EmailIntegration): EmailIntegrationPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip created_by from the public shape
  const { created_by: _, ...rest } = integration;
  return rest;
}

/**
 * GET /api/integrations/email/[id]
 */
export const GET = withAuth(async (_request, { orgId, params }) => {
  const { id } = await params;
  const integration = await emailIntegrationQueries.findById(orgId, id);

  if (!integration) {
    return NextResponse.json(
      { error: "Integration not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ integration: toPublic(integration) });
});

/**
 * PATCH /api/integrations/email/[id]
 */
export const PATCH = withPermission("action-manage-integrations", async (request, { orgId, params }) => {
  const { id } = await params;
  const body = await request.json();

  const updates: UpdateEmailIntegration = {};

  if (typeof body.name === "string") {
    updates.name = body.name.trim();
  }
  if (typeof body.emailAddress === "string") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.emailAddress)) {
      return NextResponse.json(
        { error: "Invalid email address format" },
        { status: 400 },
      );
    }
    updates.email_address = body.emailAddress.trim().toLowerCase();
  }
  if (typeof body.enabled === "boolean") {
    updates.enabled = body.enabled;
  }
  if (Array.isArray(body.events)) {
    updates.events = body.events as WebhookEventType[];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid updates provided" },
      { status: 400 },
    );
  }

  const integration = await emailIntegrationQueries.update(orgId, id, updates);

  if (!integration) {
    return NextResponse.json(
      { error: "Integration not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ integration: toPublic(integration) });
});

/**
 * DELETE /api/integrations/email/[id]
 */
export const DELETE = withPermission("action-manage-integrations", async (_request, { userId, orgId, params }) => {
  const { id } = await params;

  const existing = await emailIntegrationQueries.findById(orgId, id);
  if (!existing) {
    return NextResponse.json(
      { error: "Integration not found" },
      { status: 404 },
    );
  }

  await emailIntegrationQueries.delete(orgId, id);

  emitSystemEvent({
    orgId,
    eventType: "integration.email_disconnected",
    category: "integration",
    title: "Email integration removed",
    severity: "warning",
    entityId: id,
    entityType: "integration",
    actorId: userId,
  });

  return NextResponse.json({ success: true });
});
