/**
 * Source identity invariants (see docs/STANDARDS.md §3 "Source identity"):
 * slug = canonical wire/user identity, uuid = internal FK. Pins the resolveRef
 * contract, the event_monitors uuid FK (migration 0013), and the alert_rules
 * slug convention + legacy-uuid backfill semantics.
 */
import { describe, it, expect } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../client";
import { sources, eventMonitors, alertRules } from "../schema";
import { adminSourceQueries } from "../server";
import { eventMonitorQueries } from "../queries/sources";
import { serializeAlertRuleForWire } from "@/lib/alerts/serialize-alert-rule";
import { isUuid } from "@/lib/utils/uuid";
import type { AlertRuleWithSlug } from "../server";

const ORG = "identity-org";

async function insertSource(slug: string): Promise<string> {
  const [row] = await db
    .insert(sources)
    .values({
      org_id: ORG,
      slug,
      source_type: "device",
      name: `Source ${slug}`,
      status: "online",
      config: {},
      metadata: {},
      tags: [],
      is_telemetry_store: false,
      visibility: "org",
    } as typeof sources.$inferInsert)
    .returning({ id: sources.id });
  return row.id;
}

describe("isUuid", () => {
  it("accepts uuid shapes case-insensitively", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
  });
  it("rejects slugs, near-misses, and empty", () => {
    expect(isUuid("esp32-bme280")).toBe(false);
    expect(isUuid("123e4567e89b12d3a456426614174000")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("adminSourceQueries.resolveRef", () => {
  it("resolves the same row by slug and by uuid, org-scoped", async () => {
    const id = await insertSource("resolve-me");

    const bySlug = await adminSourceQueries.resolveRef(ORG, "resolve-me");
    const byId = await adminSourceQueries.resolveRef(ORG, id);

    expect(bySlug?.id).toBe(id);
    expect(byId?.slug).toBe("resolve-me");
    expect(await adminSourceQueries.resolveRef("other-org", "resolve-me")).toBeNull();
  });

  it("pins the documented limitation: uuid-shaped slugs are unreachable", async () => {
    // Creation rejects these now (CreateSourceSchema + register route); this
    // pins WHY — resolveRef routes uuid-shaped refs to the id column only.
    const uuidShapedSlug = "123e4567-e89b-12d3-a456-426614174000";
    await insertSource(uuidShapedSlug);

    const resolved = await adminSourceQueries.resolveRef(ORG, uuidShapedSlug);

    expect(resolved).toBeNull();
  });
});

describe("event_monitors uuid FK (migration 0013)", () => {
  it("cascades monitor deletion when the source is deleted", async () => {
    const id = await insertSource("cascade-src");
    await db.insert(eventMonitors).values({
      org_id: ORG,
      source_id: id,
      metric: "boot_event",
    } as typeof eventMonitors.$inferInsert);

    await db.delete(sources).where(eq(sources.id, id));

    const orphans = await db
      .select()
      .from(eventMonitors)
      .where(and(eq(eventMonitors.org_id, ORG), eq(eventMonitors.metric, "boot_event")));
    expect(orphans).toHaveLength(0);
  });

  it("rejects inserts referencing a nonexistent source", async () => {
    await expect(
      db.insert(eventMonitors).values({
        org_id: ORG,
        source_id: "00000000-0000-4000-8000-000000000000",
        metric: "ghost",
      } as typeof eventMonitors.$inferInsert),
    ).rejects.toThrow();
  });

  it("joins on sources.id without casts (the detect-poll shape)", async () => {
    const id = await insertSource("join-src");
    await db.insert(eventMonitors).values({
      org_id: ORG,
      source_id: id,
      metric: "reading",
    } as typeof eventMonitors.$inferInsert);

    const rows = await db
      .select({ monitor: eventMonitors, source: sources })
      .from(eventMonitors)
      .innerJoin(sources, eq(sources.id, eventMonitors.source_id))
      .where(eq(eventMonitors.org_id, ORG));

    expect(rows).toHaveLength(1);
    expect(rows[0].source.slug).toBe("join-src");

    const viaQuery = await eventMonitorQueries.findEnabledBySource(ORG, id);
    expect(viaQuery).toHaveLength(1);
  });
});

describe("alert_rules slug convention + 0013 backfill semantics", () => {
  const BACKFILL_SQL = sql`
    UPDATE alert_rules ar SET source_id = s.slug
    FROM sources s
    WHERE ar.source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND s.id::text = ar.source_id AND s.org_id = ar.org_id
      AND NOT EXISTS (SELECT 1 FROM sources s2
                      WHERE s2.org_id = ar.org_id AND s2.slug = ar.source_id)
  `; // mirrors migration 0013 §4 — keep in sync

  it("rewrites legacy uuid-valued rules to the slug", async () => {
    const id = await insertSource("legacy-rule-src");
    await db.insert(alertRules).values({
      org_id: ORG,
      source_id: id, // legacy pre-00037 residue: uuid stored in the slug column
      type: "threshold",
      metric: "temp",
      conditions: { max: 100 },
      severity: "warning",
      enabled: true,
    } as typeof alertRules.$inferInsert);

    await db.execute(BACKFILL_SQL);

    const [rule] = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.org_id, ORG));
    expect(rule.source_id).toBe("legacy-rule-src");
  });

  it("leaves rules for deleted sources untouched (inert, not corrupted)", async () => {
    await db.insert(alertRules).values({
      org_id: ORG,
      source_id: "00000000-0000-4000-8000-00000000dead",
      type: "threshold",
      metric: "temp",
      conditions: { max: 1 },
      severity: "warning",
      enabled: true,
    } as typeof alertRules.$inferInsert);

    await db.execute(BACKFILL_SQL);

    const [rule] = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.org_id, ORG));
    expect(rule.source_id).toBe("00000000-0000-4000-8000-00000000dead");
  });

  it("serializeAlertRuleForWire passes the slug through as wire source_id", () => {
    const row: AlertRuleWithSlug = {
      id: "rule-1",
      org_id: ORG,
      source_id: "wire-slug",
      type: "threshold",
      metric: "temp",
      conditions: { max: 100 },
      operator: null,
      sub_rules: null,
      hysteresis_seconds: null,
      cooldown_seconds: null,
      severity: "warning",
    };
    expect(serializeAlertRuleForWire(row).source_id).toBe("wire-slug");
  });
});
