/**
 * Slack OAuth Callback
 *
 * Handles the redirect from Slack after user authorizes the app.
 * Exchanges the code for an access token and webhook URL.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  slackIntegrationQueries,
  slackOAuthStateQueries,
} from "@/lib/db/supabase";
import { encrypt } from "@/lib/encryption";
import type { NewSlackIntegration } from "@/lib/db/types";

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  app_id?: string;
  authed_user?: {
    id: string;
  };
  scope?: string;
  token_type?: string;
  access_token?: string;
  bot_user_id?: string;
  team?: {
    id: string;
    name: string;
  };
  incoming_webhook?: {
    channel: string;
    channel_id: string;
    configuration_url: string;
    url: string;
  };
}

/**
 * GET /api/integrations/slack/callback
 * Handle OAuth callback from Slack
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Get the base URL for redirects.
  // Must be the public app URL: behind the Fly proxy, request.nextUrl.origin
  // resolves to the server bind address (https://[::]:3000), and the token
  // exchange's redirect_uri must exactly match the one used in the authorize step.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const successRedirect = `${baseUrl}/alerts/integrations?slack=connected`;
  const errorRedirect = `${baseUrl}/alerts/integrations?slack=error`;

  // Handle user denial
  if (error) {
    console.error("Slack OAuth error:", error);
    return NextResponse.redirect(
      `${errorRedirect}&message=${encodeURIComponent(error)}`,
    );
  }

  // Validate required parameters
  if (!code || !state) {
    return NextResponse.redirect(`${errorRedirect}&message=missing_params`);
  }

  // Validate configuration
  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
    return NextResponse.redirect(`${errorRedirect}&message=not_configured`);
  }

  try {
    // Validate and consume the state (CSRF protection)
    const oauthState = await slackOAuthStateQueries.validateAndConsume(state);
    if (!oauthState) {
      return NextResponse.redirect(`${errorRedirect}&message=invalid_state`);
    }

    const { org_id: orgId, user_id: userId } = oauthState;

    // Exchange code for access token
    const redirectUri = `${baseUrl}/api/integrations/slack/callback`;

    const tokenResponse = await fetch(SLACK_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData: SlackOAuthResponse = await tokenResponse.json();

    if (!tokenData.ok) {
      console.error("Slack token exchange failed:", tokenData.error);
      return NextResponse.redirect(
        `${errorRedirect}&message=${encodeURIComponent(tokenData.error || "token_exchange_failed")}`,
      );
    }

    // Validate we got the webhook data
    if (!tokenData.incoming_webhook || !tokenData.team) {
      console.error("Missing webhook or team data in Slack response");
      return NextResponse.redirect(
        `${errorRedirect}&message=missing_webhook_data`,
      );
    }

    const { incoming_webhook, team, access_token } = tokenData;

    // Check if integration already exists for this channel
    const existing = await slackIntegrationQueries.findByChannel(
      orgId,
      team.id,
      incoming_webhook.channel_id,
    );

    if (existing) {
      // Update existing integration with new webhook URL
      // This handles cases where user re-authorizes
      return NextResponse.redirect(
        `${successRedirect}&message=already_connected&channel=${encodeURIComponent(incoming_webhook.channel)}`,
      );
    }

    // Create new integration
    const newIntegration: NewSlackIntegration = {
      org_id: orgId,
      team_id: team.id,
      team_name: team.name,
      channel_id: incoming_webhook.channel_id,
      channel_name: incoming_webhook.channel,
      webhook_url_encrypted: encrypt(incoming_webhook.url),
      access_token_encrypted: access_token ? encrypt(access_token) : null,
      enabled: true,
      events: ["alert.triggered", "device.offline"],
      created_by: userId,
    };

    await slackIntegrationQueries.create(newIntegration);

    return NextResponse.redirect(
      `${successRedirect}&channel=${encodeURIComponent(incoming_webhook.channel)}&team=${encodeURIComponent(team.name)}`,
    );
  } catch (err) {
    console.error("Error in Slack OAuth callback:", err);
    return NextResponse.redirect(`${errorRedirect}&message=internal_error`);
  }
}
