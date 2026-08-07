/**
 * Slack Integration API
 *
 * GET  - List all Slack integrations for the org
 * POST - Initiate OAuth flow (returns redirect URL)
 */

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { withAuth, withPermission } from "@/lib/api/with-auth";
import {
  slackIntegrationQueries,
  slackOAuthStateQueries,
} from "@/lib/db/supabase";
import { emitSystemEvent } from "@/lib/events/emit";
import type { SlackIntegrationPublic } from "@/lib/db/types";

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_OAUTH_URL = "https://slack.com/oauth/v2/authorize";

/**
 * GET /api/integrations/slack
 * List all Slack integrations for the org
 */
export const GET = withAuth(async (_request, { orgId }) => {
  const integrations = await slackIntegrationQueries.findAll(orgId);

  // Return public-safe versions (no encrypted fields)
  const publicIntegrations: SlackIntegrationPublic[] = integrations.map(
    (integration) => ({
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
    })
  );

  return NextResponse.json({ integrations: publicIntegrations });
});

/**
 * POST /api/integrations/slack
 * Initiate OAuth flow - returns URL to redirect user to
 */
export const POST = withPermission("action-manage-integrations", async (request, { userId, orgId }) => {
  if (!SLACK_CLIENT_ID) {
    return NextResponse.json(
      { error: "Slack integration not configured" },
      { status: 503 }
    );
  }

  // Generate a secure state parameter for CSRF protection
  const state = randomBytes(32).toString("hex");

  // Store the state in database
  await slackOAuthStateQueries.create(orgId, userId, state);

  // Build the redirect URL. Must match the callback's redirect_uri exactly,
  // so both derive from the canonical public app URL.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    request.headers.get("origin") ||
    new URL(request.url).origin;
  const redirectUri = `${baseUrl}/api/integrations/slack/callback`;

  const params = new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    scope: "incoming-webhook",
    redirect_uri: redirectUri,
    state,
  });

  const authUrl = `${SLACK_OAUTH_URL}?${params.toString()}`;

  emitSystemEvent({
    orgId,
    eventType: "integration.slack_connected",
    category: "integration",
    title: "Slack integration initiated",
    severity: "success",
    actorId: userId,
  });

  return NextResponse.json({ url: authUrl });
});
