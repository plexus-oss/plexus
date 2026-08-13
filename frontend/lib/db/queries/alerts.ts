import { and, asc, desc, eq, gte, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { db } from "../client";
import { alerts, alertEvents } from "../schema";
import { oneOrNull } from "./shared";
import {
  tallyVerdicts,
  VERDICT_WINDOW_DAYS,
  VERDICT_SAMPLE,
} from "@/lib/alerts/verdicts";
import type {
  Alert,
  NewAlert,
  AlertStatus,
  AlertTriggerType,
  AlertEvent,
  AlertEventType,
  LimitSeverity,
  VerdictStats,
} from "../types";

type StatusEnum = (typeof alerts.status.enumValues)[number];
type SeverityEnum = (typeof alerts.severity.enumValues)[number];
type TriggerEnum = (typeof alerts.trigger_type.enumValues)[number];

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const alertQueries = {
  findAll: async (
    orgId: string,
    options?: {
      status?: AlertStatus | AlertStatus[];
      severity?: LimitSeverity | LimitSeverity[];
      sourceId?: string | string[];
      triggerType?: AlertTriggerType;
      limit?: number;
      offset?: number;
    },
  ): Promise<Alert[]> => {
    const filters: SQL[] = [eq(alerts.org_id, orgId)];

    if (options?.status) {
      const statuses = (
        Array.isArray(options.status) ? options.status : [options.status]
      ) as StatusEnum[];
      filters.push(inArray(alerts.status, statuses));
    }

    if (options?.severity) {
      const severities = (
        Array.isArray(options.severity) ? options.severity : [options.severity]
      ) as SeverityEnum[];
      filters.push(inArray(alerts.severity, severities));
    }

    if (options?.sourceId) {
      if (Array.isArray(options.sourceId)) {
        if (options.sourceId.length === 1) {
          filters.push(eq(alerts.source_id, options.sourceId[0]));
        } else if (options.sourceId.length > 1) {
          filters.push(inArray(alerts.source_id, options.sourceId));
        }
      } else {
        filters.push(eq(alerts.source_id, options.sourceId));
      }
    }

    if (options?.triggerType) {
      filters.push(eq(alerts.trigger_type, options.triggerType as TriggerEnum));
    }

    let query = db
      .select()
      .from(alerts)
      .where(and(...filters))
      .orderBy(desc(alerts.triggered_at))
      .$dynamic();

    // Preserve the old PostgREST .range(offset, offset+(limit||50)-1) semantics:
    // an offset with no explicit limit still capped the page at 50 rows.
    if (options?.offset) {
      query = query.limit(options.limit ?? 50).offset(options.offset);
    } else if (options?.limit) {
      query = query.limit(options.limit);
    }

    return (await query) as Alert[];
  },

  findById: async (orgId: string, alertId: string): Promise<Alert | null> => {
    const rows = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.org_id, orgId), eq(alerts.id, alertId)))
      .limit(1);
    return oneOrNull(rows) as Alert | null;
  },

  findBySource: async (
    orgId: string,
    sourceId: string,
    options?: {
      status?: AlertStatus | AlertStatus[];
      limit?: number;
    },
  ): Promise<Alert[]> => {
    const filters: SQL[] = [
      eq(alerts.org_id, orgId),
      eq(alerts.source_id, sourceId),
    ];

    if (options?.status) {
      const statuses = (
        Array.isArray(options.status) ? options.status : [options.status]
      ) as StatusEnum[];
      filters.push(inArray(alerts.status, statuses));
    }

    let query = db
      .select()
      .from(alerts)
      .where(and(...filters))
      .orderBy(desc(alerts.triggered_at))
      .$dynamic();

    if (options?.limit) query = query.limit(options.limit);

    return (await query) as Alert[];
  },

  create: async (
    orgId: string,
    data: Omit<NewAlert, "org_id" | "id" | "created_at" | "updated_at">,
  ): Promise<Alert> => {
    const [result] = await db
      .insert(alerts)
      .values({ org_id: orgId, ...data } as typeof alerts.$inferInsert)
      .returning();
    return result as Alert;
  },

  update: async (
    orgId: string,
    alertId: string,
    data: Partial<Omit<Alert, "id" | "org_id" | "created_at">>,
    tx?: DbOrTx,
  ): Promise<Alert | null> => {
    const d = tx ?? db;
    const [result] = await d
      .update(alerts)
      .set(data as Partial<typeof alerts.$inferInsert>)
      .where(and(eq(alerts.org_id, orgId), eq(alerts.id, alertId)))
      .returning();
    return (result ?? null) as Alert | null;
  },

  acknowledge: async (
    orgId: string,
    alertId: string,
    userId: string,
    tx?: DbOrTx,
  ): Promise<Alert | null> => {
    return alertQueries.update(orgId, alertId, {
      status: "acknowledged",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: userId,
    }, tx);
  },

  resolve: async (
    orgId: string,
    alertId: string,
    userId: string,
    resolutionNotes?: string,
    tx?: DbOrTx,
  ): Promise<Alert | null> => {
    return alertQueries.update(orgId, alertId, {
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
      resolution_notes: resolutionNotes ?? null,
      // Resolving also closes the condition — same coupling as the PATCH
      // /api/alerts/[id] "resolve" action (see that route for why). COALESCE
      // keeps an earlier machine-set closed_at (the true clear time).
      is_alert_active: false,
      closed_at: sql`COALESCE(closed_at, now())` as unknown as string,
    }, tx);
  },

  reopen: async (orgId: string, alertId: string, tx?: DbOrTx): Promise<Alert | null> => {
    return alertQueries.update(orgId, alertId, {
      status: "open",
      resolved_at: null,
      resolved_by: null,
      resolution_notes: null,
    }, tx);
  },

  /**
   * The active alert for a (limit, source) pair, if any. Poll-path mirror of
   * adminAlertQueries.findOpenByRuleAndSource — used by the limit recovery
   * path (lib/alerts/fire-alert.ts resolveLimitAlert) and backed by the
   * unique partial index idx_alerts_one_open_per_limit_source.
   */
  findActiveByLimitAndSource: async (
    orgId: string,
    limitId: string,
    sourceId: string,
  ): Promise<Alert | null> => {
    const rows = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.org_id, orgId),
          eq(alerts.limit_id, limitId),
          eq(alerts.source_id, sourceId),
          eq(alerts.is_alert_active, true),
        ),
      )
      .limit(1);
    return oneOrNull(rows) as Alert | null;
  },


  /**
   * Roll up recent operator verdicts for the rule/limit/event that fired an
   * alert, scoped to one source — "this monitor was marked noise N of the last
   * M times on THIS source". Keyed by rule_id (alert-service rules), limit_id
   * (threshold limits), or eventMetric (event monitors, which carry neither id
   * — identified by trigger_type='event' + source_id + metric). Pass whichever
   * the alert carries plus its source_id.
   *
   * Windowed by recency (latest VERDICT_SAMPLE alerts in the last
   * VERDICT_WINDOW_DAYS) so a monitor's reputation reflects current behavior,
   * not a stale lifetime tally. One indexed, bounded round trip — read live at
   * panel-open. (A maintained aggregate is the next step if volume demands it.)
   */
  getVerdictStats: async (
    orgId: string,
    by: {
      ruleId?: string | null;
      limitId?: string | null;
      sourceId?: string | null;
      eventMetric?: string | null;
    },
  ): Promise<VerdictStats> => {
    const empty: VerdictStats = { helpful: 0, noise: 0, total: 0 };
    // Event monitors have no rule/limit id, so they need source + metric.
    const isEvent = !by.ruleId && !by.limitId && !!by.eventMetric;
    if (!by.ruleId && !by.limitId && !isEvent) return empty;
    if (isEvent && !by.sourceId) return empty;
    const since = new Date(
      Date.now() - VERDICT_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    const filters: SQL[] = [
      eq(alerts.org_id, orgId),
      isNotNull(alerts.current_verdict),
      gte(alerts.triggered_at, since),
      by.ruleId
        ? eq(alerts.rule_id, by.ruleId)
        : by.limitId
          ? eq(alerts.limit_id, by.limitId)
          : and(
              eq(alerts.trigger_type, "event"),
              eq(alerts.metric, by.eventMetric as string),
            )!,
    ];
    if (by.sourceId) filters.push(eq(alerts.source_id, by.sourceId));

    const rows = await db
      .select({ current_verdict: alerts.current_verdict })
      .from(alerts)
      .where(and(...filters))
      .orderBy(desc(alerts.triggered_at))
      .limit(VERDICT_SAMPLE);
    return tallyVerdicts(rows);
  },

  getCountsByStatus: async (
    orgId: string,
    sourceId?: string[],
  ): Promise<Record<AlertStatus, number>> => {
    // `sourceId` scopes the counts to a subset of sources (external/guest users)
    // so the status totals match the alerts they can actually see.
    const where =
      sourceId && sourceId.length > 0
        ? and(eq(alerts.org_id, orgId), inArray(alerts.source_id, sourceId))
        : eq(alerts.org_id, orgId);
    const rows = await db
      .select({
        status: alerts.status,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(alerts)
      .where(where)
      .groupBy(alerts.status);

    const counts: Record<AlertStatus, number> = {
      open: 0,
      acknowledged: 0,
      resolved: 0,
    };

    for (const row of rows) {
      if (row.status in counts) {
        counts[row.status as AlertStatus] += row.count;
      }
    }

    return counts;
  },

  delete: async (orgId: string, alertId: string): Promise<boolean> => {
    await db
      .delete(alerts)
      .where(and(eq(alerts.org_id, orgId), eq(alerts.id, alertId)));
    return true;
  },
};

export const alertEventQueries = {
  findByAlert: async (
    orgId: string,
    alertId: string,
  ): Promise<AlertEvent[]> =>
    (await db
      .select()
      .from(alertEvents)
      .where(
        and(eq(alertEvents.org_id, orgId), eq(alertEvents.alert_id, alertId)),
      )
      .orderBy(asc(alertEvents.created_at))) as AlertEvent[],

  create: async (
    orgId: string,
    alertId: string,
    eventType: AlertEventType,
    data?: {
      actorId?: string;
      message?: string;
      metadata?: Record<string, unknown>;
    },
    tx?: DbOrTx,
  ): Promise<AlertEvent> => {
    const d = tx ?? db;
    const [result] = await d
      .insert(alertEvents)
      .values({
        org_id: orgId,
        alert_id: alertId,
        event_type: eventType,
        actor_id: data?.actorId ?? null,
        message: data?.message ?? null,
        metadata: data?.metadata ?? {},
      } as typeof alertEvents.$inferInsert)
      .returning();
    return result as AlertEvent;
  },
};
