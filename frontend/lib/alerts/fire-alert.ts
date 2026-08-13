/**
 * Shared alert-firing path for event detection.
 *
 * Used by the poll path (lib/alerts/detect-poll, scanning connection sources
 * and the owned ClickHouse store). The dedup cache is in-process best-effort —
 * bundler module duplication can give each entrypoint its own instance — but
 * the poll path's persisted watermark is the durable duplicate guard.
 */

import "server-only";

import { alertQueries, alertEventQueries } from "@/lib/db";
import type { Alert, Json, Source } from "@/lib/db/types";
import { triggerAlertWebhook } from "@/lib/webhooks/events";

// ---------------------------------------------------------------------------
// In-process dedup (5-minute window, keyed org:source:metric-key)
// ---------------------------------------------------------------------------

const recentAlertCache = new Map<
  string,
  { timestamp: number; alertId: string }
>();

export const ALERT_DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function hasRecentAlert(
  orgId: string,
  sourceId: string,
  metricKey: string,
): boolean {
  const cacheKey = `${orgId}:${sourceId}:${metricKey}`;
  const cached = recentAlertCache.get(cacheKey);
  if (!cached) return false;
  if (Date.now() - cached.timestamp < ALERT_DEDUP_WINDOW_MS) return true;
  recentAlertCache.delete(cacheKey);
  return false;
}

export function markAlertCreated(
  orgId: string,
  sourceId: string,
  metricKey: string,
  alertId: string,
): void {
  const cacheKey = `${orgId}:${sourceId}:${metricKey}`;
  recentAlertCache.set(cacheKey, { timestamp: Date.now(), alertId });
}

// ---------------------------------------------------------------------------
// Event-alert firing (create → alert_event "created" → webhook fan-out)
// ---------------------------------------------------------------------------

export interface FireEventAlertParams {
  orgId: string;
  /** Source UUID — alerts.source_id (not the slug). */
  sourceId: string;
  /** For webhook payload enrichment; null skips enrichment, not delivery. */
  source: Source | null;
  metric: string;
  value: number;
  severity: "info" | "warning" | "critical";
  /** ISO timestamp for alerts.triggered_at. */
  triggeredAt: string;
  /** alert_events "created" message. */
  message: string;
  contextSnapshot?: Record<string, unknown>;
  eventMetadata?: Record<string, unknown>;
  /**
   * Bypass the 5-minute dedup window (per_row delivery — each row is a
   * distinct event, and the poll watermark already guards against re-fires).
   */
  skipDedup?: boolean;
}

/**
 * Fire an event alert, or return null when suppressed by the dedup window.
 * Webhook/notification failure is logged but never fails the alert itself.
 */
export async function fireEventAlert(
  params: FireEventAlertParams,
): Promise<Alert | null> {
  const { orgId, sourceId, metric } = params;
  const dedupKey = `event:${metric}`;
  if (!params.skipDedup && hasRecentAlert(orgId, sourceId, dedupKey))
    return null;

  const alert = await alertQueries.create(orgId, {
    source_id: sourceId,
    trigger_type: "event",
    metric,
    value: params.value,
    threshold: null,
    bound: null,
    severity: params.severity,
    triggered_at: params.triggeredAt,
    // An event is a point in time, not an ongoing condition: the row is born
    // with its condition closed (closed_at = triggered_at, is_alert_active
    // stays false). Without this, chart alert-bands (keyed on closed_at)
    // paint every event alert as a band growing to `now` forever. `status`
    // stays 'open' for the human workflow; the stale-event sweep in
    // lib/alerts/close-out.ts auto-resolves it after EVENT_ALERT_TTL.
    closed_at: params.triggeredAt,
    context_snapshot: (params.contextSnapshot ?? {}) as Json,
  });

  markAlertCreated(orgId, sourceId, dedupKey, alert.id);

  await alertEventQueries.create(orgId, alert.id, "created", {
    message: params.message,
    metadata: params.eventMetadata ?? {},
  });

  try {
    await triggerAlertWebhook(orgId, alert, params.source, "alert.triggered", {
      message: params.message,
    });
  } catch (err) {
    console.error("[fire-alert] Failed to dispatch event alert webhook:", err);
  }

  return alert;
}

// ---------------------------------------------------------------------------
// Limit-violation firing (same shape as the push path in detect/route.ts)
// ---------------------------------------------------------------------------

export interface FireLimitAlertParams {
  orgId: string;
  /** Source UUID — alerts.source_id (not the slug). */
  sourceId: string;
  source: Source | null;
  metric: string;
  /** The violating value. */
  value: number;
  /** The bound that was crossed and its configured value. */
  bound: "min" | "max";
  threshold: number;
  severity: "info" | "warning" | "critical";
  limitId: string;
  triggeredAt: string;
  /** Custom message; falls back to a generic "Limit violation" line. */
  message?: string | null;
  contextSnapshot?: Record<string, unknown>;
  eventMetadata?: Record<string, unknown>;
}

/**
 * Fire a limit-violation alert, or return null when suppressed — by the
 * dedup window (keyed org:source:metric — same key the push path uses), or
 * because an alert for this (limit, source) is already active (unique
 * partial index idx_alerts_one_open_per_limit_source).
 *
 * Unlike event alerts, a limit violation IS an ongoing condition: the row is
 * created active and closed by resolveLimitAlert when the polled values
 * come back in bounds.
 */
export async function fireLimitAlert(
  params: FireLimitAlertParams,
): Promise<Alert | null> {
  const { orgId, sourceId, metric } = params;
  if (hasRecentAlert(orgId, sourceId, metric)) return null;

  let alert: Alert;
  try {
    alert = await alertQueries.create(orgId, {
      source_id: sourceId,
      trigger_type: "limit_violation",
      metric,
      value: params.value,
      threshold: params.threshold,
      bound: params.bound,
      severity: params.severity,
      limit_id: params.limitId,
      triggered_at: params.triggeredAt,
      is_alert_active: true,
      ...(params.contextSnapshot
        ? { context_snapshot: params.contextSnapshot as Json }
        : {}),
    });
  } catch (err: unknown) {
    // 23505 on the partial unique index = an alert for this (limit, source)
    // is already active. Durable dedup (survives restarts, unlike the
    // in-process window above) — skip silently, matching the transitions
    // route's handling of duplicate opens. The pg error may arrive wrapped
    // (DrizzleQueryError keeps the driver error in `cause`).
    const e = err as { code?: string; cause?: { code?: string } };
    if (e.code === "23505" || e.cause?.code === "23505") return null;
    throw err;
  }

  markAlertCreated(orgId, sourceId, metric, alert.id);

  const message =
    params.message ||
    `Limit violation: ${metric} ${params.bound === "min" ? "below minimum" : "above maximum"} (${params.value} vs ${params.threshold})`;

  await alertEventQueries.create(orgId, alert.id, "created", {
    message,
    metadata: params.eventMetadata ?? {},
  });

  try {
    await triggerAlertWebhook(orgId, alert, params.source, "alert.triggered", {
      message,
    });
  } catch (err) {
    console.error("[fire-alert] Failed to dispatch limit alert webhook:", err);
  }

  return alert;
}

// ---------------------------------------------------------------------------
// Limit-violation recovery (condition back in bounds → close + resolve)
// ---------------------------------------------------------------------------

export interface ResolveLimitAlertParams {
  orgId: string;
  /** Source UUID — alerts.source_id (not the slug). */
  sourceId: string;
  source: Source | null;
  limitId: string;
  metric: string;
  /** The in-bounds value that cleared the condition. */
  value: number;
  /** ISO timestamp for closed_at/resolved_at. */
  clearedAt: string;
}

/**
 * Close the active alert for a (limit, source) pair after the polled values
 * came back in bounds. Mirrors the transitions route's `closed` branch:
 * machine fields AND status resolve together (resolved_by stays null — this
 * is a machine close). No-op when nothing is active.
 */
export async function resolveLimitAlert(
  params: ResolveLimitAlertParams,
): Promise<Alert | null> {
  const { orgId, sourceId, limitId, metric } = params;
  const active = await alertQueries.findActiveByLimitAndSource(
    orgId,
    limitId,
    sourceId,
  );
  if (!active) return null;

  const updated = await alertQueries.update(orgId, active.id, {
    is_alert_active: false,
    closed_at: params.clearedAt,
    ...(active.status === "resolved"
      ? {}
      : { status: "resolved", resolved_at: params.clearedAt }),
  });

  const message = `Condition cleared: ${metric} = ${params.value}`;
  await alertEventQueries.create(orgId, active.id, "resolved", {
    message,
    metadata: { limit_id: limitId, value: params.value },
  });

  try {
    await triggerAlertWebhook(
      orgId,
      updated ?? active,
      params.source,
      "alert.resolved",
      { message },
    );
  } catch (err) {
    console.error(
      "[fire-alert] Failed to dispatch limit recovery webhook:",
      err,
    );
  }

  return updated ?? active;
}
