/**
 * End-to-end discovery pipeline against a real Postgres: the test database
 * plays the "customer DB" (a seeded flights table) AND the control plane.
 * Exercises the true path: rule → driver executeQuery (real connection) →
 * DISTINCT → mint sources → association upsert → metadata mirror → freshness.
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sources } from "@/lib/db/schema";
import { sourceAssociationQueries } from "@/lib/db/queries/sources";

const ORG = "discover-e2e-org";
const TEST_URL = `${
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/plexus_test"
}?sslmode=disable`;

// encrypt() reads env lazily — inject a throwaway 32-byte key for this worker.
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

describe("discoverOnce end-to-end (real Postgres driver path)", () => {
  it("mints entities, associations, mirror metadata, and freshness", async () => {
    // Seed inside the test — the global beforeEach truncates every table.
    await db.execute(sql`DROP TABLE IF EXISTS e2e_flights`);
    await db.execute(sql`
      CREATE TABLE e2e_flights (
        drone_id text NOT NULL,
        ts timestamptz NOT NULL,
        altitude double precision
      )`);
    await db.execute(sql`
      INSERT INTO e2e_flights (drone_id, ts, altitude) VALUES
        ('Drone 7',  now() - interval '5 minutes', 120.5),
        ('Drone 7',  now() - interval '1 minute',  130.1),
        ('drone-9',  now() - interval '2 hours',   88.0),
        ('ground-1', now() - interval '10 days',   0.0)`);

    const { encrypt } = await import("@/lib/encryption");
    const { discoverOnce } = await import("../discover");

    await db.insert(sources).values({
      org_id: ORG,
      slug: "e2e-fleet-db",
      source_type: "connection",
      connection_type: "postgres",
      name: "Fleet DB",
      status: "online",
      credentials_encrypted: encrypt(TEST_URL),
      config: {
        discovery: [
          {
            table: "e2e_flights",
            idColumn: "drone_id",
            timeColumn: "ts",
            kind: "device",
            enabled: true,
          },
        ],
      },
      metadata: {},
      tags: [],
      is_telemetry_store: false,
      visibility: "org",
    } as typeof sources.$inferInsert);

    const stats = await discoverOnce();
    expect(stats.errors).toBe(0);
    expect(stats.discovered).toBeGreaterThanOrEqual(3);

    // Slugified entities exist with the right kind and raw names.
    const rows = await db
      .select()
      .from(sources)
      .where(sql`org_id = ${ORG} AND source_type = 'device'`);
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    expect(bySlug.has("drone-7")).toBe(true);
    expect(bySlug.has("drone-9")).toBe(true);
    expect(bySlug.has("ground-1")).toBe(true);
    expect(bySlug.get("drone-7")!.name).toBe("Drone 7");
    expect(bySlug.get("drone-7")!.device_type).toBe("device");

    // Association carries the slice predicate with the RAW value.
    const assoc = await sourceAssociationQueries.findByEntity(
      ORG,
      bySlug.get("drone-7")!.id as string,
    );
    expect(assoc).toHaveLength(1);
    expect(assoc[0]).toMatchObject({
      table_name: "e2e_flights",
      filter_column: "drone_id",
      filter_value: "Drone 7",
    });

    // Metadata mirror for legacy readers.
    const meta = bySlug.get("drone-7")!.metadata as {
      linked_connections?: Array<{ filter_value: string }>;
      discovered_from?: string;
    };
    expect(meta.linked_connections?.[0]?.filter_value).toBe("Drone 7");
    expect(meta.discovered_from).toBeTruthy();

    // Freshness: recent drones have last_seen_at near now; the stale one is old.
    const fresh = new Date(bySlug.get("drone-7")!.last_seen_at as string);
    expect(Date.now() - fresh.getTime()).toBeLessThan(10 * 60 * 1000);
    const stale = new Date(bySlug.get("ground-1")!.last_seen_at as string);
    expect(Date.now() - stale.getTime()).toBeGreaterThan(24 * 60 * 60 * 1000);

    // Re-running discovers nothing new (idempotent) and keeps one association.
    const again = await discoverOnce();
    expect(again.discovered).toBe(0);
    expect(again.errors).toBe(0);
    expect(
      await sourceAssociationQueries.findByEntity(
        ORG,
        bySlug.get("drone-7")!.id as string,
      ),
    ).toHaveLength(1);
  });
});
