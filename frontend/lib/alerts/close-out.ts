/**
 * Alert close-out sweeps — the janitor that keeps `alerts` rows from
 * stranding in an open state forever. Runs as part of the poll loop tick
 * (lib/scheduler/poll-loop.ts).
 *
 * Two sweeps:
 *
 * 1. Stale event alerts. An event ("new row") alert is a point in time —
 *    there is no condition that can clear, so nothing machine-side ever
 *    resolves it. After EVENT_ALERT_TTL it auto-resolves: the human had a
 *    day to look; keeping it in the Open tab past that is noise.
 *
 * 2. Orphaned active alerts. alerts.rule_id / alerts.limit_id are ON DELETE
 *    SET NULL, so deleting a monitor strands its active alert with no owner
 *    — no engine will ever close it (houston's synthetic close on rule
 *    deletion only fires while houston is up and holding the instance).
 *    Disabled rules strand the same way: detect-offline and the
 *    alert-service only evaluate enabled rules. Any active alert with no
 *    live enabled owner closes here.
 *
 * Neither sweep dispatches webhooks/notifications — these are hygiene
 * closes, not condition recoveries; the interesting notification (triggered)
 * already went out. Timeline events are still written so the story panel
 * shows why the alert closed.
 */

import "server-only";

import {
  and,
  eq,
  isNotNull,
  isNull,
  lt,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db/client";
import { alerts, alertEvents, alertRules } from "@/lib/db/schema";

export const EVENT_ALERT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CloseOutStats {
  staleEvents: number;
  orphaned: number;
}

/** Both sweeps; never throws (poll tick must survive a failed sweep). */
export async function closeOutSweep(): Promise<CloseOutStats> {
  const stats: CloseOutStats = { staleEvents: 0, orphaned: 0 };
  try {
    stats.staleEvents = await resolveStaleEventAlerts();
  } catch (err) {
    console.error("[close-out] stale event sweep failed:", err);
  }
  try {
    stats.orphaned = await closeOrphanedAlerts();
  } catch (err) {
    console.error("[close-out] orphan sweep failed:", err);
  }
  return stats;
}

/** Auto-resolve event alerts older than EVENT_ALERT_TTL. */
export async function resolveStaleEventAlerts(): Promise<number> {
  const cutoff = new Date(Date.now() - EVENT_ALERT_TTL_MS).toISOString();
  const nowIso = new Date().toISOString();

  const rows = await db
    .update(alerts)
    .set({
      status: "resolved",
      resolved_at: nowIso,
      // Legacy rows predating closed_at-at-creation: stamp the honest point
      // (the event's own time), and clear the never-used active flag.
      closed_at: sql`COALESCE(closed_at, triggered_at)`,
      is_alert_active: false,
    })
    .where(
      and(
        eq(alerts.trigger_type, "event"),
        ne(alerts.status, "resolved"),
        lt(alerts.triggered_at, cutoff),
      ),
    )
    .returning({ id: alerts.id, org_id: alerts.org_id });

  await recordCloseEvents(
    rows,
    "Auto-resolved: event alert older than 24 hours",
  );
  return rows.length;
}

/** Close active alerts whose owning rule/limit was deleted or disabled. */
export async function closeOrphanedAlerts(): Promise<number> {
  const ownerEnabled = db
    .select({ one: sql`1` })
    .from(alertRules)
    .where(
      and(eq(alertRules.id, alerts.rule_id), eq(alertRules.enabled, true)),
    );

  const rows = await db
    .update(alerts)
    .set({
      is_alert_active: false,
      closed_at: sql`COALESCE(closed_at, now())`,
      status: "resolved",
      resolved_at: sql`COALESCE(resolved_at, now())`,
    })
    .where(
      and(
        eq(alerts.is_alert_active, true),
        or(
          // Owner deleted: both FKs are ON DELETE SET NULL. (Event alerts
          // are never active, so active + ownerless = orphan, always.)
          and(isNull(alerts.rule_id), isNull(alerts.limit_id)),
          // Owner disabled: nothing evaluates a disabled rule.
          and(isNotNull(alerts.rule_id), notExists(ownerEnabled)),
        ),
      ),
    )
    .returning({ id: alerts.id, org_id: alerts.org_id });

  await recordCloseEvents(
    rows,
    "Monitor deleted or disabled — alert closed",
  );
  return rows.length;
}

async function recordCloseEvents(
  rows: { id: string; org_id: string }[],
  message: string,
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(alertEvents).values(
    rows.map((r) => ({
      org_id: r.org_id,
      alert_id: r.id,
      event_type: "resolved" as const,
      message,
      metadata: {},
    })) as (typeof alertEvents.$inferInsert)[],
  );
}
