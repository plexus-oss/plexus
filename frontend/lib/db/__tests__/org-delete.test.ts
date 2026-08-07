import { describe, it, expect } from "vitest";
import { eq, getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "../client";
import * as schema from "../schema";
import {
  orgBilling,
  orgMembers,
  dashboards,
  sources,
  users,
  userSettings,
} from "../schema";
import {
  ORG_SCOPED_TABLES,
  deleteOrgCascade,
  deleteUserRows,
} from "../queries/org-delete";

const ORG = "org-delete-a";
const OTHER_ORG = "org-delete-b";

function isPgTable(value: unknown): value is PgTable {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.for("drizzle:IsDrizzleTable") in (value as object)
  );
}

async function seedOrg(orgId: string): Promise<void> {
  await db.insert(orgBilling).values({ org_id: orgId, org_name: orgId });
  await db.insert(orgMembers).values({
    org_id: orgId,
    user_id: `user-${orgId}`,
    role: "org:admin",
  });
  await db.insert(sources).values({
    org_id: orgId,
    source_type: "device",
    name: `${orgId} source`,
    slug: `${orgId}-source`,
  } as typeof sources.$inferInsert);
  await db.insert(dashboards).values({
    org_id: orgId,
    name: `${orgId} dashboard`,
    config: {},
  } as typeof dashboards.$inferInsert);
}

describe("ORG_SCOPED_TABLES drift guard", () => {
  it("contains every schema table with an org_id column", () => {
    const swept = new Set(ORG_SCOPED_TABLES.map((t) => getTableName(t)));

    const missing: string[] = [];
    for (const exported of Object.values(schema)) {
      if (!isPgTable(exported)) continue;
      const columns = getTableColumns(exported);
      if ("org_id" in columns && !swept.has(getTableName(exported))) {
        missing.push(getTableName(exported));
      }
    }

    expect(
      missing,
      `Tables with org_id missing from ORG_SCOPED_TABLES: ${missing.join(", ")} — add them to lib/db/queries/org-delete.ts`,
    ).toEqual([]);
  });
});

describe("deleteOrgCascade", () => {
  it("removes all rows for the org and leaves other orgs intact", async () => {
    await seedOrg(ORG);
    await seedOrg(OTHER_ORG);

    const result = await deleteOrgCascade(ORG);
    expect(result.tablesCleared).toBe(ORG_SCOPED_TABLES.length);

    for (const table of [orgBilling, orgMembers, sources, dashboards]) {
      const gone = await db
        .select()
        .from(table)
        .where(eq(table.org_id, ORG));
      expect(gone, `${getTableName(table)} rows for deleted org`).toHaveLength(0);

      const kept = await db
        .select()
        .from(table)
        .where(eq(table.org_id, OTHER_ORG));
      expect(
        kept.length,
        `${getTableName(table)} rows for surviving org`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("deleteUserRows", () => {
  it("removes the user, settings, and memberships", async () => {
    const userId = "org-delete-user";
    await db.insert(users).values({ id: userId, email: "od@test.local" });
    await db
      .insert(userSettings)
      .values({ user_id: userId } as typeof userSettings.$inferInsert);
    await db.insert(orgMembers).values({
      org_id: ORG,
      user_id: userId,
      role: "org:viewer",
    });

    await deleteUserRows(userId);

    expect(
      await db.select().from(users).where(eq(users.id, userId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.user_id, userId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(orgMembers)
        .where(eq(orgMembers.user_id, userId)),
    ).toHaveLength(0);
  });
});
