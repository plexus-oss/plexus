/**
 * POST /api/internal/alerts/transitions
 *
 * Receives alert state transitions from the alert-service. Each transition
 * represents an alert opening or closing based on rule evaluation against
 * the telemetry stream.
 *
 * Auth: server-to-server only via x-internal-secret header.
 *
 * The alert-service client timeout is 5 seconds — respond fast. Do the
 * minimum synchronously (auth + persist) and push webhooks/notifications
 * onto a fire-and-forget path.
 *
 * Deduplication: the unique partial index on alerts(org_id, rule_id, source_id)
 * WHERE is_alert_active = TRUE AND rule_id IS NOT NULL (per migration 00038)
 * handles open dedup at the DB level. Close transitions with no matching active
 * row are no-ops.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  adminAlertQueries,
  adminAlertEventQueries,
  adminSourceQueries,
} from "@/lib/db/server";
import { runWithServiceRole } from "@/lib/db";
import type {
  TransitionWire,
  LimitSeverity,
  Json,
  Source,
} from "@/lib/db/types";
import { triggerAlertWebhook } from "@/lib/webhooks/events";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function verifyInternalAuth(request: NextRequest): boolean {
  const expected = process.env.PLEXUS_INTERNAL_SECRET;
  if (!expected) return false;
  return request.headers.get("x-internal-secret") === expected;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set<string>(["critical", "warning", "info"]);

function normalizeSeverity(s: string): LimitSeverity {
  return VALID_SEVERITIES.has(s) ? (s as LimitSeverity) : "warning";
}

// Source slug → row cache (process-level, avoids repeated lookups within a
// batch). The full row is kept so notifications can carry the source name.
const slugToSourceCache = new Map<
  string,
  { source: Source; timestamp: number }
>();
const SLUG_CACHE_TTL = 60_000; // 1 minute

async function resolveSourceBySlug(
  orgId: string,
  slug: string,
): Promise<Source | null> {
  const cacheKey = `${orgId}:${slug}`;
  const cached = slugToSourceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SLUG_CACHE_TTL) {
    return cached.source;
  }
  const sources = await adminSourceQueries.findBySlug(orgId, slug);
  if (!sources || sources.length === 0) return null;
  const source = sources[0];
  slugToSourceCache.set(cacheKey, { source, timestamp: Date.now() });
  return source;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (!verifyInternalAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { transitions?: TransitionWire[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { transitions } = body;
  if (!transitions || !Array.isArray(transitions)) {
    return NextResponse.json(
      { error: "transitions[] is required" },
      { status: 400 },
    );
  }

  let processed = 0;
  let skipped = 0;

  for (const t of transitions) {
    try {
      // Resolve source slug → row
      const source = await resolveSourceBySlug(t.org_id, t.source_id);
      const sourceUuid = source?.id;
      if (!sourceUuid) {
        console.warn(
          `[transitions] unknown source slug ${t.source_id} for org ${t.org_id} — skipping`,
        );
        skipped++;
        continue;
      }

      const timestampIso = new Date(t.timestamp * 1000).toISOString();
      const severity = normalizeSeverity(t.severity);

      if (t.state === "open") {
        // -----------------------------------------------------------------
        // OPEN — insert new alert row
        // -----------------------------------------------------------------
        const contextSnapshot: Record<string, Json> = {};
        if (t.distribution)
          contextSnapshot.distribution = { ...t.distribution };
        if (t.z_score != null) contextSnapshot.z_score = t.z_score;
        if (t.threshold != null) contextSnapshot.threshold = t.threshold;

        try {
          const alert = await adminAlertQueries.create(t.org_id, {
            source_id: sourceUuid,
            rule_id: t.rule_id,
            trigger_type: "alert_rule",
            metric: t.metric,
            value: t.value,
            threshold: t.threshold ?? null,
            severity,
            status: "open",
            is_alert_active: true,
            triggered_at: timestampIso,
            context_snapshot: contextSnapshot,
          });

          // Record timeline event
          await adminAlertEventQueries.create(t.org_id, alert.id, "triggered", {
            message: `Alert opened: ${t.metric} = ${t.value}${t.threshold != null ? ` (threshold: ${t.threshold})` : ""}`,
            metadata: {
              rule_id: t.rule_id,
              value: t.value,
              ...(t.distribution ? { distribution: t.distribution } : {}),
            },
          });

          // No user session here — dispatch must run with the service-role
          // client or integration lookups return zero rows. Awaited so the
          // delivery records are persisted before we respond; the actual
          // network sends are async with the drain loop as a safety net.
          try {
            await runWithServiceRole(() =>
              triggerAlertWebhook(t.org_id, alert, source, "alert.triggered"),
            );
          } catch (err) {
            console.error("[transitions] webhook dispatch failed:", err);
          }

          processed++;
        } catch (err: unknown) {
          // Unique constraint violation = duplicate open — skip silently
          const pgErr = err as { code?: string };
          if (pgErr.code === "23505") {
            skipped++;
            continue;
          }
          throw err;
        }
      } else if (t.state === "closed") {
        // -----------------------------------------------------------------
        // CLOSED — find and resolve matching open alert
        // -----------------------------------------------------------------
        const openAlert = await adminAlertQueries.findOpenByRuleAndSource(
          t.org_id,
          t.rule_id,
          sourceUuid,
        );

        if (!openAlert) {
          // No matching open row — no-op per CONTRACT.md
          skipped++;
          continue;
        }

        // Mark condition cleared. Do NOT touch status — resolved/acknowledged
        // are user workflow actions, not alert-service concerns.
        await adminAlertQueries.update(t.org_id, openAlert.id, {
          is_alert_active: false,
          closed_at: timestampIso,
          ...(t.stats ? { alert_stats: t.stats } : {}),
        });

        // Record timeline event
        await adminAlertEventQueries.create(
          t.org_id,
          openAlert.id,
          "triggered",
          {
            message: `Condition cleared: ${t.metric} = ${t.value}`,
            metadata: {
              rule_id: t.rule_id,
              value: t.value,
              ...(t.distribution ? { distribution: t.distribution } : {}),
            },
          },
        );

        processed++;
      } else {
        console.warn(`[transitions] unknown state ${t.state} — skipping`);
        skipped++;
      }
    } catch (err) {
      console.error(
        `[transitions] failed to process transition for rule ${t.rule_id}:`,
        err,
      );
      skipped++;
    }
  }

  if (processed > 0 || skipped > 0) {
    console.log(
      JSON.stringify({
        event: "transitions_processed",
        processed,
        skipped,
        total: transitions.length,
      }),
    );
  }

  return new NextResponse(null, { status: 204 });
}
