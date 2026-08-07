/**
 * POST /api/internal/detect — Alert processing for batched telemetry
 *
 * Manual/demo-only: the gateway detection consumer this was designed for was
 * never built (see lib/alerts/detect-poll.ts), so no production service calls
 * this route today — the only caller is the demo script scripts/demo-fleet.
 * Runs limit checks and event monitors.
 *
 * The wire `point.source_id` is the source SLUG (the telemetry envelope
 * convention), while `source_limits`/`event_monitors`/`alerts` key on the
 * source UUID — so every batch resolves each distinct ref once via
 * adminSourceQueries.resolveRef (accepts slug or uuid; no gateway coordination
 * needed) and uses the resolved row's id downstream.
 *
 * Auth: x-internal-secret header (shared secret with gateway).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  sourceLimitQueries,
  alertQueries,
  alertEventQueries,
  eventMonitorQueries,
  runWithServiceRole,
} from "@/lib/db";
import { adminSourceQueries } from "@/lib/db/server";
import type {
  EventMonitorRecord,
  SourceLimitRecord,
  Source,
} from "@/lib/db/types";
import { triggerAlertWebhook } from "@/lib/webhooks/events";
import { evaluateLimit } from "@/lib/limits";
import { MINUTE_MS } from "@/lib/constants/time";
import {
  fireEventAlert,
  hasRecentAlert,
  markAlertCreated,
} from "@/lib/alerts/fire-alert";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const INTERNAL_SECRET = process.env.PLEXUS_INTERNAL_SECRET;

function verifyInternalAuth(request: NextRequest): boolean {
  if (!INTERNAL_SECRET) return false;
  return request.headers.get("x-internal-secret") === INTERNAL_SECRET;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DataPoint {
  metric: string;
  value: number | string | boolean | Record<string, unknown> | unknown[];
  timestamp: number;
  source_id: string;
  tags?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Process-level caches (same TTLs as the old ingest route)
// ---------------------------------------------------------------------------

const limitCache = new Map<
  string,
  { limits: SourceLimitRecord[]; timestamp: number }
>();
const LIMIT_CACHE_TTL = MINUTE_MS; // 1 minute

const eventMonitorCache = new Map<
  string,
  { configs: EventMonitorRecord[]; timestamp: number }
>();
const EVENT_MONITOR_CACHE_TTL = 120_000; // 2 minutes

// Alert dedup (5-min window) lives in lib/alerts/fire-alert.ts. The cache is
// in-process best-effort (bundler module duplication can give each entrypoint
// its own instance); the durable duplicate guard is the poll path's persisted
// watermark plus the two paths' largely-disjoint coverage.

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

async function getSourceLimits(
  orgId: string,
  sourceId: string,
): Promise<SourceLimitRecord[]> {
  const cacheKey = `${orgId}:${sourceId}`;
  const cached = limitCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < LIMIT_CACHE_TTL) {
    return cached.limits;
  }
  try {
    const limits = await sourceLimitQueries.findBySource(orgId, sourceId);
    limitCache.set(cacheKey, { limits, timestamp: Date.now() });
    return limits;
  } catch (err) {
    // Never swallow silently — a type/shape mismatch here once disabled
    // push-path detection with no signal at all.
    console.error("[Detect] source_limits lookup failed:", err);
    return [];
  }
}

async function getEventMonitors(
  orgId: string,
  sourceId: string,
): Promise<EventMonitorRecord[]> {
  const cacheKey = `${orgId}:${sourceId}`;
  const cached = eventMonitorCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EVENT_MONITOR_CACHE_TTL) {
    return cached.configs;
  }
  try {
    const configs = await eventMonitorQueries.findEnabledBySource(
      orgId,
      sourceId,
    );
    eventMonitorCache.set(cacheKey, { configs, timestamp: Date.now() });
    return configs;
  } catch (err) {
    console.error("[Detect] event_monitors lookup failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main detection logic
// ---------------------------------------------------------------------------

async function checkLimitsAndTriggerAlerts(
  orgId: string,
  points: DataPoint[],
): Promise<{ alertsCreated: number; alertsFailed: number }> {
  let alertsCreated = 0;
  let alertsFailed = 0;

  // Group points by their wire ref (slug per the envelope convention, but
  // resolveRef also accepts a uuid).
  const pointsBySource = new Map<string, DataPoint[]>();
  for (const point of points) {
    const existing = pointsBySource.get(point.source_id) || [];
    existing.push(point);
    pointsBySource.set(point.source_id, existing);
  }

  // Resolve each distinct ref once per batch.
  const resolvedByRef = new Map<string, Source | null>();
  for (const ref of pointsBySource.keys()) {
    try {
      resolvedByRef.set(ref, await adminSourceQueries.resolveRef(orgId, ref));
    } catch (err) {
      console.error("[Detect] source resolution failed:", ref, err);
      resolvedByRef.set(ref, null);
    }
  }

  for (const [ref, sourcePoints] of pointsBySource) {
    const source = resolvedByRef.get(ref) ?? null;
    if (!source) {
      // Unknown source (e.g. first points racing auto-registration) — skip
      // this group rather than throwing away the whole batch.
      console.warn("[Detect] skipping unresolvable source ref:", ref);
      continue;
    }
    const sourceId = source.id;
    // =================================================================
    // LIMIT VIOLATIONS
    // =================================================================

    const limits = await getSourceLimits(orgId, sourceId);
    if (limits.length > 0) {
      const limitsByMetric = new Map<string, SourceLimitRecord>();
      for (const limit of limits) {
        limitsByMetric.set(limit.metric, limit);
      }

      for (const point of sourcePoints) {
        if (typeof point.value !== "number") continue;

        const limit = limitsByMetric.get(point.metric);
        if (!limit) continue;

        const evaluation = evaluateLimit(point.value, {
          min: limit.min ?? undefined,
          max: limit.max ?? undefined,
          severity: limit.severity,
        });

        if (evaluation.isViolation) {
          if (hasRecentAlert(orgId, sourceId, point.metric)) continue;

          try {
            const alert = await alertQueries.create(orgId, {
              source_id: sourceId,
              trigger_type: "limit_violation",
              metric: point.metric,
              value: point.value,
              threshold:
                evaluation.violatedBound === "min" ? limit.min! : limit.max!,
              bound: evaluation.violatedBound,
              severity: limit.severity,
              limit_id: limit.id,
              triggered_at: new Date(point.timestamp).toISOString(),
            });

            markAlertCreated(orgId, sourceId, point.metric, alert.id);
            alertsCreated++;

            await alertEventQueries.create(orgId, alert.id, "created", {
              message: `Limit violation: ${point.metric} ${evaluation.violatedBound === "min" ? "below minimum" : "above maximum"} (${point.value} vs ${evaluation.violatedBound === "min" ? limit.min : limit.max})`,
              metadata: {
                value: point.value,
                limit: {
                  min: limit.min,
                  max: limit.max,
                  severity: limit.severity,
                },
              },
            });


            try {
              await triggerAlertWebhook(orgId, alert, source, "alert.triggered");
            } catch (err) {
              console.error("[Detect] Failed to dispatch alert webhook:", err);
            }
          } catch (alertErr) {
            alertsFailed++;
            console.error(
              JSON.stringify({
                event: "alert_create_failed",
                org: orgId,
                source: sourceId,
                metric: point.metric,
                error:
                  alertErr instanceof Error
                    ? alertErr.message
                    : String(alertErr),
              }),
            );
          }
        }
      }
    }

    // =================================================================
    // EVENT MONITORS
    // =================================================================

    const eventMonitors = await getEventMonitors(orgId, sourceId);
    if (eventMonitors.length > 0) {
      const monitorsByMetric = new Map<string, EventMonitorRecord>();
      for (const em of eventMonitors) {
        monitorsByMetric.set(em.metric, em);
      }

      for (const point of sourcePoints) {
        if (typeof point.value !== "number") continue;

        const monitor = monitorsByMetric.get(point.metric);
        if (!monitor) continue;

        // fireEventAlert dedups internally too; checking here first skips the
        // source lookup for suppressed points (the common case in a batch).
        if (hasRecentAlert(orgId, sourceId, `event:${point.metric}`)) continue;

        try {
          const alert = await fireEventAlert({
            orgId,
            sourceId,
            source,
            metric: point.metric,
            value: point.value,
            severity: monitor.severity,
            triggeredAt: new Date(point.timestamp).toISOString(),
            message:
              monitor.message || `New event: ${point.metric} = ${point.value}`,
            contextSnapshot: {
              ...(point.tags || {}),
              ...(monitor.visualization
                ? {
                    _visualization: JSON.parse(
                      JSON.stringify(monitor.visualization),
                    ),
                  }
                : {}),
            },
            eventMetadata: {
              value: point.value,
              monitor_id: monitor.id,
            },
          });

          if (alert) alertsCreated++;
        } catch (alertErr) {
          alertsFailed++;
          console.error(
            JSON.stringify({
              event: "event_monitor_alert_create_failed",
              org: orgId,
              source: sourceId,
              metric: point.metric,
              error:
                alertErr instanceof Error ? alertErr.message : String(alertErr),
            }),
          );
        }
      }
    }
  }

  if (alertsCreated > 0 || alertsFailed > 0) {
    console.log(
      JSON.stringify({
        event: "alert_check",
        org: orgId,
        created: alertsCreated,
        failed: alertsFailed,
      }),
    );
  }

  return { alertsCreated, alertsFailed };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (!verifyInternalAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { org_id, points } = body as {
      org_id?: string;
      points?: DataPoint[];
    };

    if (!org_id || !points || !Array.isArray(points)) {
      return NextResponse.json(
        { error: "org_id and points[] are required" },
        { status: 400 },
      );
    }

    // No user session here (server-to-server) — without the service-role
    // context every RLS-protected read returns zero rows and detection
    // silently no-ops.
    const result = await runWithServiceRole(() =>
      checkLimitsAndTriggerAlerts(org_id, points),
    );

    return NextResponse.json({
      success: true,
      alertsCreated: result.alertsCreated,
      alertsFailed: result.alertsFailed,
    });
  } catch (error) {
    console.error("[internal/detect] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
