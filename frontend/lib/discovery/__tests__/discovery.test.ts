import { describe, it, expect } from "vitest";
import { buildDistinctIdentitySql, buildFreshnessSql } from "../sql";
import { slugForIdentity } from "../identity";
import { discoveryRulesOf } from "../types";

describe("buildDistinctIdentitySql", () => {
  it("quotes identifiers per dialect", () => {
    expect(
      buildDistinctIdentitySql("postgres", {
        table: "flights",
        idColumn: "drone_id",
      }),
    ).toBe(
      'SELECT DISTINCT "drone_id" AS plexus_id FROM "flights" WHERE "drone_id" IS NOT NULL LIMIT 1000',
    );
    expect(
      buildDistinctIdentitySql("mysql", {
        table: "flights",
        idColumn: "drone_id",
      }),
    ).toBe(
      "SELECT DISTINCT `drone_id` AS plexus_id FROM `flights` WHERE `drone_id` IS NOT NULL LIMIT 1000",
    );
  });

  it("includes the schema and custom limit", () => {
    expect(
      buildDistinctIdentitySql(
        "postgres",
        { table: "flights", schema: "ops", idColumn: "drone_id" },
        50,
      ),
    ).toBe(
      'SELECT DISTINCT "drone_id" AS plexus_id FROM "ops"."flights" WHERE "drone_id" IS NOT NULL LIMIT 50',
    );
  });

  it("rejects unquotable identifiers", () => {
    expect(() =>
      buildDistinctIdentitySql("postgres", {
        table: "flights",
        idColumn: "bad\0col",
      }),
    ).toThrow();
  });

  it("escapes embedded quotes rather than breaking out", () => {
    const sql = buildDistinctIdentitySql("postgres", {
      table: 'fli"ghts',
      idColumn: 'dro"ne',
    });
    expect(sql).toContain('"fli""ghts"');
    expect(sql).toContain('"dro""ne"');
  });
});

describe("buildFreshnessSql", () => {
  it("groups by identity with MAX(time)", () => {
    expect(
      buildFreshnessSql("clickhouse", {
        table: "flights",
        idColumn: "drone_id",
        timeColumn: "ts",
      }),
    ).toBe(
      "SELECT `drone_id` AS plexus_id, MAX(`ts`) AS last_seen FROM `flights` WHERE `drone_id` IS NOT NULL GROUP BY `drone_id` LIMIT 1000",
    );
  });
});

describe("slugForIdentity", () => {
  it("slugifies ordinary values deterministically", () => {
    expect(slugForIdentity("Drone 7")).toBe("drone-7");
    expect(slugForIdentity("drone-7")).toBe("drone-7");
    expect(slugForIdentity("API_Server.EU")).toBe("api_server.eu");
  });

  it("hashes uuid-shaped and unsluggable values", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    expect(slugForIdentity(uuid)).toMatch(/^d-[0-9a-f]{8}$/);
    expect(slugForIdentity("!!!")).toMatch(/^d-[0-9a-f]{8}$/);
    // Deterministic — re-discovery converges on the same slug.
    expect(slugForIdentity(uuid)).toBe(slugForIdentity(uuid));
    expect(slugForIdentity("北京-drone")).toBe(slugForIdentity("北京-drone"));
  });

  it("prefixes satellite-kind identities with the app-wide sat- convention", () => {
    expect(slugForIdentity("25544", "satellite")).toBe("sat-25544");
    // Already-prefixed values converge, not double-prefix.
    expect(slugForIdentity("sat-25544", "satellite")).toBe("sat-25544");
    // Other kinds stay unprefixed.
    expect(slugForIdentity("pump-3", "asset")).toBe("pump-3");
  });

  it("caps length at 63", () => {
    expect(slugForIdentity("a".repeat(200)).length).toBeLessThanOrEqual(63);
  });
});

describe("discoveryRulesOf", () => {
  it("returns valid rules and drops malformed entries", () => {
    const rules = discoveryRulesOf({
      discovery: [
        { table: "flights", idColumn: "drone_id", kind: "device", enabled: true },
        { table: 42, idColumn: "x", kind: "device" },
        null,
        "nope",
      ],
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]!.table).toBe("flights");
  });

  it("handles missing/invalid config", () => {
    expect(discoveryRulesOf(null)).toEqual([]);
    expect(discoveryRulesOf({})).toEqual([]);
    expect(discoveryRulesOf({ discovery: "x" })).toEqual([]);
  });
});
