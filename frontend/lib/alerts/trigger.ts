/**
 * Alert Trigger Module
 *
 * Handles creating alerts from limit violations.
 * This module bridges the evaluation logic with the alert storage system.
 */

import {
  alertQueries,
  alertEventQueries,
  sourceContextQueries,
  sourceQueries,
} from "@/lib/db";
import { evaluateLimit } from "@/lib/limits";
import { triggerAlertWebhook } from "@/lib/webhooks/events";
import type {
  SourceLimit,
  Alert,
  SourceLimitRecord,
  Source,
} from "@/lib/db/types";

export interface AlertTriggerContext {
  orgId: string;
  sourceId: string;
  metric: string;
  value: number;
  timestamp: string;
  telemetryWindow?: Array<{ timestamp: string; value: number; metric: string }>;
}

export interface AlertTriggerResult {
  triggered: boolean;
  alert?: Alert;
  reason?: string;
}

/**
 * Create an alert from a limit violation
 */
export async function triggerAlertFromLimitViolation(
  context: AlertTriggerContext,
  limit: SourceLimit,
  limitRecord?: SourceLimitRecord,
): Promise<AlertTriggerResult> {
  const { orgId, sourceId, metric, value, timestamp, telemetryWindow } =
    context;

  const evaluation = evaluateLimit(value, limit);

  if (!evaluation.isViolation) {
    return { triggered: false, reason: "Value within limits" };
  }

  // Get source context for enrichment
  let contextSnapshot = {};
  try {
    const sourceContext = await sourceContextQueries.findBySource(
      orgId,
      sourceId,
    );
    contextSnapshot = {
      attachments: sourceContext.map((c) => ({
        id: c.id,
        type: c.context_type,
        name: c.name,
        description: c.description,
      })),
    };
  } catch {
    // Context enrichment is optional
  }

  // Create the alert
  const alert = await alertQueries.create(orgId, {
    source_id: sourceId,
    trigger_type: "limit_violation",
    metric,
    value,
    threshold: evaluation.violatedBound === "min" ? limit.min! : limit.max!,
    bound: evaluation.violatedBound,
    severity: limit.severity,
    limit_id: limitRecord?.id || null,
    alert_stats: telemetryWindow || [],
    context_snapshot: contextSnapshot,
    triggered_at: timestamp,
  });

  // Create the trigger event
  await alertEventQueries.create(orgId, alert.id, "created", {
    message: `Limit violation: ${metric} ${evaluation.violatedBound === "min" ? "below minimum" : "above maximum"} (${value} vs ${evaluation.violatedBound === "min" ? limit.min : limit.max})`,
    metadata: {
      value,
      limit,
      evaluation,
    },
  });

  // Trigger webhook asynchronously (don't block)
  getSourceAndTriggerWebhook(orgId, sourceId, alert, "alert.triggered").catch(
    (err) => console.error("Webhook trigger error:", err),
  );

  return { triggered: true, alert };
}

/**
 * Context for triggering alerts from Plexus Table column limit violations
 */
export interface ColumnAlertTriggerContext {
  orgId: string;
  tableId: string;
  tableName: string;
  columnName: string;
  value: number;
  rowId?: string;
  timestamp: string;
}

/**
 * Create an alert from a Plexus Table column limit violation
 */
export async function triggerAlertFromColumnLimitViolation(
  context: ColumnAlertTriggerContext,
  limit: SourceLimit,
): Promise<AlertTriggerResult> {
  const { orgId, tableId, tableName, columnName, value, rowId, timestamp } =
    context;

  // Evaluate the limit
  const evaluation = evaluateLimit(value, limit);

  if (!evaluation.isViolation) {
    return { triggered: false, reason: "Value within limits" };
  }

  // Create the alert - use tableId as source_id for linking
  const alert = await alertQueries.create(orgId, {
    source_id: tableId,
    trigger_type: "limit_violation",
    metric: columnName,
    value,
    threshold: evaluation.violatedBound === "min" ? limit.min! : limit.max!,
    bound: evaluation.violatedBound,
    severity: evaluation.severity,
    limit_id: null, // Column limits don't have a separate ID
    alert_stats: [],
    context_snapshot: {
      type: "plexus_table",
      tableName,
      columnName,
      rowId,
    },
    triggered_at: timestamp,
  });

  // Create the trigger event
  await alertEventQueries.create(orgId, alert.id, "created", {
    message: `Column limit violation: ${tableName}.${columnName} ${evaluation.violatedBound === "min" ? "below minimum" : "above maximum"} (${value} vs ${evaluation.violatedBound === "min" ? limit.min : limit.max})`,
    metadata: {
      value,
      limit,
      evaluation,
      tableId,
      rowId,
    },
  });

  return { triggered: true, alert };
}

/**
 * Batch evaluate column values and trigger alerts for violations
 */
export async function evaluateColumnLimits(
  orgId: string,
  tableId: string,
  tableName: string,
  values: Record<string, number>,
  limits: Record<string, SourceLimit>,
  options: {
    rowId?: string;
    timestamp?: string;
  } = {},
): Promise<Map<string, AlertTriggerResult>> {
  const results = new Map<string, AlertTriggerResult>();
  const timestamp = options.timestamp || new Date().toISOString();

  for (const [columnName, value] of Object.entries(values)) {
    const limit = limits[columnName];
    if (limit) {
      const context: ColumnAlertTriggerContext = {
        orgId,
        tableId,
        tableName,
        columnName,
        value,
        rowId: options.rowId,
        timestamp,
      };

      const result = await triggerAlertFromColumnLimitViolation(context, limit);
      results.set(columnName, result);
    }
  }

  return results;
}

/**
 * Evaluate a single data point against limits
 */
export async function evaluateAndTriggerAlerts(
  context: AlertTriggerContext,
  options: {
    limit?: SourceLimit;
    limitRecord?: SourceLimitRecord;
  } = {},
): Promise<AlertTriggerResult[]> {
  const results: AlertTriggerResult[] = [];

  if (options.limit) {
    const limitResult = await triggerAlertFromLimitViolation(
      context,
      options.limit,
      options.limitRecord,
    );
    results.push(limitResult);
  }

  return results;
}

/**
 * Batch evaluate multiple metrics for a source
 */
export async function evaluateSourceMetrics(
  orgId: string,
  sourceId: string,
  metrics: Record<string, number>,
  limits: Record<string, SourceLimit>,
  options: {
    timestamp?: string;
    telemetryWindow?: Array<{
      timestamp: string;
      value: number;
      metric: string;
    }>;
  } = {},
): Promise<Map<string, AlertTriggerResult[]>> {
  const results = new Map<string, AlertTriggerResult[]>();
  const timestamp = options.timestamp || new Date().toISOString();

  for (const [metric, value] of Object.entries(metrics)) {
    const context: AlertTriggerContext = {
      orgId,
      sourceId,
      metric,
      value,
      timestamp,
      telemetryWindow: options.telemetryWindow?.filter(
        (t) => t.metric === metric,
      ),
    };

    const metricResults = await evaluateAndTriggerAlerts(context, {
      limit: limits[metric],
    });

    results.set(metric, metricResults);
  }

  return results;
}

/**
 * Helper function to get source and trigger webhook
 */
async function getSourceAndTriggerWebhook(
  orgId: string,
  sourceId: string,
  alert: Alert,
  eventType: "alert.triggered" | "alert.resolved" | "alert.acknowledged",
): Promise<void> {
  let source: Source | null = null;
  try {
    const sources = await sourceQueries.findById(orgId, sourceId);
    source = sources.length > 0 ? sources[0] : null;
  } catch {
    // Source lookup is optional for webhook
  }

  await triggerAlertWebhook(orgId, alert, source, eventType);
}

/**
 * Trigger webhook when an alert is resolved
 */
export async function triggerAlertResolvedWebhook(
  orgId: string,
  alert: Alert,
): Promise<void> {
  if (!alert.source_id) return;

  getSourceAndTriggerWebhook(
    orgId,
    alert.source_id,
    alert,
    "alert.resolved",
  ).catch((err) => console.error("Webhook trigger error:", err));
}

/**
 * Trigger webhook when an alert is acknowledged
 */
export async function triggerAlertAcknowledgedWebhook(
  orgId: string,
  alert: Alert,
): Promise<void> {
  if (!alert.source_id) return;

  getSourceAndTriggerWebhook(
    orgId,
    alert.source_id,
    alert,
    "alert.acknowledged",
  ).catch((err) => console.error("Webhook trigger error:", err));
}
