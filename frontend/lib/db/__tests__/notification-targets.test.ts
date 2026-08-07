import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../client";
import {
  slackIntegrations,
  emailIntegrations,
  alertRules,
  eventMonitors,
  sources,
} from "../schema";
import {
  slackIntegrationQueries,
  emailIntegrationQueries,
} from "../queries/integrations";
import { alertRuleQueries } from "../queries/alert-rules";
import { eventMonitorQueries } from "../queries/sources";
import {
  adminEventMonitorQueries,
  adminAlertRuleQueries,
} from "../server";
import { resolveNotificationTargets } from "@/lib/webhooks/events";
import type { Alert } from "../types";

const ORG = "test-org";
const OTHER_ORG = "other-org";

async function insertSlack(
  orgId: string,
  channel: string,
  enabled = true,
): Promise<string> {
  const [row] = await db
    .insert(slackIntegrations)
    .values({
      org_id: orgId,
      team_id: "T123",
      team_name: "Test Team",
      channel_id: `C-${channel}`,
      channel_name: channel,
      webhook_url_encrypted: "enc:fake",
      enabled,
      events: ["alert.triggered"],
    } as typeof slackIntegrations.$inferInsert)
    .returning();
  return row.id;
}

async function insertSource(orgId: string, slug: string): Promise<string> {
  const [row] = await db
    .insert(sources)
    .values({
      org_id: orgId,
      slug,
      name: slug,
      source_type: "device",
    } as typeof sources.$inferInsert)
    .returning();
  return row.id;
}

describe("findEnabledByIds", () => {
  beforeEach(async () => {
    await db.delete(slackIntegrations);
    await db.delete(emailIntegrations);
  });

  it("returns only the requested, enabled, org-scoped integrations", async () => {
    const a = await insertSlack(ORG, "alpha");
    const b = await insertSlack(ORG, "bravo");
    const disabled = await insertSlack(ORG, "charlie", false);
    const foreign = await insertSlack(OTHER_ORG, "delta");

    const rows = await slackIntegrationQueries.findEnabledByIds(ORG, [
      a,
      disabled,
      foreign,
    ]);

    expect(rows.map((r) => r.id)).toEqual([a]);
    // b exists and is enabled but was not requested
    expect(rows.some((r) => r.id === b)).toBe(false);
  });

  it("returns [] for an empty id list without querying", async () => {
    await insertSlack(ORG, "alpha");
    expect(await slackIntegrationQueries.findEnabledByIds(ORG, [])).toEqual([]);
    expect(await emailIntegrationQueries.findEnabledByIds(ORG, [])).toEqual([]);
  });
});

describe("notification_target_ids round-trip", () => {
  beforeEach(async () => {
    await db.delete(eventMonitors);
    await db.delete(alertRules);
    await db.delete(sources).where(eq(sources.org_id, ORG));
  });

  it("persists targets on event monitors; omit preserves, null clears", async () => {
    const sourceId = await insertSource(ORG, "sat-1");
    const targetId = "11111111-1111-4111-8111-111111111111";

    await eventMonitorQueries.upsert(ORG, {
      source_id: sourceId,
      metric: "new_users",
      notification_target_ids: [targetId],
    });

    let monitor = await eventMonitorQueries.findByMetric(
      ORG,
      sourceId,
      "new_users",
    );
    expect(monitor?.notification_target_ids).toEqual([targetId]);

    // Reconfiguring WITHOUT the field preserves existing routing.
    await eventMonitorQueries.upsert(ORG, {
      source_id: sourceId,
      metric: "new_users",
    });
    monitor = await eventMonitorQueries.findByMetric(ORG, sourceId, "new_users");
    expect(monitor?.notification_target_ids).toEqual([targetId]);

    // An explicit null clears back to default fan-out.
    await eventMonitorQueries.upsert(ORG, {
      source_id: sourceId,
      metric: "new_users",
      notification_target_ids: null,
    });
    monitor = await eventMonitorQueries.findByMetric(ORG, sourceId, "new_users");
    expect(monitor?.notification_target_ids).toBeNull();
  });

  it("persists targets on alert rules", async () => {
    const targetId = "22222222-2222-4222-8222-222222222222";
    const rule = await alertRuleQueries.create(ORG, {
      source_id: "sat-1",
      type: "offline",
      conditions: { timeout_seconds: 300 },
      severity: "warning",
      enabled: true,
      notification_target_ids: [targetId],
    });
    const found = await alertRuleQueries.findById(ORG, rule.id);
    expect(found?.notification_target_ids).toEqual([targetId]);
  });
});

describe("setTargets helpers (PATCH path)", () => {
  beforeEach(async () => {
    await db.delete(eventMonitors);
    await db.delete(alertRules);
    await db.delete(sources).where(eq(sources.org_id, ORG));
  });

  it("updates event-monitor targets without touching the poll cursor", async () => {
    const sourceId = await insertSource(ORG, "sat-3");
    await eventMonitorQueries.upsert(ORG, {
      source_id: sourceId,
      metric: "new_users",
    });
    await eventMonitorQueries.updatePollState(
      ORG,
      (await eventMonitorQueries.findByMetric(ORG, sourceId, "new_users"))!.id,
      { poll_watermark: "wm-1" },
    );

    const targetId = "55555555-5555-4555-8555-555555555555";
    const updated = await adminEventMonitorQueries.setTargets(
      ORG,
      sourceId,
      "new_users",
      [targetId],
    );
    expect(updated).toBe(1);

    const monitor = await eventMonitorQueries.findByMetric(
      ORG,
      sourceId,
      "new_users",
    );
    expect(monitor?.notification_target_ids).toEqual([targetId]);
    expect(monitor?.poll_watermark).toBe("wm-1"); // cursor untouched

    // Clearing back to default fan-out.
    await adminEventMonitorQueries.setTargets(ORG, sourceId, "new_users", null);
    expect(
      (await eventMonitorQueries.findByMetric(ORG, sourceId, "new_users"))
        ?.notification_target_ids,
    ).toBeNull();
  });

  it("returns 0 for a missing monitor and scopes threshold/by-id setters to the org", async () => {
    expect(
      await adminEventMonitorQueries.setTargets(ORG, crypto.randomUUID(), "m", [
        "66666666-6666-4666-8666-666666666666",
      ]),
    ).toBe(0);
    expect(
      await adminAlertRuleQueries.setThresholdTargets(ORG, "sat-x", "m", null),
    ).toBe(0);

    const rule = await alertRuleQueries.create(ORG, {
      source_id: "sat-1",
      type: "offline",
      conditions: { timeout_seconds: 300 },
      severity: "warning",
      enabled: true,
    });
    // Wrong org cannot touch it.
    expect(
      await adminAlertRuleQueries.setTargetsById(OTHER_ORG, rule.id, [
        "77777777-7777-4777-8777-777777777777",
      ]),
    ).toBe(0);
    expect(
      await adminAlertRuleQueries.setTargetsById(ORG, rule.id, [
        "77777777-7777-4777-8777-777777777777",
      ]),
    ).toBe(1);
  });
});

describe("resolveNotificationTargets", () => {
  beforeEach(async () => {
    await db.delete(eventMonitors);
    await db.delete(alertRules);
    await db.delete(sources).where(eq(sources.org_id, ORG));
  });

  it("resolves targets from the rule for rule-provenance alerts", async () => {
    const targetId = "33333333-3333-4333-8333-333333333333";
    const rule = await alertRuleQueries.create(ORG, {
      source_id: "sat-1",
      type: "offline",
      conditions: { timeout_seconds: 300 },
      severity: "warning",
      enabled: true,
      notification_target_ids: [targetId],
    });

    const targets = await resolveNotificationTargets(ORG, {
      rule_id: rule.id,
      trigger_type: "alert_rule",
    } as Alert);
    expect(targets).toEqual([targetId]);
  });

  it("resolves targets from the monitor for event alerts via (source, metric)", async () => {
    const sourceId = await insertSource(ORG, "sat-2");
    const targetId = "44444444-4444-4444-8444-444444444444";
    await eventMonitorQueries.upsert(ORG, {
      source_id: sourceId,
      metric: "new_users",
      notification_target_ids: [targetId],
    });

    const targets = await resolveNotificationTargets(ORG, {
      rule_id: null,
      trigger_type: "event",
      source_id: sourceId,
      metric: "new_users",
    } as Alert);
    expect(targets).toEqual([targetId]);
  });

  it("returns null (default fan-out) when no explicit targets exist", async () => {
    const rule = await alertRuleQueries.create(ORG, {
      source_id: "sat-1",
      type: "offline",
      conditions: { timeout_seconds: 300 },
      severity: "warning",
      enabled: true,
    });

    expect(
      await resolveNotificationTargets(ORG, {
        rule_id: rule.id,
        trigger_type: "alert_rule",
      } as Alert),
    ).toBeNull();

    // Unknown provenance (e.g. limit violations) also defaults.
    expect(
      await resolveNotificationTargets(ORG, {
        rule_id: null,
        trigger_type: "limit_violation",
        source_id: "s",
        metric: "m",
      } as Alert),
    ).toBeNull();
  });
});
