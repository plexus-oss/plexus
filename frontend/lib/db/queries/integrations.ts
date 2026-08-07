import "server-only";

import { and, asc, desc, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";

import { db } from "../client";
import {
  webhooks,
  webhookDeliveries,
  slackIntegrations,
  slackOauthStates,
  emailIntegrations,
  notificationDeliveries,
} from "../schema";
import { oneOrNull } from "./shared";
import type {
  Webhook,
  NewWebhook,
  WebhookDelivery,
  NewWebhookDelivery,
  WebhookEventType,
  WebhookDeliveryStatus,
  SlackIntegration,
  NewSlackIntegration,
  UpdateSlackIntegration,
  SlackOAuthState,
  EmailIntegration,
  NewEmailIntegration,
  UpdateEmailIntegration,
  NotificationDelivery,
  NewNotificationDelivery,
} from "../types";
import { createOrgQueries } from "./shared";

// =============================================================================
// WEBHOOK QUERIES
// =============================================================================

export const webhookQueries = {
  ...createOrgQueries<Webhook, NewWebhook>(webhooks),

  findEnabled: async (orgId: string): Promise<Webhook[]> => {
    return (await db
      .select()
      .from(webhooks)
      .where(
        and(eq(webhooks.org_id, orgId), eq(webhooks.enabled, true)),
      )) as Webhook[];
  },

  findByEvent: async (
    orgId: string,
    eventType: WebhookEventType,
  ): Promise<Webhook[]> => {
    // events is a text[] column; `@>` tests array containment (parameterized).
    return (await db
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.org_id, orgId),
          eq(webhooks.enabled, true),
          sql`${webhooks.events} @> ARRAY[${eventType}]::text[]`,
        ),
      )) as Webhook[];
  },

  // Explicit per-rule targeting bypasses the events subscription filter but
  // still respects enabled.
  findEnabledByIds: async (orgId: string, ids: string[]): Promise<Webhook[]> => {
    if (ids.length === 0) return [];
    return (await db
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.org_id, orgId),
          eq(webhooks.enabled, true),
          inArray(webhooks.id, ids),
        ),
      )) as Webhook[];
  },

  updateStats: async (
    orgId: string,
    webhookId: string,
    success: boolean,
    error?: string,
  ): Promise<Webhook | null> => {
    const current = oneOrNull(
      await db
        .select({
          total_deliveries: webhooks.total_deliveries,
          successful_deliveries: webhooks.successful_deliveries,
          failed_deliveries: webhooks.failed_deliveries,
        })
        .from(webhooks)
        .where(and(eq(webhooks.org_id, orgId), eq(webhooks.id, webhookId)))
        .limit(1),
    );

    if (!current) return null;

    const stats = current;

    const updateData: Record<string, unknown> = {
      total_deliveries: stats.total_deliveries + 1,
      last_triggered_at: new Date().toISOString(),
    };

    if (success) {
      updateData.successful_deliveries = stats.successful_deliveries + 1;
      updateData.last_success_at = new Date().toISOString();
      updateData.last_error = null;
    } else {
      updateData.failed_deliveries = stats.failed_deliveries + 1;
      updateData.last_failure_at = new Date().toISOString();
      if (error) updateData.last_error = error;
    }

    const [result] = await db
      .update(webhooks)
      .set(updateData as Partial<typeof webhooks.$inferInsert>)
      .where(and(eq(webhooks.org_id, orgId), eq(webhooks.id, webhookId)))
      .returning();
    return (result ?? null) as Webhook | null;
  },

  toggle: async (
    orgId: string,
    webhookId: string,
    enabled: boolean,
  ): Promise<Webhook | null> => {
    const [result] = await db
      .update(webhooks)
      .set({ enabled } as Partial<typeof webhooks.$inferInsert>)
      .where(and(eq(webhooks.org_id, orgId), eq(webhooks.id, webhookId)))
      .returning();
    return (result ?? null) as Webhook | null;
  },
};

// =============================================================================
// WEBHOOK DELIVERY QUERIES
// =============================================================================

export const webhookDeliveryQueries = {
  ...createOrgQueries<WebhookDelivery, NewWebhookDelivery>(webhookDeliveries),

  findByWebhook: async (
    orgId: string,
    webhookId: string,
    options?: {
      status?: WebhookDeliveryStatus | WebhookDeliveryStatus[];
      limit?: number;
      offset?: number;
    },
  ): Promise<WebhookDelivery[]> => {
    const conds = [
      eq(webhookDeliveries.org_id, orgId),
      eq(webhookDeliveries.webhook_id, webhookId),
    ];

    if (options?.status) {
      const statuses = Array.isArray(options.status)
        ? options.status
        : [options.status];
      conds.push(inArray(webhookDeliveries.status, statuses));
    }

    let query = db
      .select()
      .from(webhookDeliveries)
      .where(and(...conds))
      .orderBy(desc(webhookDeliveries.created_at))
      .$dynamic();

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.limit(options.limit || 50).offset(options.offset);
    }

    return (await query) as WebhookDelivery[];
  },

  findPending: async (orgId?: string): Promise<WebhookDelivery[]> => {
    const conds = [
      inArray(webhookDeliveries.status, ["pending", "retrying"]),
      lte(webhookDeliveries.next_retry_at, new Date().toISOString()),
    ];

    if (orgId) {
      conds.push(eq(webhookDeliveries.org_id, orgId));
    }

    return (await db
      .select()
      .from(webhookDeliveries)
      .where(and(...conds))
      .orderBy(asc(webhookDeliveries.scheduled_at))) as WebhookDelivery[];
  },

  updateAttempt: async (
    orgId: string,
    deliveryId: string,
    data: {
      status: WebhookDeliveryStatus;
      responseStatus?: number;
      responseBody?: string;
      responseTimeMs?: number;
      error?: string;
      nextRetryAt?: string;
      deliveredAt?: string;
    },
  ): Promise<WebhookDelivery | null> => {
    const current = oneOrNull(
      await db
        .select({ attempt_count: webhookDeliveries.attempt_count })
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.org_id, orgId),
            eq(webhookDeliveries.id, deliveryId),
          ),
        )
        .limit(1),
    );

    const updateData: Record<string, unknown> = {
      status: data.status,
      attempt_count: (current?.attempt_count || 0) + 1,
    };

    if (data.responseStatus !== undefined)
      updateData.response_status = data.responseStatus;
    if (data.responseBody !== undefined)
      updateData.response_body = data.responseBody;
    if (data.responseTimeMs !== undefined)
      updateData.response_time_ms = data.responseTimeMs;
    if (data.error !== undefined) updateData.error = data.error;
    if (data.nextRetryAt !== undefined)
      updateData.next_retry_at = data.nextRetryAt;
    if (data.deliveredAt !== undefined)
      updateData.delivered_at = data.deliveredAt;

    const [result] = await db
      .update(webhookDeliveries)
      .set(updateData as Partial<typeof webhookDeliveries.$inferInsert>)
      .where(
        and(
          eq(webhookDeliveries.org_id, orgId),
          eq(webhookDeliveries.id, deliveryId),
        ),
      )
      .returning();
    return (result ?? null) as WebhookDelivery | null;
  },

  getStats: async (
    orgId: string,
    webhookId: string,
    days: number = 7,
  ): Promise<{
    total: number;
    delivered: number;
    failed: number;
    pending: number;
    avgResponseTime: number;
  }> => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const deliveries = (await db
      .select({
        status: webhookDeliveries.status,
        response_time_ms: webhookDeliveries.response_time_ms,
      })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.org_id, orgId),
          eq(webhookDeliveries.webhook_id, webhookId),
          sql`${webhookDeliveries.created_at} >= ${startDate.toISOString()}`,
        ),
      )) as Array<{
      status: WebhookDeliveryStatus;
      response_time_ms: number | null;
    }>;

    const delivered = deliveries.filter((d) => d.status === "delivered");
    const responseTimes = delivered
      .map((d) => d.response_time_ms)
      .filter((t): t is number => t !== null);

    return {
      total: deliveries.length,
      delivered: delivered.length,
      failed: deliveries.filter((d) => d.status === "failed").length,
      pending: deliveries.filter(
        (d) => d.status === "pending" || d.status === "retrying",
      ).length,
      avgResponseTime:
        responseTimes.length > 0
          ? Math.round(
              responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
            )
          : 0,
    };
  },
};

// =============================================================================
// SLACK INTEGRATION QUERIES
// =============================================================================

export const slackIntegrationQueries = {
  findAll: async (orgId: string): Promise<SlackIntegration[]> => {
    return (await db
      .select()
      .from(slackIntegrations)
      .where(eq(slackIntegrations.org_id, orgId))
      .orderBy(desc(slackIntegrations.created_at))) as SlackIntegration[];
  },

  findById: async (
    orgId: string,
    id: string,
  ): Promise<SlackIntegration | null> => {
    const rows = await db
      .select()
      .from(slackIntegrations)
      .where(
        and(eq(slackIntegrations.org_id, orgId), eq(slackIntegrations.id, id)),
      )
      .limit(1);
    return oneOrNull(rows) as SlackIntegration | null;
  },

  findEnabled: async (orgId: string): Promise<SlackIntegration[]> => {
    return (await db
      .select()
      .from(slackIntegrations)
      .where(
        and(
          eq(slackIntegrations.org_id, orgId),
          eq(slackIntegrations.enabled, true),
        ),
      )) as SlackIntegration[];
  },

  findByEvent: async (
    orgId: string,
    eventType: WebhookEventType,
  ): Promise<SlackIntegration[]> => {
    // events is a text[] column; `@>` tests array containment (parameterized).
    return (await db
      .select()
      .from(slackIntegrations)
      .where(
        and(
          eq(slackIntegrations.org_id, orgId),
          eq(slackIntegrations.enabled, true),
          sql`${slackIntegrations.events} @> ARRAY[${eventType}]::text[]`,
        ),
      )) as SlackIntegration[];
  },

  // Explicit per-rule targeting bypasses the events subscription filter but
  // still respects enabled.
  findEnabledByIds: async (
    orgId: string,
    ids: string[],
  ): Promise<SlackIntegration[]> => {
    if (ids.length === 0) return [];
    return (await db
      .select()
      .from(slackIntegrations)
      .where(
        and(
          eq(slackIntegrations.org_id, orgId),
          eq(slackIntegrations.enabled, true),
          inArray(slackIntegrations.id, ids),
        ),
      )) as SlackIntegration[];
  },

  create: async (
    integration: NewSlackIntegration,
  ): Promise<SlackIntegration> => {
    const [row] = await db
      .insert(slackIntegrations)
      .values(integration as typeof slackIntegrations.$inferInsert)
      .returning();
    return row as SlackIntegration;
  },

  update: async (
    orgId: string,
    id: string,
    updates: UpdateSlackIntegration,
  ): Promise<SlackIntegration | null> => {
    const [row] = await db
      .update(slackIntegrations)
      .set(updates as Partial<typeof slackIntegrations.$inferInsert>)
      .where(
        and(eq(slackIntegrations.org_id, orgId), eq(slackIntegrations.id, id)),
      )
      .returning();
    return (row ?? null) as SlackIntegration | null;
  },

  toggle: async (
    orgId: string,
    id: string,
    enabled: boolean,
  ): Promise<SlackIntegration | null> => {
    const [row] = await db
      .update(slackIntegrations)
      .set({ enabled } as Partial<typeof slackIntegrations.$inferInsert>)
      .where(
        and(eq(slackIntegrations.org_id, orgId), eq(slackIntegrations.id, id)),
      )
      .returning();
    return (row ?? null) as SlackIntegration | null;
  },

  updateStats: async (
    orgId: string,
    id: string,
    success: boolean,
    error?: string,
  ): Promise<void> => {
    const current = oneOrNull(
      await db
        .select({
          total_events: slackIntegrations.total_events,
          successful_events: slackIntegrations.successful_events,
          failed_events: slackIntegrations.failed_events,
        })
        .from(slackIntegrations)
        .where(
          and(
            eq(slackIntegrations.org_id, orgId),
            eq(slackIntegrations.id, id),
          ),
        )
        .limit(1),
    );

    if (!current) return;

    const stats = current;

    const updateData: Record<string, unknown> = {
      total_events: stats.total_events + 1,
      last_event_at: new Date().toISOString(),
    };

    if (success) {
      updateData.successful_events = stats.successful_events + 1;
      updateData.last_error = null;
    } else {
      updateData.failed_events = stats.failed_events + 1;
      if (error) updateData.last_error = error;
    }

    await db
      .update(slackIntegrations)
      .set(updateData as Partial<typeof slackIntegrations.$inferInsert>)
      .where(
        and(eq(slackIntegrations.org_id, orgId), eq(slackIntegrations.id, id)),
      );
  },

  delete: async (orgId: string, id: string): Promise<boolean> => {
    await db
      .delete(slackIntegrations)
      .where(
        and(eq(slackIntegrations.org_id, orgId), eq(slackIntegrations.id, id)),
      );
    return true;
  },

  findByChannel: async (
    orgId: string,
    teamId: string,
    channelId: string,
  ): Promise<SlackIntegration | null> => {
    const rows = await db
      .select()
      .from(slackIntegrations)
      .where(
        and(
          eq(slackIntegrations.org_id, orgId),
          eq(slackIntegrations.team_id, teamId),
          eq(slackIntegrations.channel_id, channelId),
        ),
      )
      .limit(1);
    return oneOrNull(rows) as SlackIntegration | null;
  },
};

// =============================================================================
// SLACK OAUTH STATE QUERIES
// =============================================================================

export const slackOAuthStateQueries = {
  create: async (
    orgId: string,
    userId: string,
    state: string,
  ): Promise<SlackOAuthState> => {
    const [row] = await db
      .insert(slackOauthStates)
      .values({
        org_id: orgId,
        user_id: userId,
        state,
      } as typeof slackOauthStates.$inferInsert)
      .returning();
    return row as SlackOAuthState;
  },

  validateAndConsume: async (
    state: string,
  ): Promise<SlackOAuthState | null> => {
    // Delete-and-return: a single atomic op consumes the state only if unexpired.
    const rows = await db
      .delete(slackOauthStates)
      .where(
        and(
          eq(slackOauthStates.state, state),
          gt(slackOauthStates.expires_at, new Date().toISOString()),
        ),
      )
      .returning();
    return oneOrNull(rows) as SlackOAuthState | null;
  },

  cleanExpired: async (): Promise<void> => {
    await db
      .delete(slackOauthStates)
      .where(lt(slackOauthStates.expires_at, new Date().toISOString()));
  },
};

// =============================================================================
// EMAIL INTEGRATION QUERIES
// =============================================================================

export const emailIntegrationQueries = {
  findAll: async (orgId: string): Promise<EmailIntegration[]> => {
    return (await db
      .select()
      .from(emailIntegrations)
      .where(eq(emailIntegrations.org_id, orgId))
      .orderBy(desc(emailIntegrations.created_at))) as EmailIntegration[];
  },

  findById: async (
    orgId: string,
    id: string,
  ): Promise<EmailIntegration | null> => {
    const rows = await db
      .select()
      .from(emailIntegrations)
      .where(
        and(eq(emailIntegrations.org_id, orgId), eq(emailIntegrations.id, id)),
      )
      .limit(1);
    return oneOrNull(rows) as EmailIntegration | null;
  },

  findEnabled: async (orgId: string): Promise<EmailIntegration[]> => {
    return (await db
      .select()
      .from(emailIntegrations)
      .where(
        and(
          eq(emailIntegrations.org_id, orgId),
          eq(emailIntegrations.enabled, true),
        ),
      )) as EmailIntegration[];
  },

  findByEvent: async (
    orgId: string,
    eventType: WebhookEventType,
  ): Promise<EmailIntegration[]> => {
    // events is a text[] column; `@>` tests array containment (parameterized).
    return (await db
      .select()
      .from(emailIntegrations)
      .where(
        and(
          eq(emailIntegrations.org_id, orgId),
          eq(emailIntegrations.enabled, true),
          sql`${emailIntegrations.events} @> ARRAY[${eventType}]::text[]`,
        ),
      )) as EmailIntegration[];
  },

  // Explicit per-rule targeting bypasses the events subscription filter but
  // still respects enabled.
  findEnabledByIds: async (
    orgId: string,
    ids: string[],
  ): Promise<EmailIntegration[]> => {
    if (ids.length === 0) return [];
    return (await db
      .select()
      .from(emailIntegrations)
      .where(
        and(
          eq(emailIntegrations.org_id, orgId),
          eq(emailIntegrations.enabled, true),
          inArray(emailIntegrations.id, ids),
        ),
      )) as EmailIntegration[];
  },

  create: async (
    integration: NewEmailIntegration,
  ): Promise<EmailIntegration> => {
    const [row] = await db
      .insert(emailIntegrations)
      .values(integration as typeof emailIntegrations.$inferInsert)
      .returning();
    return row as EmailIntegration;
  },

  update: async (
    orgId: string,
    id: string,
    updates: UpdateEmailIntegration,
  ): Promise<EmailIntegration | null> => {
    const [row] = await db
      .update(emailIntegrations)
      .set(updates as Partial<typeof emailIntegrations.$inferInsert>)
      .where(
        and(eq(emailIntegrations.org_id, orgId), eq(emailIntegrations.id, id)),
      )
      .returning();
    return (row ?? null) as EmailIntegration | null;
  },

  toggle: async (
    orgId: string,
    id: string,
    enabled: boolean,
  ): Promise<EmailIntegration | null> => {
    const [row] = await db
      .update(emailIntegrations)
      .set({ enabled } as Partial<typeof emailIntegrations.$inferInsert>)
      .where(
        and(eq(emailIntegrations.org_id, orgId), eq(emailIntegrations.id, id)),
      )
      .returning();
    return (row ?? null) as EmailIntegration | null;
  },

  delete: async (orgId: string, id: string): Promise<boolean> => {
    await db
      .delete(emailIntegrations)
      .where(
        and(eq(emailIntegrations.org_id, orgId), eq(emailIntegrations.id, id)),
      );
    return true;
  },

  updateStats: async (
    orgId: string,
    id: string,
    success: boolean,
    error?: string,
  ): Promise<void> => {
    const current = oneOrNull(
      await db
        .select({
          total_events: emailIntegrations.total_events,
          successful_events: emailIntegrations.successful_events,
          failed_events: emailIntegrations.failed_events,
        })
        .from(emailIntegrations)
        .where(
          and(
            eq(emailIntegrations.org_id, orgId),
            eq(emailIntegrations.id, id),
          ),
        )
        .limit(1),
    );

    if (!current) return;

    const stats = current;

    const updateData: Record<string, unknown> = {
      total_events: stats.total_events + 1,
      last_event_at: new Date().toISOString(),
    };

    if (success) {
      updateData.successful_events = stats.successful_events + 1;
      updateData.last_error = null;
    } else {
      updateData.failed_events = stats.failed_events + 1;
      if (error) updateData.last_error = error;
    }

    await db
      .update(emailIntegrations)
      .set(updateData as Partial<typeof emailIntegrations.$inferInsert>)
      .where(
        and(eq(emailIntegrations.org_id, orgId), eq(emailIntegrations.id, id)),
      );
  },
};

// =============================================================================
// NOTIFICATION DELIVERY QUERIES (Slack / email delivery records)
// =============================================================================

export const notificationDeliveryQueries = {
  create: async (
    delivery: NewNotificationDelivery,
  ): Promise<NotificationDelivery> => {
    const [row] = await db
      .insert(notificationDeliveries)
      .values(delivery as typeof notificationDeliveries.$inferInsert)
      .returning();
    return row as NotificationDelivery;
  },

  findById: async (
    orgId: string,
    id: string,
  ): Promise<NotificationDelivery | null> => {
    const rows = await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.org_id, orgId),
          eq(notificationDeliveries.id, id),
        ),
      )
      .limit(1);
    return oneOrNull(rows) as NotificationDelivery | null;
  },

  findPending: async (): Promise<NotificationDelivery[]> => {
    return (await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          inArray(notificationDeliveries.status, ["pending", "retrying"]),
          lte(notificationDeliveries.next_retry_at, new Date().toISOString()),
        ),
      )
      .orderBy(asc(notificationDeliveries.scheduled_at))
      .limit(200)) as NotificationDelivery[];
  },

  findRecentByIntegration: async (
    orgId: string,
    integrationId: string,
    limit: number = 20,
  ): Promise<NotificationDelivery[]> => {
    return (await db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.org_id, orgId),
          eq(notificationDeliveries.integration_id, integrationId),
        ),
      )
      .orderBy(desc(notificationDeliveries.created_at))
      .limit(limit)) as NotificationDelivery[];
  },

  updateAttempt: async (
    orgId: string,
    deliveryId: string,
    data: {
      status: WebhookDeliveryStatus;
      responseStatus?: number;
      responseBody?: string;
      responseTimeMs?: number;
      error?: string;
      nextRetryAt?: string | null;
      deliveredAt?: string;
    },
  ): Promise<NotificationDelivery | null> => {
    const current = oneOrNull(
      await db
        .select({ attempt_count: notificationDeliveries.attempt_count })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.org_id, orgId),
            eq(notificationDeliveries.id, deliveryId),
          ),
        )
        .limit(1),
    );

    const updateData: Record<string, unknown> = {
      status: data.status,
      attempt_count: (current?.attempt_count || 0) + 1,
    };

    if (data.responseStatus !== undefined)
      updateData.response_status = data.responseStatus;
    if (data.responseBody !== undefined)
      updateData.response_body = data.responseBody;
    if (data.responseTimeMs !== undefined)
      updateData.response_time_ms = data.responseTimeMs;
    if (data.error !== undefined) updateData.error = data.error;
    if (data.nextRetryAt !== undefined)
      updateData.next_retry_at = data.nextRetryAt;
    if (data.deliveredAt !== undefined)
      updateData.delivered_at = data.deliveredAt;

    const [result] = await db
      .update(notificationDeliveries)
      .set(updateData as Partial<typeof notificationDeliveries.$inferInsert>)
      .where(
        and(
          eq(notificationDeliveries.org_id, orgId),
          eq(notificationDeliveries.id, deliveryId),
        ),
      )
      .returning();
    return (result ?? null) as NotificationDelivery | null;
  },
};
