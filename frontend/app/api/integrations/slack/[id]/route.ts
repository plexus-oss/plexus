/**
 * Slack Integration Management
 *
 * GET    - Get a single integration
 * PATCH  - Update integration (enable/disable, events)
 * DELETE - Remove integration
 */

import { NextResponse } from "next/server";
import { withAuth, withPermission } from "@/lib/api/with-auth";
import { slackIntegrationQueries } from "@/lib/db/supabase";
import { emitSystemEvent } from "@/lib/events/emit";
import type { SlackIntegrationPublic, UpdateSlackIntegration } from "@/lib/db/types";

/**
 * GET /api/integrations/slack/[id]
 * Get a single Slack integration
 */
export const GET = withAuth(async (_request, { orgId, params }) => {
  const { id } = await params;
  const integration = await slackIntegrationQueries.findById(orgId, id);

  if (!integration) {
    return NextResponse.json(
      { error: "Integration not found" },
      { status: 404 }
    );
  }

  // Return public-safe version
  const publicIntegration: SlackIntegrationPublic = {
    id: integration.id,
    org_id: integration.org_id,
    team_id: integration.team_id,
    team_name: integration.team_name,
    channel_id: integration.channel_id,
    channel_name: integration.channel_name,
    enabled: integration.enabled,
    events: integration.events,
    total_events: integration.total_events,
    successful_events: integration.successful_events,
    failed_events: integration.failed_events,
    last_event_at: integration.last_event_at,
    last_error: integration.last_error,
    created_at: integration.created_at,
    updated_at: integration.updated_at,
  };

  return NextResponse.json({ integration: publicIntegration });
});

/**
 * PATCH /api/integrations/slack/[id]
 * Update a Slack integration
 */
export const PATCH = withPermission("action-manage-integrations", async (request, { orgId, params }) => {
  const { id } = await params;
  const body = await request.json();

  // Only allow updating certain fields
  const updates: UpdateSlackIntegration = {};
  if (typeof body.enabled === "boolean") {
    updates.enabled = body.enabled;
  }
  if (Array.isArray(body.events)) {
    updates.events = body.events;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid updates provided" },
      { status: 400 }
    );
  }

  const integration = await slackIntegrationQueries.update(orgId, id, updates);

  if (!integration) {
    return NextResponse.json(
      { error: "Integration not found" },
      { status: 404 }
    );
  }

  // Return public-safe version
  const publicIntegration: SlackIntegrationPublic = {
    id: integration.id,
    org_id: integration.org_id,
    team_id: integration.team_id,
    team_name: integration.team_name,
    channel_id: integration.channel_id,
    channel_name: integration.channel_name,
    enabled: integration.enabled,
    events: integration.events,
    total_events: integration.total_events,
    successful_events: integration.successful_events,
    failed_events: integration.failed_events,
    last_event_at: integration.last_event_at,
    last_error: integration.last_error,
    created_at: integration.created_at,
    updated_at: integration.updated_at,
  };

  return NextResponse.json({ integration: publicIntegration });
});

/**
 * DELETE /api/integrations/slack/[id]
 * Remove a Slack integration
 */
export const DELETE = withPermission("action-manage-integrations", async (_request, { userId, orgId, params }) => {
  const { id } = await params;

  // Verify integration exists first
  const existing = await slackIntegrationQueries.findById(orgId, id);
  if (!existing) {
    return NextResponse.json(
      { error: "Integration not found" },
      { status: 404 }
    );
  }

  await slackIntegrationQueries.delete(orgId, id);

  emitSystemEvent({
    orgId,
    eventType: "integration.slack_disconnected",
    category: "integration",
    title: "Slack integration removed",
    severity: "warning",
    entityId: id,
    entityType: "integration",
    actorId: userId,
  });

  return NextResponse.json({ success: true });
});
