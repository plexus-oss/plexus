/**
 * Alert close-out behavior tests:
 *
 * - lib/alerts/close-out.ts sweeps (stale event auto-resolve, orphan close)
 * - lib/alerts/fire-alert.ts limit lifecycle (created active, durable dedup
 *   via the unique partial index, recovery close) and event alerts being
 *   born point-in-time (closed_at = triggered_at).
 *
 * Webhook fan-out is mocked at the events boundary — delivery is not under
 * test here (alert-transitions.test.ts covers that pipeline).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { alertEvents, alertRules, alerts, sourceLimits, sources } from "../schema";

vi.mock("@/lib/webhooks/events", () => ({
  triggerAlertWebhook: vi.fn().mockResolvedValue(undefined),
  triggerDeviceStatusWebhook: vi.fn().mockResolvedValue(undefined),
}));

import {
  fireEventAlert,
  fireLimitAlert,
  resolveLimitAlert,
} from "@/lib/alerts/fire-alert";
import {
  resolveStaleEventAlerts,
  closeOrphanedAlerts,
} from "@/lib/alerts/close-out";

const ORG = "test-org";

let testId = 0;
function uniqueSlug(): string {
  return `dev-${++testId}-${randomUUID().slice(0, 8)}`;
}

async function insertSource(slug: string): Promise<string> {
  const [row] = await db
    .insert(sources)
    .values({
      org_id: ORG,
      slug,
      name: slug,
      source_type: "device",
      status: "online",
    } as typeof sources.$inferInsert)
    .returning();
  return row.id;
}

async function insertLimit(sourceId: string): Promise<string> {
  const [row] = await db
    .insert(sourceLimits)
    .values({
      org_id: ORG,
      source_id: sourceId,
      metric: "temp",
      max: 100,
    } as typeof sourceLimits.$inferInsert)
    .returning();
  return row.id;
}

async function getAlert(id: string) {
  const rows = await db.select().from(alerts).where(eq(alerts.id, id)).limit(1);
  return rows[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fireEventAlert", () => {
  it("creates a point-in-time row: closed_at = triggered_at, never active", async () => {
    const sourceId = await insertSource(uniqueSlug());
    const triggeredAt = new Date().toISOString();

    const alert = await fireEventAlert({
      orgId: ORG,
      sourceId,
      source: null,
      metric: "signups",
      value: 3,
      severity: "info",
      triggeredAt,
      message: "New signups",
    });

    expect(alert).not.toBeNull();
    const row = await getAlert(alert!.id);
    expect(row.is_alert_active).toBe(false);
    expect(row.closed_at).not.toBeNull();
    expect(new Date(row.closed_at!).getTime()).toBe(
      new Date(row.triggered_at!).getTime(),
    );
    expect(row.status).toBe("open"); // human workflow untouched until TTL
  });
});

describe("fireLimitAlert / resolveLimitAlert", () => {
  it("creates active, dedups on the unique index, and closes on recovery", async () => {
    const sourceId = await insertSource(uniqueSlug());
    const limitId = await insertLimit(sourceId);
    const nowIso = new Date().toISOString();

    const fired = await fireLimitAlert({
      orgId: ORG,
      sourceId,
      source: null,
      metric: "temp",
      value: 120,
      bound: "max",
      threshold: 100,
      severity: "warning",
      limitId,
      triggeredAt: nowIso,
    });
    expect(fired).not.toBeNull();
    expect((await getAlert(fired!.id)).is_alert_active).toBe(true);

    // Durable dedup: an active row for this (limit, source) already exists.
    // Different metric key sidesteps the in-process 5-minute window, so the
    // suppression proven here is the DB index, not the cache.
    const dup = await fireLimitAlert({
      orgId: ORG,
      sourceId,
      source: null,
      metric: "temp-again",
      value: 130,
      bound: "max",
      threshold: 100,
      severity: "warning",
      limitId,
      triggeredAt: nowIso,
    });
    expect(dup).toBeNull();

    // Recovery closes it out fully.
    const resolved = await resolveLimitAlert({
      orgId: ORG,
      sourceId,
      source: null,
      limitId,
      metric: "temp",
      value: 80,
      clearedAt: new Date().toISOString(),
    });
    expect(resolved).not.toBeNull();
    const row = await getAlert(fired!.id);
    expect(row.is_alert_active).toBe(false);
    expect(row.closed_at).not.toBeNull();
    expect(row.status).toBe("resolved");
    expect(row.resolved_by).toBeNull();

    const events = await db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.alert_id, fired!.id));
    expect(events.map((e) => e.event_type).sort()).toEqual([
      "created",
      "resolved",
    ]);

    // Nothing active anymore → recovery is a no-op.
    const again = await resolveLimitAlert({
      orgId: ORG,
      sourceId,
      source: null,
      limitId,
      metric: "temp",
      value: 80,
      clearedAt: new Date().toISOString(),
    });
    expect(again).toBeNull();
  });
});

describe("resolveStaleEventAlerts", () => {
  it("resolves event alerts past the TTL, leaves fresh ones", async () => {
    const sourceId = await insertSource(uniqueSlug());
    const stale = new Date(Date.now() - 25 * 3600_000).toISOString();
    const fresh = new Date().toISOString();

    const [staleRow] = await db
      .insert(alerts)
      .values({
        org_id: ORG,
        source_id: sourceId,
        trigger_type: "event",
        metric: "signups",
        value: 1,
        severity: "info",
        status: "acknowledged",
        triggered_at: stale,
      } as typeof alerts.$inferInsert)
      .returning();
    const [freshRow] = await db
      .insert(alerts)
      .values({
        org_id: ORG,
        source_id: sourceId,
        trigger_type: "event",
        metric: "signups",
        value: 1,
        severity: "info",
        status: "open",
        triggered_at: fresh,
      } as typeof alerts.$inferInsert)
      .returning();

    const n = await resolveStaleEventAlerts();
    expect(n).toBeGreaterThanOrEqual(1);

    const closedStale = await getAlert(staleRow.id);
    expect(closedStale.status).toBe("resolved");
    // Legacy row without closed_at gets the honest point: the event's time.
    expect(new Date(closedStale.closed_at!).getTime()).toBe(
      new Date(closedStale.triggered_at!).getTime(),
    );

    const stillOpen = await getAlert(freshRow.id);
    expect(stillOpen.status).toBe("open");

    const events = await db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.alert_id, staleRow.id));
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("resolved");
  });
});

describe("closeOrphanedAlerts", () => {
  it("closes ownerless and disabled-rule alerts, leaves live ones", async () => {
    const slug = uniqueSlug();
    const sourceId = await insertSource(slug);

    async function insertRule(enabled: boolean): Promise<string> {
      const [row] = await db
        .insert(alertRules)
        .values({
          org_id: ORG,
          source_id: slug,
          type: "threshold",
          metric: "cpu_temp",
          conditions: {},
          severity: "warning",
          enabled,
        } as typeof alertRules.$inferInsert)
        .returning();
      return row.id;
    }
    async function insertActive(ruleId: string | null): Promise<string> {
      const [row] = await db
        .insert(alerts)
        .values({
          org_id: ORG,
          source_id: sourceId,
          rule_id: ruleId,
          trigger_type: "alert_rule",
          metric: "cpu_temp",
          value: 95,
          severity: "warning",
          status: "open",
          is_alert_active: true,
        } as typeof alerts.$inferInsert)
        .returning();
      return row.id;
    }

    const liveRule = await insertRule(true);
    const deadRule = await insertRule(false);
    const liveAlert = await insertActive(liveRule);
    const disabledAlert = await insertActive(deadRule);
    // Rule deleted → FK sets rule_id NULL, alert stays active. Simulated
    // directly (deleting deadRule would also exercise it, but this pins the
    // ownerless shape independent of FK behavior).
    const orphanAlert = await insertActive(null);

    const n = await closeOrphanedAlerts();
    expect(n).toBeGreaterThanOrEqual(2);

    const live = await getAlert(liveAlert);
    expect(live.is_alert_active).toBe(true);
    expect(live.status).toBe("open");

    for (const id of [disabledAlert, orphanAlert]) {
      const row = await getAlert(id);
      expect(row.is_alert_active).toBe(false);
      expect(row.status).toBe("resolved");
      expect(row.closed_at).not.toBeNull();
    }
  });
});
