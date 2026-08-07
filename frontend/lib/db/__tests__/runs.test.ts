/**
 * runQueries invariants (lib/db/queries/runs.ts, migration 0026):
 * a run is a named, org-scoped time window. Pins the CRUD round-trip, the
 * findByOrg filter/ordering contract (started_at DESC), the close-run update
 * shape (ended_at + status), and org isolation on every accessor.
 */
import { describe, it, expect } from "vitest";
import { db } from "../client";
import { sources } from "../schema";
import { runQueries } from "../queries/runs";

const ORG_A = "runs-org-a";
const ORG_B = "runs-org-b";

async function insertSource(orgId: string, slug: string): Promise<string> {
  const [row] = await db
    .insert(sources)
    .values({
      org_id: orgId,
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

describe("runQueries insert + findById", () => {
  it("round-trips a run with explicit fields", async () => {
    const sourceId = await insertSource(ORG_A, "burn-in-rig");
    const criteria = [
      { metric: "temp", operator: "<" as const, value: 80, label: "stays cool" },
    ];

    const created = await runQueries.insert({
      org_id: ORG_A,
      name: "Burn-in #42",
      source_id: sourceId,
      status: "active",
      started_at: "2026-07-01T10:00:00.000Z",
      tags: { firmware: "v1.2.3" },
      metadata: { operator: "ann" },
      pass_criteria: criteria,
      created_by: "user_1",
    });

    expect(created.id).toBeTruthy();
    expect(created.org_id).toBe(ORG_A);
    expect(created.name).toBe("Burn-in #42");
    expect(created.source_id).toBe(sourceId);
    expect(created.status).toBe("active");
    expect(created.ended_at).toBeNull();
    expect(created.pass_criteria).toEqual(criteria);
    expect(created.created_by).toBe("user_1");

    const found = await runQueries.findById(ORG_A, created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Burn-in #42");
    expect(found!.tags).toEqual({ firmware: "v1.2.3" });
    expect(found!.pass_criteria).toEqual(criteria);
  });

  it("applies defaults: active status, empty pass_criteria, nullable source", async () => {
    const created = await runQueries.insert({ org_id: ORG_A, name: "Bare run" });

    expect(created.status).toBe("active");
    expect(created.source_id).toBeNull();
    expect(created.pass_criteria).toEqual([]);
    expect(created.test_result).toBeNull();
    expect(created.started_at).toBeTruthy();
  });
});

describe("runQueries.findByOrg", () => {
  it("orders by started_at DESC and applies status/source filters", async () => {
    const srcA = await insertSource(ORG_A, "rig-a");
    const srcB = await insertSource(ORG_A, "rig-b");

    await runQueries.insert({
      org_id: ORG_A,
      name: "oldest",
      source_id: srcA,
      status: "completed",
      started_at: "2026-07-01T00:00:00.000Z",
      ended_at: "2026-07-01T01:00:00.000Z",
    });
    await runQueries.insert({
      org_id: ORG_A,
      name: "middle",
      source_id: srcB,
      status: "aborted",
      started_at: "2026-07-02T00:00:00.000Z",
      ended_at: "2026-07-02T00:30:00.000Z",
    });
    await runQueries.insert({
      org_id: ORG_A,
      name: "newest",
      source_id: srcA,
      status: "active",
      started_at: "2026-07-03T00:00:00.000Z",
    });

    const all = await runQueries.findByOrg(ORG_A);
    expect(all.map((r) => r.name)).toEqual(["newest", "middle", "oldest"]);

    const active = await runQueries.findByOrg(ORG_A, { status: "active" });
    expect(active.map((r) => r.name)).toEqual(["newest"]);

    const completed = await runQueries.findByOrg(ORG_A, { status: "completed" });
    expect(completed.map((r) => r.name)).toEqual(["oldest"]);

    const onSrcA = await runQueries.findByOrg(ORG_A, { sourceId: srcA });
    expect(onSrcA.map((r) => r.name)).toEqual(["newest", "oldest"]);

    const activeOnSrcB = await runQueries.findByOrg(ORG_A, {
      status: "active",
      sourceId: srcB,
    });
    expect(activeOnSrcB).toHaveLength(0);
  });

  it("respects the limit option", async () => {
    for (let i = 0; i < 3; i++) {
      await runQueries.insert({
        org_id: ORG_A,
        name: `run-${i}`,
        started_at: `2026-07-0${i + 1}T00:00:00.000Z`,
      });
    }
    const limited = await runQueries.findByOrg(ORG_A, { limit: 2 });
    expect(limited.map((r) => r.name)).toEqual(["run-2", "run-1"]);
  });
});

describe("runQueries.update", () => {
  it("closes a run: ended_at + status completed + test_result", async () => {
    const created = await runQueries.insert({
      org_id: ORG_A,
      name: "To close",
      started_at: "2026-07-01T00:00:00.000Z",
    });

    const result = {
      passed: true,
      evaluated_at: "2026-07-01T02:00:00.000Z",
      criteria_results: [],
    };
    const updated = await runQueries.update(ORG_A, created.id, {
      status: "completed",
      ended_at: "2026-07-01T02:00:00.000Z",
      test_result: result,
    });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("completed");
    expect(updated!.ended_at).toBeTruthy();
    expect(updated!.test_result).toEqual(result);

    const found = await runQueries.findById(ORG_A, created.id);
    expect(found!.status).toBe("completed");
    expect(found!.ended_at).toBeTruthy();
  });

  it("returns null for a nonexistent run", async () => {
    const updated = await runQueries.update(
      ORG_A,
      "00000000-0000-4000-8000-000000000000",
      { name: "ghost" },
    );
    expect(updated).toBeNull();
  });
});

describe("runQueries.delete", () => {
  it("deletes and reports whether a row was removed", async () => {
    const created = await runQueries.insert({ org_id: ORG_A, name: "Doomed" });

    expect(await runQueries.delete(ORG_A, created.id)).toBe(true);
    expect(await runQueries.findById(ORG_A, created.id)).toBeNull();
    // Second delete finds nothing.
    expect(await runQueries.delete(ORG_A, created.id)).toBe(false);
  });
});

describe("org isolation", () => {
  it("org B cannot read, update, delete, or list org A's runs", async () => {
    const created = await runQueries.insert({
      org_id: ORG_A,
      name: "A's run",
    });

    expect(await runQueries.findById(ORG_B, created.id)).toBeNull();
    expect(
      await runQueries.update(ORG_B, created.id, { name: "hijacked" }),
    ).toBeNull();
    expect(await runQueries.delete(ORG_B, created.id)).toBe(false);
    expect(await runQueries.findByOrg(ORG_B)).toHaveLength(0);

    // And the row is untouched for org A.
    const intact = await runQueries.findById(ORG_A, created.id);
    expect(intact!.name).toBe("A's run");
  });
});
