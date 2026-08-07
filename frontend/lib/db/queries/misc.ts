import "server-only";

import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "../client";
import {
  annotations,
  apiKeys,
  feedback,
  systemEvents,
  usage,
  userNotificationState,
  userSettings,
} from "../schema";
import { createOrgQueries, oneOrNull } from "./shared";
import type {
  ApiKey,
  NewApiKey,
  Annotation,
  NewAnnotation,
  UserSettingsRecord,
  UserNotificationState,
  Usage,
  Feedback,
  FeedbackType,
  SystemEvent,
} from "../types";

// =============================================================================
// API KEY QUERIES
// =============================================================================

export const apiKeyQueries = {
  ...createOrgQueries<ApiKey, NewApiKey>(apiKeys),
};

// =============================================================================
// ANNOTATION QUERIES
// =============================================================================

export const annotationQueries = {
  ...createOrgQueries<Annotation, NewAnnotation>(annotations),

  findBySource: async (
    orgId: string,
    sourceId: string,
  ): Promise<Annotation[]> => {
    return (await db
      .select()
      .from(annotations)
      .where(
        and(
          eq(annotations.org_id, orgId),
          eq(annotations.source_id, sourceId),
        ),
      )) as Annotation[];
  },

  findByTelemetryId: async (
    orgId: string,
    telemetryId: string,
  ): Promise<Annotation[]> => {
    return (await db
      .select()
      .from(annotations)
      .where(
        and(
          eq(annotations.org_id, orgId),
          eq(annotations.telemetry_id, telemetryId),
        ),
      )) as Annotation[];
  },

  findByTimeRange: async (
    orgId: string,
    startTime: Date,
    endTime: Date,
    sourceId?: string,
    metricName?: string,
  ): Promise<Annotation[]> => {
    // Points/regions starting before the range end, and either open-ended
    // (timestamp_end is null) or ending at/after the range start.
    return (await db
      .select()
      .from(annotations)
      .where(
        and(
          eq(annotations.org_id, orgId),
          lte(annotations.timestamp_start, endTime.toISOString()),
          or(
            isNull(annotations.timestamp_end),
            gte(annotations.timestamp_end, startTime.toISOString()),
          ),
          sourceId ? eq(annotations.source_id, sourceId) : undefined,
          metricName ? eq(annotations.metric_name, metricName) : undefined,
        ),
      )
      .orderBy(asc(annotations.timestamp_start))) as Annotation[];
  },

  findBySourceInRange: async (
    orgId: string,
    sourceId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<Annotation[]> => {
    // Get points within range AND regions that overlap the range
    return (await db
      .select()
      .from(annotations)
      .where(
        and(
          eq(annotations.org_id, orgId),
          eq(annotations.source_id, sourceId),
          lte(annotations.timestamp_start, endTime.toISOString()),
          or(
            isNull(annotations.timestamp_end),
            gte(annotations.timestamp_end, startTime.toISOString()),
          ),
        ),
      )
      .orderBy(asc(annotations.timestamp_start))) as Annotation[];
  },

  findByTelemetryPoint: async (
    orgId: string,
    sourceId: string,
    metricName: string,
    timestamp: Date,
  ): Promise<Annotation[]> => {
    return (await db
      .select()
      .from(annotations)
      .where(
        and(
          eq(annotations.org_id, orgId),
          eq(annotations.source_id, sourceId),
          eq(annotations.metric_name, metricName),
          eq(annotations.timestamp_start, timestamp.toISOString()),
        ),
      )) as Annotation[];
  },
};

// =============================================================================
// USER SETTINGS QUERIES
// =============================================================================

export const userSettingsQueries = {
  findByUserId: async (userId: string): Promise<UserSettingsRecord[]> => {
    return (await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.user_id, userId))) as UserSettingsRecord[];
  },

  upsert: async (
    userId: string,
    data: Partial<Omit<UserSettingsRecord, "user_id" | "id">>,
  ): Promise<UserSettingsRecord[]> => {
    const values = { ...data, user_id: userId };
    return (await db
      .insert(userSettings)
      .values(values as typeof userSettings.$inferInsert)
      .onConflictDoUpdate({
        target: userSettings.user_id,
        set: data as Partial<typeof userSettings.$inferInsert>,
      })
      .returning()) as UserSettingsRecord[];
  },
};

// =============================================================================
// USER NOTIFICATION STATE QUERIES
// =============================================================================

export const userNotificationStateQueries = {
  get: async (
    userId: string,
    orgId: string,
  ): Promise<UserNotificationState | null> => {
    const rows = await db
      .select()
      .from(userNotificationState)
      .where(
        and(
          eq(userNotificationState.user_id, userId),
          eq(userNotificationState.org_id, orgId),
        ),
      )
      .limit(1);
    return oneOrNull(rows) as UserNotificationState | null;
  },

  setAlertsLastSeen: async (
    userId: string,
    orgId: string,
    seenAt: Date,
  ): Promise<UserNotificationState> => {
    const [row] = await db
      .insert(userNotificationState)
      .values({
        user_id: userId,
        org_id: orgId,
        alerts_last_seen_at: seenAt.toISOString(),
      } as typeof userNotificationState.$inferInsert)
      .onConflictDoUpdate({
        target: [userNotificationState.user_id, userNotificationState.org_id],
        set: { alerts_last_seen_at: seenAt.toISOString() },
      })
      .returning();
    return row as UserNotificationState;
  },
};

// =============================================================================
// USAGE QUERIES
// =============================================================================

export const usageQueries = {
  getOrCreateToday: async (orgId: string): Promise<Usage> => {
    const today = new Date().toISOString().split("T")[0];

    const [existing] = await db
      .select()
      .from(usage)
      .where(and(eq(usage.org_id, orgId), eq(usage.period_start, today)))
      .limit(1);

    if (existing) {
      return existing as unknown as Usage;
    }

    const [created] = await db
      .insert(usage)
      .values({
        org_id: orgId,
        period_start: today,
        data_points_ingested: 0,
        bytes_ingested: 0,
        devices_active: 0,
      } as typeof usage.$inferInsert)
      .returning();

    return created as unknown as Usage;
  },

  incrementDataPoints: async (
    orgId: string,
    count: number,
    bytes: number,
  ): Promise<void> => {
    const today = new Date().toISOString().split("T")[0];

    const [existing] = await db
      .select({
        data_points_ingested: usage.data_points_ingested,
        bytes_ingested: usage.bytes_ingested,
      })
      .from(usage)
      .where(and(eq(usage.org_id, orgId), eq(usage.period_start, today)))
      .limit(1);

    if (existing) {
      await db
        .update(usage)
        .set({
          data_points_ingested: existing.data_points_ingested + count,
          bytes_ingested: existing.bytes_ingested + bytes,
        } as Partial<typeof usage.$inferInsert>)
        .where(and(eq(usage.org_id, orgId), eq(usage.period_start, today)));
    } else {
      await usageQueries.getOrCreateToday(orgId);
      await db
        .update(usage)
        .set({
          data_points_ingested: count,
          bytes_ingested: bytes,
        } as Partial<typeof usage.$inferInsert>)
        .where(and(eq(usage.org_id, orgId), eq(usage.period_start, today)));
    }
  },

  getByDateRange: async (
    orgId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Usage[]> => {
    return (await db
      .select()
      .from(usage)
      .where(
        and(
          eq(usage.org_id, orgId),
          gte(usage.period_start, startDate.toISOString().split("T")[0]),
          lte(usage.period_start, endDate.toISOString().split("T")[0]),
        ),
      )
      .orderBy(desc(usage.period_start))) as unknown as Usage[];
  },

  getCurrentMonthSummary: async (
    orgId: string,
  ): Promise<{
    dataPoints: number;
    bytesIngested: number;
    devicesActive: number;
  }> => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const records = await usageQueries.getByDateRange(
      orgId,
      startOfMonth,
      endOfMonth,
    );

    return records.reduce(
      (acc, record) => ({
        dataPoints: acc.dataPoints + record.data_points_ingested,
        bytesIngested: acc.bytesIngested + record.bytes_ingested,
        devicesActive: Math.max(acc.devicesActive, record.devices_active),
      }),
      { dataPoints: 0, bytesIngested: 0, devicesActive: 0 },
    );
  },

  setDevicesActive: async (orgId: string, count: number): Promise<void> => {
    const today = new Date().toISOString().split("T")[0];
    await usageQueries.getOrCreateToday(orgId);

    await db
      .update(usage)
      .set({ devices_active: count } as Partial<typeof usage.$inferInsert>)
      .where(and(eq(usage.org_id, orgId), eq(usage.period_start, today)));
  },
};

// =============================================================================
// FEEDBACK QUERIES
// =============================================================================

export const feedbackQueries = {
  submit: async (
    orgId: string,
    userId: string,
    data: {
      userEmail?: string | null;
      feedbackType: FeedbackType;
      title: string;
      message: string;
      pageUrl?: string | null;
      userAgent?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Feedback> => {
    const [result] = await db
      .insert(feedback)
      .values({
        org_id: orgId,
        user_id: userId,
        user_email: data.userEmail ?? null,
        feedback_type: data.feedbackType,
        title: data.title,
        message: data.message,
        page_url: data.pageUrl ?? null,
        user_agent: data.userAgent ?? null,
        metadata: data.metadata ?? {},
      } as typeof feedback.$inferInsert)
      .returning();
    return result as Feedback;
  },

  list: async (
    orgId: string,
    options?: {
      limit?: number;
      offset?: number;
      feedbackType?: FeedbackType;
    },
  ): Promise<Feedback[]> => {
    let q = db
      .select()
      .from(feedback)
      .where(
        and(
          eq(feedback.org_id, orgId),
          options?.feedbackType
            ? eq(
                feedback.feedback_type,
                options.feedbackType as typeof feedback.feedback_type.enumValues[number],
              )
            : undefined,
        ),
      )
      .orderBy(desc(feedback.created_at))
      .$dynamic();

    if (options?.limit) {
      q = q.limit(options.limit);
    }
    if (options?.offset) {
      q = q.offset(options.offset);
    }

    return (await q) as Feedback[];
  },
};

// commandQueries, commandPolicyQueries, commandDefinitionQueries removed — commanding feature cut

// =============================================================================
// SYSTEM EVENT QUERIES
// =============================================================================

export const systemEventQueries = {
  findAll: async (
    orgId: string,
    options?: {
      category?: string;
      eventType?: string;
      severity?: string;
      sourceId?: string;
      search?: string;
      startTime?: string;
      endTime?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ events: SystemEvent[]; total: number }> => {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const where = and(
      eq(systemEvents.org_id, orgId),
      options?.category ? eq(systemEvents.category, options.category) : undefined,
      options?.eventType
        ? eq(systemEvents.event_type, options.eventType)
        : undefined,
      options?.severity ? eq(systemEvents.severity, options.severity) : undefined,
      options?.sourceId ? eq(systemEvents.source_id, options.sourceId) : undefined,
      // Full-text search over the generated tsvector (parameterized query).
      options?.search
        ? sql`${systemEvents.search_vector} @@ websearch_to_tsquery('english', ${options.search})`
        : undefined,
      options?.startTime
        ? gte(systemEvents.created_at, options.startTime)
        : undefined,
      options?.endTime ? lte(systemEvents.created_at, options.endTime) : undefined,
    );

    const events = (await db
      .select()
      .from(systemEvents)
      .where(where)
      .orderBy(desc(systemEvents.created_at))
      .limit(limit)
      .offset(offset)) as SystemEvent[];

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(systemEvents)
      .where(where);

    return {
      events,
      total: count ?? 0,
    };
  },
};
