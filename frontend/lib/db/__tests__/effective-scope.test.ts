/**
 * Source-only scoping (lib/access/scope.ts + entity-scope.ts):
 *  - a defined allow-list of SOURCES restricts (even when empty); NULL = full
 *    access; admins are never scoped.
 *  - picking an ENTITY source implies row-filtered visibility of the
 *    connection it slices (derived via source_associations).
 *  - scopeConnectionQuery wraps connection queries with the picked entities'
 *    slice predicates; whole-connection picks pass; no slice = deny.
 *
 * NOTE: resolvers use React cache() (memoized per module instance in tests) —
 * every case uses fresh org/user rows so no case reads another's memo.
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../client";
import { orgMembers, sources } from "../schema";
import { sourceAssociationQueries } from "../queries/sources";
import { loadEffectiveScope } from "@/lib/access/scope";
import { scopeConnectionQuery } from "@/lib/access/entity-scope";

let n = 0;
function freshIds(): { org: string; user: string } {
  n += 1;
  return { org: `scope-org-${n}`, user: `scope-user-${n}` };
}

async function insertMember(
  org: string,
  user: string,
  opts: { role?: string; sources?: string[] | null } = {},
): Promise<void> {
  await db.insert(orgMembers).values({
    org_id: org,
    user_id: user,
    role: opts.role ?? "org:viewer",
    allowed_source_ids: opts.sources ?? null,
  } as typeof orgMembers.$inferInsert);
}

async function insertSource(
  org: string,
  slug: string,
  sourceType: "device" | "connection" = "device",
): Promise<string> {
  const [row] = await db
    .insert(sources)
    .values({
      org_id: org,
      slug,
      source_type: sourceType,
      name: slug,
    } as typeof sources.$inferInsert)
    .returning();
  return row.id;
}

describe("loadEffectiveScope (source-only)", () => {
  it("is unrestricted when no allow-list is defined", async () => {
    const { org, user } = freshIds();
    await insertMember(org, user);
    const scope = await loadEffectiveScope(org, user);
    expect(scope.sourceIds).toBeNull();
    expect(scope.pickedSourceIds).toBeNull();
  });

  it("keeps an empty allow-list as scoped-to-nothing", async () => {
    const { org, user } = freshIds();
    await insertMember(org, user, { sources: [] });
    const scope = await loadEffectiveScope(org, user);
    expect(scope.pickedSourceIds).not.toBeNull();
    expect(scope.sourceIds!.size).toBe(0);
  });

  it("never scopes admins, even with a stale list", async () => {
    const { org, user } = freshIds();
    await insertMember(org, user, { role: "org:admin", sources: [randomUUID()] });
    const scope = await loadEffectiveScope(org, user);
    expect(scope.sourceIds).toBeNull();
  });

  it("derives row-filtered connection visibility from picked entities", async () => {
    const { org, user } = freshIds();
    const connectionId = await insertSource(org, "customer-db", "connection");
    const entityId = await insertSource(org, "sat-25544");
    await sourceAssociationQueries.upsert(org, {
      entity_type: "satellite",
      entity_id: entityId,
      connection_id: connectionId,
      table_name: "telemetry",
      filter_column: "sat_id",
      filter_value: "25544",
    });
    await insertMember(org, user, { sources: [entityId] });

    const scope = await loadEffectiveScope(org, user);
    // Picked: just the entity. Visible: entity + its connection.
    expect(scope.pickedSourceIds!.has(entityId)).toBe(true);
    expect(scope.pickedSourceIds!.has(connectionId)).toBe(false);
    expect(scope.sourceIds!.has(entityId)).toBe(true);
    expect(scope.sourceIds!.has(connectionId)).toBe(true);
  });
});

describe("scopeConnectionQuery (association-fed)", () => {
  it("passes unscoped members and whole-connection picks untouched", async () => {
    const { org, user } = freshIds();
    const connectionId = await insertSource(org, "db-a", "connection");
    await insertMember(org, user);
    const pass = await scopeConnectionQuery(
      { orgId: org, userId: user, isApiKeyAuth: false },
      { id: connectionId },
      "SELECT 1",
      undefined,
    );
    expect(pass.deny).toBe(false);
    expect(pass.query).toBe("SELECT 1");

    const { org: org2, user: user2 } = freshIds();
    const conn2 = await insertSource(org2, "db-b", "connection");
    await insertMember(org2, user2, { sources: [conn2] });
    const picked = await scopeConnectionQuery(
      { orgId: org2, userId: user2, isApiKeyAuth: false },
      { id: conn2 },
      "SELECT 1",
      undefined,
    );
    expect(picked.deny).toBe(false);
    expect(picked.query).toBe("SELECT 1");
  });

  it("wraps with the picked entities' slice predicates", async () => {
    const { org, user } = freshIds();
    const connectionId = await insertSource(org, "sat-db", "connection");
    const iss = await insertSource(org, "sat-25544");
    const hubble = await insertSource(org, "sat-20580");
    for (const [id, value] of [
      [iss, "25544"],
      [hubble, "20580"],
    ] as const) {
      await sourceAssociationQueries.upsert(org, {
        entity_type: "satellite",
        entity_id: id,
        connection_id: connectionId,
        table_name: "telemetry",
        filter_column: "sat_id",
        filter_value: value,
      });
    }
    await insertMember(org, user, { sources: [iss, hubble] });

    const scoped = await scopeConnectionQuery(
      { orgId: org, userId: user, isApiKeyAuth: false },
      { id: connectionId },
      "SELECT * FROM t",
      { __filterParams: ["existing"] },
    );
    expect(scoped.deny).toBe(false);
    expect(scoped.query).toContain("FROM (SELECT * FROM t) AS _scoped");
    expect(scoped.query).toContain("_kv.k = ANY($2) AND _kv.v = ANY($3)");
    expect(scoped.params.__filterParams).toEqual([
      "existing",
      ["sat_id"],
      ["20580", "25544"],
    ]);
  });

  it("unions the connection's declared scopeColumns into the match", async () => {
    const { org, user } = freshIds();
    const connectionId = await insertSource(org, "conj-db", "connection");
    const iss = await insertSource(org, "sat-25544");
    await sourceAssociationQueries.upsert(org, {
      entity_type: "satellite",
      entity_id: iss,
      connection_id: connectionId,
      table_name: "satellite_base",
      filter_column: "sat_id",
      filter_value: "25544",
    });
    await insertMember(org, user, { sources: [iss] });

    const scoped = await scopeConnectionQuery(
      { orgId: org, userId: user, isApiKeyAuth: false },
      {
        id: connectionId,
        config: { scopeColumns: ["sat_id_1", "sat_id_2", "bad ident!"] },
      },
      "SELECT * FROM conjunction_event",
      undefined,
    );
    expect(scoped.deny).toBe(false);
    // Association column + declared columns, invalid identifiers dropped.
    expect(scoped.params.__filterParams).toEqual([
      ["sat_id", "sat_id_1", "sat_id_2"],
      ["25544"],
    ]);
  });

  it("denies a scoped viewer with no slice of the connection", async () => {
    const { org, user } = freshIds();
    const connectionId = await insertSource(org, "other-db", "connection");
    const unrelatedDevice = await insertSource(org, "drone-1");
    await insertMember(org, user, { sources: [unrelatedDevice] });

    const scoped = await scopeConnectionQuery(
      { orgId: org, userId: user, isApiKeyAuth: false },
      { id: connectionId },
      "SELECT 1",
      undefined,
    );
    expect(scoped.deny).toBe(true);
  });
});
