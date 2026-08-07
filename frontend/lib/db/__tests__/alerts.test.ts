import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { alerts, alertEvents } from "../schema";
import { alertQueries, alertEventQueries } from "../queries/alerts";

const ORG = "test-org";

async function insertAlert(
  status: "open" | "acknowledged" | "resolved" = "open",
): Promise<string> {
  const [row] = await db
    .insert(alerts)
    .values({
      org_id: ORG,
      trigger_type: "limit_violation",
      metric: "cpu_temp",
      value: 90,
      severity: "warning",
      status,
      is_alert_active: true,
    } as typeof alerts.$inferInsert)
    .returning();
  return row.id;
}

async function getAlert(id: string) {
  const rows = await db.select().from(alerts).where(eq(alerts.id, id)).limit(1);
  return rows[0];
}

async function getEvents(alertId: string) {
  return db
    .select()
    .from(alertEvents)
    .where(eq(alertEvents.alert_id, alertId));
}

describe("alertQueries.update — tx support", () => {
  it("works without tx (backward compat)", async () => {
    const id = await insertAlert("open");

    const result = await alertQueries.update(ORG, id, {
      status: "acknowledged",
      acknowledged_by: "user-1",
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("acknowledged");

    const row = await getAlert(id);
    expect(row.status).toBe("acknowledged");
  });

  it("works inside a transaction", async () => {
    const id = await insertAlert("open");

    const result = await db.transaction(async (tx) => {
      return alertQueries.update(ORG, id, {
        status: "resolved",
        resolved_by: "user-1",
      }, tx);
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("resolved");

    const row = await getAlert(id);
    expect(row.status).toBe("resolved");
  });
});

describe("alertEventQueries.create — tx support", () => {
  it("works without tx (backward compat)", async () => {
    const alertId = await insertAlert("open");

    const result = await alertEventQueries.create(ORG, alertId, "acknowledged", {
      actorId: "user-1",
      message: "Alert acknowledged",
    });

    expect(result).not.toBeNull();
    expect(result.event_type).toBe("acknowledged");
    expect(result.actor_id).toBe("user-1");

    const events = await getEvents(alertId);
    expect(events).toHaveLength(1);
  });

  it("works inside a transaction", async () => {
    const alertId = await insertAlert("open");

    await db.transaction(async (tx) => {
      await alertEventQueries.create(ORG, alertId, "comment", {
        actorId: "user-1",
        message: "Test comment",
      }, tx);
    });

    const events = await getEvents(alertId);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("comment");
  });
});

describe("alert transition transaction — commit", () => {
  it("acknowledge: updates alert AND creates event atomically", async () => {
    const id = await insertAlert("open");

    await db.transaction(async (tx) => {
      await alertQueries.acknowledge(ORG, id, "user-1", tx);
      await alertEventQueries.create(ORG, id, "acknowledged", {
        actorId: "user-1",
        message: "Alert acknowledged",
      }, tx);
    });

    const alert = await getAlert(id);
    expect(alert.status).toBe("acknowledged");
    expect(alert.acknowledged_by).toBe("user-1");

    const events = await getEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("acknowledged");
  });

  it("resolve: updates alert AND creates event atomically", async () => {
    const id = await insertAlert("acknowledged");

    await db.transaction(async (tx) => {
      await alertQueries.resolve(ORG, id, "user-1", "Fixed", tx);
      await alertEventQueries.create(ORG, id, "resolved", {
        actorId: "user-1",
        message: "Alert resolved: Fixed",
      }, tx);
    });

    const alert = await getAlert(id);
    expect(alert.status).toBe("resolved");
    expect(alert.resolved_by).toBe("user-1");
    expect(alert.resolution_notes).toBe("Fixed");

    const events = await getEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("resolved");
  });

  it("reopen: updates alert AND creates event atomically", async () => {
    const id = await insertAlert("resolved");

    await db.transaction(async (tx) => {
      await alertQueries.reopen(ORG, id, tx);
      await alertEventQueries.create(ORG, id, "reopened", {
        message: "Alert reopened",
      }, tx);
    });

    const alert = await getAlert(id);
    expect(alert.status).toBe("open");
    expect(alert.resolved_at).toBeNull();
    expect(alert.resolved_by).toBeNull();

    const events = await getEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("reopened");
  });
});

describe("alert transition transaction — rollback", () => {
  it("rolls back alert status when event creation fails", async () => {
    const id = await insertAlert("open");
    const original = await getAlert(id);

    await expect(
      db.transaction(async (tx) => {
        await alertQueries.acknowledge(ORG, id, "user-1", tx);
        // Simulate event creation failure by throwing after the update
        throw new Error("Event creation failed");
      }),
    ).rejects.toThrow("Event creation failed");

    // Alert status should be rolled back to original
    const alert = await getAlert(id);
    expect(alert.status).toBe(original.status);
    expect(alert.acknowledged_at).toBeNull();
    expect(alert.acknowledged_by).toBeNull();

    // No event should exist
    const events = await getEvents(id);
    expect(events).toHaveLength(0);
  });

  it("rolls back event when a second operation in the transaction fails", async () => {
    const id = await insertAlert("open");

    await expect(
      db.transaction(async (tx) => {
        await alertEventQueries.create(ORG, id, "comment", {
          message: "First event",
        }, tx);
        // Second operation fails
        throw new Error("Second op failed");
      }),
    ).rejects.toThrow("Second op failed");

    // No event should exist — it was rolled back
    const events = await getEvents(id);
    expect(events).toHaveLength(0);
  });
});
