import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { sourceGroups } from "../schema";
import { createOrgQueries } from "../queries/shared";
import type { SourceGroup, NewSourceGroup } from "../types";

const ORG = "test-org";
const OTHER_ORG = "other-org";

const groupQueries = createOrgQueries<SourceGroup, NewSourceGroup>(sourceGroups);

async function insertGroup(
  orgId: string,
  name: string,
): Promise<string> {
  const [row] = await db
    .insert(sourceGroups)
    .values({
      org_id: orgId,
      name,
      filter_criteria: {},
    } as typeof sourceGroups.$inferInsert)
    .returning();
  return row.id;
}

describe("createOrgQueries factory", () => {
  describe("findAll", () => {
    it("returns only rows for the given org", async () => {
      await insertGroup(ORG, "Group A");
      await insertGroup(ORG, "Group B");
      await insertGroup(OTHER_ORG, "Group C");

      const rows = await groupQueries.findAll(ORG);

      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.org_id === ORG)).toBe(true);
    });

    it("returns empty array for an org with no rows", async () => {
      const rows = await groupQueries.findAll("empty-org");
      expect(rows).toEqual([]);
    });
  });

  describe("findById", () => {
    it("finds a row by org + id", async () => {
      const id = await insertGroup(ORG, "Find Me");

      const rows = await groupQueries.findById(ORG, id);

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(id);
      expect(rows[0].name).toBe("Find Me");
    });

    it("returns empty array when id doesn't exist", async () => {
      const rows = await groupQueries.findById(ORG, "00000000-0000-0000-0000-000000000099");
      expect(rows).toEqual([]);
    });

    it("returns empty array when id exists but belongs to another org", async () => {
      const id = await insertGroup(OTHER_ORG, "Cross-Org");

      const rows = await groupQueries.findById(ORG, id);

      expect(rows).toEqual([]);
    });
  });

  describe("findOne", () => {
    it("finds first row matching org + filters", async () => {
      await insertGroup(ORG, "Unique Name");

      const row = await groupQueries.findOne(ORG, { name: "Unique Name" });

      expect(row).not.toBeNull();
      expect(row!.name).toBe("Unique Name");
    });

    it("returns null when no row matches", async () => {
      const row = await groupQueries.findOne(ORG, { name: "Nonexistent" });
      expect(row).toBeNull();
    });
  });

  describe("findMany", () => {
    it("supports orderBy + limit + offset", async () => {
      await insertGroup(ORG, "Charlie");
      await insertGroup(ORG, "Alpha");
      await insertGroup(ORG, "Bravo");

      const page1 = await groupQueries.findMany(ORG, {}, {
        orderBy: ["name", "asc"],
        limit: 2,
        offset: 0,
      });
      const page2 = await groupQueries.findMany(ORG, {}, {
        orderBy: ["name", "asc"],
        limit: 2,
        offset: 2,
      });

      expect(page1).toHaveLength(2);
      expect(page1[0].name).toBe("Alpha");
      expect(page1[1].name).toBe("Bravo");
      expect(page2).toHaveLength(1);
      expect(page2[0].name).toBe("Charlie");
    });
  });

  describe("insert", () => {
    it("inserts a row with org_id and returns it", async () => {
      const rows = await groupQueries.insert(ORG, {
        name: "Inserted Group",
        filter_criteria: {},
      } as never);

      expect(rows).toHaveLength(1);
      expect(rows[0].org_id).toBe(ORG);
      expect(rows[0].name).toBe("Inserted Group");
    });
  });

  describe("update", () => {
    it("updates a row scoped by org + id", async () => {
      const id = await insertGroup(ORG, "Old Name");

      const rows = await groupQueries.update(ORG, id, { name: "New Name" } as never);

      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("New Name");
    });

    it("returns empty array when id belongs to another org", async () => {
      const id = await insertGroup(OTHER_ORG, "Other Org Group");

      const rows = await groupQueries.update(ORG, id, { name: "Hijacked" } as never);

      expect(rows).toEqual([]);
    });
  });

  describe("delete", () => {
    it("deletes a row scoped by org + id", async () => {
      const id = await insertGroup(ORG, "Delete Me");

      const rows = await groupQueries.delete(ORG, id);

      expect(rows).toHaveLength(1);
      const remaining = await db.select().from(sourceGroups).where(eq(sourceGroups.id, id));
      expect(remaining).toEqual([]);
    });

    it("returns empty array when id belongs to another org", async () => {
      const id = await insertGroup(OTHER_ORG, "Protected");

      const rows = await groupQueries.delete(ORG, id);

      expect(rows).toEqual([]);
    });
  });

  describe("count", () => {
    it("counts rows for the given org", async () => {
      await insertGroup(ORG, "Count 1");
      await insertGroup(ORG, "Count 2");
      await insertGroup(OTHER_ORG, "Don't Count Me");

      const count = await groupQueries.count(ORG);

      expect(count).toBe(2);
    });

    it("returns 0 for an org with no rows", async () => {
      const count = await groupQueries.count("empty-org");
      expect(count).toBe(0);
    });
  });
});
