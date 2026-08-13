/**
 * /api/internal/alerts/transitions — behavior tests.
 *
 * Exercises the real route handler against the test DB, with only the
 * outermost delivery effects mocked (generic-webhook scheduling, Slack/email
 * notification dispatch, system-event emission). The shared fan-out in
 * lib/webhooks/events runs for real, so these tests prove the route feeds
 * the same pipeline the manual-resolve and offline-recovery paths use.
 *
 * Key behavior under test: auto-clear ("closed" transition) closes the
 * alert out fully — machine fields AND status='resolved' (resolved_by stays
 * null = machine close; an earlier human resolve is never overwritten) —
 * and emits `alert.resolved` + notifications.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "../client";
import { alertEvents, alertRules, alerts, sources } from "../schema";

vi.mock("@/lib/webhooks/dispatcher", () => ({
  scheduleWebhookDelivery: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/notifications/deliver", () => ({
  dispatchNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/events/emit", () => ({
  emitSystemEvent: vi.fn(),
}));

import { scheduleWebhookDelivery } from "@/lib/webhooks/dispatcher";
import { dispatchNotifications } from "@/lib/notifications/deliver";
import { emitSystemEvent } from "@/lib/events/emit";
import { POST } from "@/app/api/internal/alerts/transitions/route";

const SECRET = "test-internal-secret";
process.env.PLEXUS_INTERNAL_SECRET = SECRET;

const ORG = "test-org";

function postTransitions(
  transitions: unknown[],
  secret: string = SECRET,
): Promise<Response> {
  const request = new NextRequest(
    "http://localhost/api/internal/alerts/transitions",
    {
      method: "POST",
      headers: { "x-internal-secret": secret },
      body: JSON.stringify({ transitions }),
    },
  );
  return POST(request);
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

/** alerts.rule_id is a real FK; alert_rules.source_id keys by SLUG. */
async function insertRule(slug: string): Promise<string> {
  const [row] = await db
    .insert(alertRules)
    .values({
      org_id: ORG,
      source_id: slug,
      type: "threshold",
      metric: "cpu_temp",
      conditions: {},
      severity: "warning",
      enabled: true,
    } as typeof alertRules.$inferInsert)
    .returning();
  return row.id;
}

async function insertActiveRuleAlert(
  sourceUuid: string,
  ruleId: string,
): Promise<string> {
  const [row] = await db
    .insert(alerts)
    .values({
      org_id: ORG,
      source_id: sourceUuid,
      rule_id: ruleId,
      trigger_type: "alert_rule",
      metric: "cpu_temp",
      value: 95,
      threshold: 90,
      severity: "warning",
      status: "open",
      is_alert_active: true,
    } as typeof alerts.$inferInsert)
    .returning();
  return row.id;
}

async function getAlert(id: string) {
  const rows = await db.select().from(alerts).where(eq(alerts.id, id)).limit(1);
  return rows[0];
}

// NOTE: the route caches slug→source for 60s at module level, so every test
// uses a unique slug to stay clear of rows truncated between tests.
let testId = 0;
function uniqueSlug(): string {
  return `dev-${++testId}-${randomUUID().slice(0, 8)}`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/internal/alerts/transitions — auth", () => {
  it("rejects a bad internal secret", async () => {
    const res = await postTransitions([], "wrong-secret");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/internal/alerts/transitions — open", () => {
  it("creates the alert and emits alert.triggered", async () => {
    const slug = uniqueSlug();
    await insertSource(slug);
    const ruleId = await insertRule(slug);

    const res = await postTransitions([
      {
        rule_id: ruleId,
        org_id: ORG,
        source_id: slug,
        metric: "cpu_temp",
        state: "open",
        value: 95,
        threshold: 90,
        severity: "warning",
        timestamp: Math.floor(Date.now() / 1000),
      },
    ]);
    expect(res.status).toBe(204);

    const rows = await db
      .select()
      .from(alerts)
      .where(eq(alerts.rule_id, ruleId));
    expect(rows).toHaveLength(1);
    expect(rows[0].is_alert_active).toBe(true);
    expect(rows[0].status).toBe("open");

    expect(scheduleWebhookDelivery).toHaveBeenCalledWith(
      ORG,
      "alert.triggered",
      expect.anything(),
      expect.anything(),
      null,
    );
    expect(dispatchNotifications).toHaveBeenCalledWith(
      ORG,
      "alert.triggered",
      expect.objectContaining({ alertId: rows[0].id }),
      null,
    );
  });
});

describe("POST /api/internal/alerts/transitions — auto-clear (closed)", () => {
  it("closes out fully (machine fields + status) and emits alert.resolved + notifications", async () => {
    const slug = uniqueSlug();
    const sourceUuid = await insertSource(slug);
    const ruleId = await insertRule(slug);
    const alertId = await insertActiveRuleAlert(sourceUuid, ruleId);

    const closedAt = Math.floor(Date.now() / 1000);
    const res = await postTransitions([
      {
        rule_id: ruleId,
        org_id: ORG,
        source_id: slug,
        metric: "cpu_temp",
        state: "closed",
        value: 70,
        threshold: 90,
        severity: "warning",
        timestamp: closedAt,
      },
    ]);
    expect(res.status).toBe(204);

    // Condition cleared AND the alert leaves the Open tab: a cleared
    // condition is a resolved alert. resolved_by null = machine close.
    const row = await getAlert(alertId);
    expect(row.is_alert_active).toBe(false);
    expect(row.closed_at).not.toBeNull();
    expect(row.status).toBe("resolved");
    expect(row.resolved_at).not.toBeNull();
    expect(row.resolved_by).toBeNull();

    // Resolved event + notifications go through the shared pipeline.
    expect(scheduleWebhookDelivery).toHaveBeenCalledWith(
      ORG,
      "alert.resolved",
      expect.anything(),
      sourceUuid,
      null,
    );
    expect(dispatchNotifications).toHaveBeenCalledWith(
      ORG,
      "alert.resolved",
      expect.objectContaining({ alertId }),
      null,
    );
    expect(emitSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG,
        eventType: "alert.resolved",
        entityId: alertId,
      }),
    );
  });

  it("allows a re-open after auto-clear (unique index gates on is_alert_active, not status)", async () => {
    // Regression for `alerts-open-index-drizzle-vs-supabase`: prod (supabase
    // 00038) gates idx_alerts_one_open_per_rule_source on is_alert_active,
    // while the drizzle chain gated on status='open' — so this second open
    // would 23505 in the test DB even though prod inserts cleanly (the first
    // row keeps status='open' after auto-clear).
    const slug = uniqueSlug();
    await insertSource(slug);
    const ruleId = await insertRule(slug);

    const transition = {
      rule_id: ruleId,
      org_id: ORG,
      source_id: slug,
      metric: "cpu_temp",
      threshold: 90,
      severity: "warning",
    };

    const openRes = await postTransitions([
      {
        ...transition,
        state: "open",
        value: 95,
        timestamp: Math.floor(Date.now() / 1000),
      },
    ]);
    expect(openRes.status).toBe(204);

    const closeRes = await postTransitions([
      {
        ...transition,
        state: "closed",
        value: 70,
        timestamp: Math.floor(Date.now() / 1000),
      },
    ]);
    expect(closeRes.status).toBe(204);

    const reopenRes = await postTransitions([
      {
        ...transition,
        state: "open",
        value: 96,
        timestamp: Math.floor(Date.now() / 1000),
      },
    ]);
    expect(reopenRes.status).toBe(204);

    const rows = await db
      .select()
      .from(alerts)
      .where(eq(alerts.rule_id, ruleId));
    expect(rows).toHaveLength(2);
    // Old row: closed out (resolved). New row: firing again.
    expect(rows.filter((r) => r.is_alert_active).length).toBe(1);
    expect(rows.filter((r) => r.status === "resolved").length).toBe(1);
    expect(rows.filter((r) => r.status === "open").length).toBe(1);
  });

  it("never overwrites a human resolve", async () => {
    const slug = uniqueSlug();
    const sourceUuid = await insertSource(slug);
    const ruleId = await insertRule(slug);
    const alertId = await insertActiveRuleAlert(sourceUuid, ruleId);
    // Human resolved it while the condition was still firing (legacy rows
    // from before manual-resolve cleared is_alert_active look like this too).
    await db
      .update(alerts)
      .set({
        status: "resolved",
        resolved_at: new Date("2026-01-01T00:00:00Z").toISOString(),
        resolved_by: "user-42",
        resolution_notes: "power cycled the board",
      })
      .where(eq(alerts.id, alertId));

    const res = await postTransitions([
      {
        rule_id: ruleId,
        org_id: ORG,
        source_id: slug,
        metric: "cpu_temp",
        state: "closed",
        value: 70,
        threshold: 90,
        severity: "warning",
        timestamp: Math.floor(Date.now() / 1000),
      },
    ]);
    expect(res.status).toBe(204);

    const row = await getAlert(alertId);
    expect(row.is_alert_active).toBe(false);
    expect(row.closed_at).not.toBeNull();
    expect(row.resolved_by).toBe("user-42");
    expect(row.resolution_notes).toBe("power cycled the board");
    expect(new Date(row.resolved_at!).getTime()).toBe(
      new Date("2026-01-01T00:00:00Z").getTime(),
    );
  });

  it("records a reconciliation close honestly (reason=reconciled)", async () => {
    const slug = uniqueSlug();
    const sourceUuid = await insertSource(slug);
    const ruleId = await insertRule(slug);
    const alertId = await insertActiveRuleAlert(sourceUuid, ruleId);

    const res = await postTransitions([
      {
        rule_id: ruleId,
        org_id: ORG,
        source_id: slug,
        metric: "cpu_temp",
        state: "closed",
        value: 0,
        severity: "warning",
        timestamp: Math.floor(Date.now() / 1000),
        reason: "reconciled",
      },
    ]);
    expect(res.status).toBe(204);

    const row = await getAlert(alertId);
    expect(row.status).toBe("resolved");
    expect(row.is_alert_active).toBe(false);

    const events = await db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.alert_id, alertId));
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("resolved");
    expect(events[0].message).toContain("reconciliation");
  });

  it("is a no-op (no emission) when no matching open alert exists", async () => {
    const slug = uniqueSlug();
    await insertSource(slug);

    const res = await postTransitions([
      {
        rule_id: randomUUID(),
        org_id: ORG,
        source_id: slug,
        metric: "cpu_temp",
        state: "closed",
        value: 70,
        threshold: 90,
        severity: "warning",
        timestamp: Math.floor(Date.now() / 1000),
      },
    ]);
    expect(res.status).toBe(204);

    expect(scheduleWebhookDelivery).not.toHaveBeenCalled();
    expect(dispatchNotifications).not.toHaveBeenCalled();
    expect(emitSystemEvent).not.toHaveBeenCalled();
  });

  it("does not re-emit for an alert whose condition already cleared", async () => {
    const slug = uniqueSlug();
    const sourceUuid = await insertSource(slug);
    const ruleId = await insertRule(slug);
    const alertId = await insertActiveRuleAlert(sourceUuid, ruleId);
    await db
      .update(alerts)
      .set({ is_alert_active: false, closed_at: new Date().toISOString() })
      .where(eq(alerts.id, alertId));

    const res = await postTransitions([
      {
        rule_id: ruleId,
        org_id: ORG,
        source_id: slug,
        metric: "cpu_temp",
        state: "closed",
        value: 70,
        threshold: 90,
        severity: "warning",
        timestamp: Math.floor(Date.now() / 1000),
      },
    ]);
    expect(res.status).toBe(204);
    expect(dispatchNotifications).not.toHaveBeenCalled();
  });
});
