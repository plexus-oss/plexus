import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { withRoleAuth, withPermission } from "@/lib/api/with-auth";
import { validateBody } from "@/lib/api/validate";
import { CreateWebhookSchema } from "@/lib/validation/api-schemas";
import { webhookQueries } from "@/lib/db/supabase";
import { emitSystemEvent } from "@/lib/events/emit";
import { apiError } from "@/lib/api/errors";
import { assertPublicUrl, SsrfError } from "@/lib/security/ssrf";

/**
 * GET /api/webhooks - List all webhooks for the organization
 */
// Listing follows the edit permission so lowering the webhook thresholds in
// the matrix gives a coherent experience (whoever can edit can list).
export const GET = withPermission("action-edit-webhook", async (_request, { orgId }) => {
  const webhooks = await webhookQueries.findAll(orgId);

  // Don't expose secrets in list view
  const safeWebhooks = webhooks.map((webhook) => ({
    ...webhook,
    secret: undefined,
    secretPrefix: webhook.secret.substring(0, 8) + "...",
  }));

  return NextResponse.json({ webhooks: safeWebhooks });
});

/**
 * POST /api/webhooks - Create a new webhook
 */
export const POST = withPermission("action-create-webhook", async (request, { userId, orgId }) => {
  const { name, description, url, events, sourceFilter, customHeaders } =
    await validateBody(request, CreateWebhookSchema);

  // Validate URL protocol AND that it doesn't point at a private/loopback/
  // metadata/6PN address (SSRF). Re-checked at delivery time too, but reject
  // obviously-bad URLs up front with a clear error.
  try {
    await assertPublicUrl(url, { allowHttp: true });
  } catch (error) {
    throw apiError(
      "VALIDATION_ERROR",
      error instanceof SsrfError ? error.message : "Invalid webhook URL",
    );
  }

  // Generate a secure secret. `secret_prefix` is the public-safe first
  // 8 chars used by the UI for a sanity-check display — replicated to
  // Zero clients while the full `secret` stays server-only. Write both
  // atomically so they can never drift.
  const secret = `whsec_${randomBytes(32).toString("hex")}`;
  const secret_prefix = secret.substring(0, 8);

  const webhooks = await webhookQueries.insert(orgId, {
    name,
    description: description?.trim() || null,
    url,
    secret,
    secret_prefix,
    events,
    source_filter: sourceFilter || null,
    custom_headers: customHeaders || {},
    enabled: true,
    created_by: userId,
  });

  if (webhooks.length === 0) {
    throw apiError("DATABASE_ERROR", "Failed to create webhook");
  }

  emitSystemEvent({
    orgId,
    eventType: "webhook.created",
    category: "webhook",
    title: `Webhook "${name}" created`,
    severity: "success",
    entityId: webhooks[0].id,
    entityType: "webhook",
    actorId: userId,
  });

  // Return the webhook with the secret visible (only on create)
  return NextResponse.json(
    {
      webhook: webhooks[0],
      message: "Webhook created. Save the secret - it won't be shown again.",
    },
    { status: 201 }
  );
});
