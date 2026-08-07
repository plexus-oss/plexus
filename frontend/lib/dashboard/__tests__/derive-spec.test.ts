import { describe, it, expect } from "vitest";
import {
  isBuilderAuthoritative,
  parseBaseTable,
  specFromDataSource,
} from "@/lib/dashboard/derive-spec";
import {
  deriveConnectionFields,
  type BuilderTable,
} from "@/lib/dashboard/connection-query-builder";
import { materializeConnectionDataSource } from "@/lib/dashboard/suggest";
import type { ConnectionDataSource } from "@/lib/types/dashboard";

const users: BuilderTable = {
  name: "users",
  columns: [
    { name: "id", type: "integer", isPrimaryKey: true },
    { name: "created_at", type: "timestamp with time zone" },
    { name: "plan", type: "text" },
  ],
};

const orders: BuilderTable = {
  name: "orders",
  columns: [
    { name: "id", type: "integer", isPrimaryKey: true },
    {
      name: "user_id",
      type: "integer",
      foreignKey: { table: "users", column: "id" },
    },
    { name: "created_at", type: "timestamp with time zone" },
    { name: "amount", type: "numeric" },
    { name: "tax", type: "numeric" },
  ],
};

const TABLES = [users, orders];

/** Build a data source exactly the way the LEGACY visual builder did
 *  (applyConnection: deriveConnectionFields + hint fields, no builder). */
function legacyDs(selection: {
  base: string;
  joins: { table: string; localColumn: string; foreignColumn: string }[];
  measures: string[];
  seriesColumn?: string;
}): ConnectionDataSource {
  const derived = deriveConnectionFields(TABLES, selection);
  return {
    type: "connection",
    sourceId: "src-1",
    query: derived.query,
    timeColumn: derived.timeColumn,
    valueColumn: derived.valueColumn,
    seriesColumn: selection.seriesColumn,
    selectedColumns: selection.measures,
    joins: selection.joins.length ? selection.joins : undefined,
    seriesTableMap: derived.seriesTableMap,
    breakdownTable: derived.breakdownTable,
    customQuery: false,
  };
}

describe("parseBaseTable", () => {
  it("SELECT and Flux forms", () => {
    expect(parseBaseTable("SELECT * FROM users WHERE x")).toBe("users");
    expect(parseBaseTable('|> filter(fn: (r) => r["_measurement"] == "cpu")')).toBe(
      "cpu",
    );
    expect(parseBaseTable("WITH x AS (SELECT 1) SELECT * FROM x")).toBe("x");
    expect(parseBaseTable(undefined)).toBeNull();
  });
});

describe("specFromDataSource — builder-backed panels", () => {
  const built = materializeConnectionDataSource(
    "src-1",
    {
      version: 1,
      table: "users",
      aggregate: { fn: "count" },
      bucket: "day",
    },
    [users],
  );

  it("authoritative builder → spec, origin builder", () => {
    const derived = specFromDataSource(built, [users]);
    expect(derived?.origin).toBe("builder");
    expect(derived?.spec.aggregate.fn).toBe("count");
    expect(derived?.spec.bucket).toBe("day");
    expect(isBuilderAuthoritative(built)).toBe(true);
  });

  it("drifted builder (out-of-band SQL edit) → null", () => {
    const drifted = { ...built, query: built.query + " LIMIT 5" };
    expect(specFromDataSource(drifted, [users])).toBeNull();
    expect(isBuilderAuthoritative(drifted)).toBe(false);
  });

  it("customQuery → null regardless of builder", () => {
    expect(
      specFromDataSource({ ...built, customQuery: true }, [users]),
    ).toBeNull();
  });
});

describe("specFromDataSource — legacy reconstruction", () => {
  it("legacy count panel reconstructs and round-trips", () => {
    const ds = legacyDs({ base: "users", joins: [], measures: [] });
    expect(ds.valueColumn).toBe("count"); // sanity: users has no measures
    const derived = specFromDataSource(ds, TABLES);
    expect(derived?.origin).toBe("hints");
    expect(derived?.spec).toMatchObject({
      table: "users",
      timeColumn: "created_at",
      aggregate: { fn: "count" },
      bucket: "auto",
    });
  });

  it("legacy raw multi-measure + join + breakdown reconstructs", () => {
    const ds = legacyDs({
      base: "orders",
      joins: [{ table: "users", localColumn: "user_id", foreignColumn: "id" }],
      measures: ["amount", "tax"],
      seriesColumn: "plan",
    });
    const derived = specFromDataSource(ds, TABLES);
    expect(derived?.origin).toBe("hints");
    expect(derived?.spec).toMatchObject({
      table: "orders",
      aggregate: { fn: "raw", columns: ["amount", "tax"] },
      groupBy: "plan",
    });
    expect(derived?.spec.joins).toHaveLength(1);
  });

  it("legacy raw with empty picks (plot-all default) reconstructs", () => {
    const ds = legacyDs({ base: "orders", joins: [], measures: [] });
    const derived = specFromDataSource(ds, TABLES);
    expect(derived?.origin).toBe("hints");
    expect(derived?.spec.aggregate).toEqual({ fn: "raw", columns: undefined });
  });

  it("hand-written SQL without the customQuery flag fails round-trip → null", () => {
    const ds: ConnectionDataSource = {
      type: "connection",
      sourceId: "src-1",
      query: "SELECT plan, count(*) FROM users GROUP BY plan",
      timeColumn: "created_at",
      customQuery: false,
    };
    expect(specFromDataSource(ds, TABLES)).toBeNull();
  });

  it("editing a reconstructed spec regenerates equivalent SQL", () => {
    const ds = legacyDs({ base: "users", joins: [], measures: [] });
    const derived = specFromDataSource(ds, TABLES)!;
    // User flips the bucket to day → materializes cleanly from the spec.
    const next = materializeConnectionDataSource(
      ds.sourceId,
      { ...derived.spec, bucket: "day" },
      TABLES,
    );
    expect(next.query).toContain("$__timeGroup(users.created_at, 'day')");
    expect(next.builder?.generatedQuery).toBe(next.query);
  });
});
