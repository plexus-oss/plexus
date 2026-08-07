import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { sources, sourceGroups } from "../schema";
import { sourceQueries, sourceGroupQueries } from "../queries/sources";

const ORG = "test-org";

async function insertSource(
  slug: string,
  sourceType: string,
  name: string = `Source ${slug}`,
): Promise<void> {
  await db.insert(sources).values({
    org_id: ORG,
    slug,
    source_type: sourceType,
    name,
    status: "online",
    config: { recording: false },
    metadata: {},
    tags: [],
    is_telemetry_store: false,
    visibility: "org",
  } as typeof sources.$inferInsert);
}

describe("sourceQueries.countByType", () => {
  it("counts mixed device and connection sources", async () => {
    await insertSource("dev-1", "device");
    await insertSource("dev-2", "device");
    await insertSource("dev-3", "device");
    await insertSource("conn-1", "connection");
    await insertSource("conn-2", "connection");

    const counts = await sourceQueries.countByType(ORG);

    expect(counts).toEqual({ device: 3, connection: 2 });
  });

  it("returns zeros for an org with no sources", async () => {
    const counts = await sourceQueries.countByType("empty-org");

    expect(counts).toEqual({ device: 0, connection: 0 });
  });

  it("returns zero for the missing type when only one type exists", async () => {
    await insertSource("dev-only-1", "device");
    await insertSource("dev-only-2", "device");

    const counts = await sourceQueries.countByType(ORG);

    expect(counts).toEqual({ device: 2, connection: 0 });
  });
});

describe("sourceGroupQueries.findAllWithCounts", () => {
  async function insertGroup(
    name: string,
    filterCriteria: Record<string, unknown> = {},
    sourceTypes: string[] = ["device"],
  ): Promise<string> {
    const [row] = await db
      .insert(sourceGroups)
      .values({
        org_id: ORG,
        name,
        filter_criteria: filterCriteria,
        source_types: sourceTypes,
      } as typeof sourceGroups.$inferInsert)
      .returning();
    return row.id;
  }

  it("returns correct member counts for multiple groups in parallel", async () => {
    await insertSource("sat-1", "device", "Satellite 1");
    await insertSource("sat-2", "device", "Satellite 2");
    await insertSource("gs-1", "device", "Ground Station 1");
    await insertSource("conn-1", "connection", "Connection 1");

    await insertGroup("All Devices", {}, ["device"]);
    await insertGroup("Satellites", { namePattern: "Satellite" }, ["device"]);
    await insertGroup("Connections Only", {}, ["connection"]);

    const results = await sourceGroupQueries.findAllWithCounts(ORG);

    expect(results).toHaveLength(3);
    const byName = (name: string) => results.find((r) => r.name === name);
    expect(byName("All Devices")?.memberCount).toBe(3);
    expect(byName("Satellites")?.memberCount).toBe(2);
    expect(byName("Connections Only")?.memberCount).toBe(1);
  });

  it("returns empty array for an org with no groups", async () => {
    const results = await sourceGroupQueries.findAllWithCounts("empty-org");
    expect(results).toEqual([]);
  });

  it("returns zero member count for a group with no matching sources", async () => {
    await insertSource("dev-1", "device");
    await insertGroup("No Matches", { namePattern: "Nonexistent" }, ["device"]);

    const results = await sourceGroupQueries.findAllWithCounts(ORG);

    expect(results).toHaveLength(1);
    expect(results[0].memberCount).toBe(0);
  });
});

describe("sourceQueries.updateMetadataBatch", () => {
  async function getSource(id: string) {
    const rows = await db
      .select()
      .from(sources)
      .where(eq(sources.id, id))
      .limit(1);
    return rows[0];
  }

  it("merges TLE metadata with existing fields in a single query", async () => {
    await insertSource("sat-1", "device", "Sat 1");
    const [src] = await db.select().from(sources).where(eq(sources.slug, "sat-1")).limit(1);
    await db
      .update(sources)
      .set({ metadata: { foo: "bar", existing: true } })
      .where(eq(sources.id, src.id));

    await sourceQueries.updateMetadataBatch(ORG, [
      {
        id: src.id,
        tle_line1: "1 25544U 98067A 24001.50000000 .00016717",
        tle_line2: "2 25544 51.6400 208.0000 0001234 000.0000 000.0000",
        tle_epoch: "2024-01-01T12:00:00Z",
        official_name: "ISS (ZARYA)",
        tle_source: "celestrak",
      },
    ]);

    const updated = await getSource(src.id);
    const meta = updated.metadata as Record<string, unknown>;
    expect(meta.foo).toBe("bar");
    expect(meta.existing).toBe(true);
    expect(meta.tle_line1).toBe("1 25544U 98067A 24001.50000000 .00016717");
    expect(meta.tle_line2).toBe("2 25544 51.6400 208.0000 0001234 000.0000 000.0000");
    expect(meta.tle_epoch).toBe("2024-01-01T12:00:00Z");
    expect(meta.tle_source).toBe("celestrak");
    expect(meta.official_name).toBe("ISS (ZARYA)");
    expect(meta.tle_fetched_at).toBeDefined();
    expect(updated.name).toBe("ISS (ZARYA)");
  });

  it("handles empty metadata without error", async () => {
    await insertSource("sat-2", "device", "Sat 2");
    const [src] = await db.select().from(sources).where(eq(sources.slug, "sat-2")).limit(1);
    await db
      .update(sources)
      .set({ metadata: {} })
      .where(eq(sources.id, src.id));

    await sourceQueries.updateMetadataBatch(ORG, [
      {
        id: src.id,
        tle_line1: "1 TEST",
        tle_line2: "2 TEST",
        tle_epoch: "2024-06-01T00:00:00Z",
      },
    ]);

    const updated = await getSource(src.id);
    const meta = updated.metadata as Record<string, unknown>;
    expect(meta.tle_line1).toBe("1 TEST");
    expect(meta.tle_line2).toBe("2 TEST");
    expect(meta.tle_epoch).toBe("2024-06-01T00:00:00Z");
  });

  it("updates name when official_name is provided, leaves it unchanged when null", async () => {
    await insertSource("sat-3", "device", "Original Name");
    await insertSource("sat-4", "device", "Keep This Name");
    const [src1] = await db.select().from(sources).where(eq(sources.slug, "sat-3")).limit(1);
    const [src2] = await db.select().from(sources).where(eq(sources.slug, "sat-4")).limit(1);

    await sourceQueries.updateMetadataBatch(ORG, [
      {
        id: src1.id,
        tle_line1: "L1",
        tle_line2: "L2",
        tle_epoch: "2024-01-01T00:00:00Z",
        official_name: "Updated Name",
      },
      {
        id: src2.id,
        tle_line1: "L1b",
        tle_line2: "L2b",
        tle_epoch: "2024-01-01T00:00:00Z",
      },
    ]);

    const updated1 = await getSource(src1.id);
    const updated2 = await getSource(src2.id);
    expect(updated1.name).toBe("Updated Name");
    expect(updated2.name).toBe("Keep This Name");
  });

  it("silently skips nonexistent source IDs", async () => {
    await sourceQueries.updateMetadataBatch(ORG, [
      {
        id: "00000000-0000-0000-0000-000000000099",
        tle_line1: "L1",
        tle_line2: "L2",
        tle_epoch: "2024-01-01T00:00:00Z",
      },
    ]);
  });

  it("handles empty updates array as a no-op", async () => {
    await sourceQueries.updateMetadataBatch(ORG, []);
  });
});
