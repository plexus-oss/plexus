import { describe, it, expect } from "vitest";
import {
  buildConnectionQuery,
  deriveConnectionFields,
  resolveJoinKey,
  type BuilderTable,
} from "@/lib/dashboard/connection-query-builder";
import {
  substituteVariables,
  injectConditions,
} from "@/lib/transforms/connection-query";
import type { TimeRange } from "@/lib/types/dashboard";

const users: BuilderTable = {
  name: "users",
  columns: [
    { name: "id", type: "integer", isPrimaryKey: true },
    { name: "created_at", type: "timestamp with time zone" },
    { name: "email", type: "text" },
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
    { name: "status", type: "text" },
  ],
};

const TABLES = [users, orders];

describe("buildConnectionQuery — byte-identical to the pre-extraction builder", () => {
  it("no time column → bare SELECT *", () => {
    const sql = buildConnectionQuery({
      tables: [{ name: "notime", columns: [{ name: "x", type: "text" }] }],
      base: "notime",
      joins: [],
      timeCol: undefined,
      measures: [],
      countMode: true,
    });
    expect(sql).toBe("SELECT * FROM notime");
  });

  it("count mode (users per bucket — the happy path)", () => {
    const sql = buildConnectionQuery({
      tables: TABLES,
      base: "users",
      joins: [],
      timeCol: "created_at",
      measures: [],
      countMode: true,
    });
    expect(sql).toBe(
      "SELECT $__timeGroup(users.created_at) AS created_at, count(*) AS count" +
        " FROM users" +
        " WHERE $__timeFilter(users.created_at)" +
        " GROUP BY $__timeGroup(users.created_at)" +
        " ORDER BY $__timeGroup(users.created_at)",
    );
  });

  it("count mode with breakdown column", () => {
    const sql = buildConnectionQuery({
      tables: TABLES,
      base: "users",
      joins: [],
      timeCol: "created_at",
      measures: [],
      seriesColumn: "plan",
      countMode: true,
    });
    expect(sql).toBe(
      "SELECT $__timeGroup(users.created_at) AS created_at, users.plan, count(*) AS count" +
        " FROM users" +
        " WHERE $__timeFilter(users.created_at)" +
        " GROUP BY $__timeGroup(users.created_at), users.plan" +
        " ORDER BY $__timeGroup(users.created_at)",
    );
  });

  it("raw measures (historical non-aggregated select)", () => {
    const sql = buildConnectionQuery({
      tables: TABLES,
      base: "orders",
      joins: [],
      timeCol: "created_at",
      measures: ["amount"],
      countMode: false,
    });
    expect(sql).toBe(
      "SELECT orders.created_at AS created_at, orders.amount" +
        " FROM orders" +
        " WHERE $__timeFilter(orders.created_at)" +
        " ORDER BY orders.created_at",
    );
  });

  it("join + breakdown, columns qualified by owning table", () => {
    const sql = buildConnectionQuery({
      tables: TABLES,
      base: "orders",
      joins: [{ table: "users", localColumn: "user_id", foreignColumn: "id" }],
      timeCol: "created_at",
      measures: ["amount"],
      seriesColumn: "plan",
      countMode: false,
    });
    expect(sql).toBe(
      "SELECT orders.created_at AS created_at, users.plan, orders.amount" +
        " FROM orders JOIN users ON orders.user_id = users.id" +
        " WHERE $__timeFilter(orders.created_at)" +
        " ORDER BY orders.created_at",
    );
  });

  it("measureAgg buckets measures with $__timeGroup (new, additive)", () => {
    const sql = buildConnectionQuery({
      tables: TABLES,
      base: "orders",
      joins: [{ table: "users", localColumn: "user_id", foreignColumn: "id" }],
      timeCol: "created_at",
      measures: ["amount"],
      seriesColumn: "plan",
      countMode: false,
      measureAgg: "avg",
    });
    expect(sql).toBe(
      "SELECT $__timeGroup(orders.created_at) AS created_at, users.plan, avg(orders.amount) AS amount" +
        " FROM orders JOIN users ON orders.user_id = users.id" +
        " WHERE $__timeFilter(orders.created_at)" +
        " GROUP BY $__timeGroup(orders.created_at), users.plan" +
        " ORDER BY $__timeGroup(orders.created_at)",
    );
  });
});

describe("buildConnectionQuery — entityFilter (discovered-entity slice)", () => {
  const devices: BuilderTable = {
    name: "telemetry",
    columns: [
      { name: "recorded_at", type: "timestamp with time zone" },
      { name: "drone_id", type: "text" },
      { name: "battery", type: "numeric" },
    ],
  };

  it("absent → byte-identical to the pinned historical output", () => {
    const opts = {
      tables: [devices],
      base: "telemetry",
      joins: [],
      timeCol: "recorded_at",
      measures: [],
      countMode: true,
    };
    const pinned =
      "SELECT $__timeGroup(telemetry.recorded_at) AS recorded_at, count(*) AS count" +
      " FROM telemetry" +
      " WHERE $__timeFilter(telemetry.recorded_at)" +
      " GROUP BY $__timeGroup(telemetry.recorded_at)" +
      " ORDER BY $__timeGroup(telemetry.recorded_at)";
    expect(buildConnectionQuery(opts)).toBe(pinned);
    expect(buildConnectionQuery({ ...opts, entityFilter: undefined })).toBe(
      pinned,
    );
  });

  it("count mode appends the predicate after $__timeFilter", () => {
    const sql = buildConnectionQuery({
      tables: [devices],
      base: "telemetry",
      joins: [],
      timeCol: "recorded_at",
      measures: [],
      countMode: true,
      entityFilter: { column: "drone_id", value: "7" },
    });
    expect(sql).toBe(
      "SELECT $__timeGroup(telemetry.recorded_at) AS recorded_at, count(*) AS count" +
        " FROM telemetry" +
        " WHERE $__timeFilter(telemetry.recorded_at) AND telemetry.drone_id = '7'" +
        " GROUP BY $__timeGroup(telemetry.recorded_at)" +
        " ORDER BY $__timeGroup(telemetry.recorded_at)",
    );
  });

  it("measureAgg mode appends the predicate", () => {
    const sql = buildConnectionQuery({
      tables: [devices],
      base: "telemetry",
      joins: [],
      timeCol: "recorded_at",
      measures: ["battery"],
      countMode: false,
      measureAgg: "avg",
      entityFilter: { column: "drone_id", value: "7" },
    });
    expect(sql).toContain(
      " WHERE $__timeFilter(telemetry.recorded_at) AND telemetry.drone_id = '7' GROUP BY",
    );
  });

  it("raw measures mode appends the predicate", () => {
    const sql = buildConnectionQuery({
      tables: [devices],
      base: "telemetry",
      joins: [],
      timeCol: "recorded_at",
      measures: ["battery"],
      countMode: false,
      entityFilter: { column: "drone_id", value: "7" },
    });
    expect(sql).toBe(
      "SELECT telemetry.recorded_at AS recorded_at, telemetry.battery" +
        " FROM telemetry" +
        " WHERE $__timeFilter(telemetry.recorded_at) AND telemetry.drone_id = '7'" +
        " ORDER BY telemetry.recorded_at",
    );
  });

  it("no time column → predicate still scopes the raw SELECT", () => {
    const lookup: BuilderTable = {
      name: "lookup",
      columns: [
        { name: "code", type: "text" },
        { name: "drone_id", type: "text" },
      ],
    };
    const sql = buildConnectionQuery({
      tables: [lookup],
      base: "lookup",
      joins: [],
      timeCol: undefined,
      measures: [],
      countMode: true,
      entityFilter: { column: "drone_id", value: "7" },
    });
    expect(sql).toBe("SELECT * FROM lookup WHERE lookup.drone_id = '7'");
  });

  it("single quotes in the value are doubled", () => {
    const sql = buildConnectionQuery({
      tables: [devices],
      base: "telemetry",
      joins: [],
      timeCol: "recorded_at",
      measures: [],
      countMode: true,
      entityFilter: { column: "drone_id", value: "o'brien" },
    });
    expect(sql).toContain("telemetry.drone_id = 'o''brien'");
  });

  it("expanded SQL survives the macro pipeline with the predicate intact", () => {
    const sql = buildConnectionQuery({
      tables: [devices],
      base: "telemetry",
      joins: [],
      timeCol: "recorded_at",
      measures: [],
      countMode: true,
      entityFilter: { column: "drone_id", value: "7" },
    });
    const { sql: expanded } = substituteVariables(
      sql,
      {},
      { type: "relative", value: "24h" },
      "postgres",
    );
    expect(expanded).not.toContain("$__");
    expect(expanded).toContain("telemetry.drone_id = '7'");
  });
});

describe("deriveConnectionFields", () => {
  it("no numeric measures → count mode with valueColumn 'count'", () => {
    const derived = deriveConnectionFields(TABLES, {
      base: "users",
      joins: [],
      measures: [],
    });
    expect(derived.countMode).toBe(true);
    expect(derived.timeColumn).toBe("created_at");
    expect(derived.valueColumn).toBe("count");
    expect(derived.seriesTableMap).toEqual({ count: "users" });
    expect(derived.breakdownTable).toBeUndefined();
  });

  it("single measure → valueColumn is that measure; series maps to owner", () => {
    const derived = deriveConnectionFields(TABLES, {
      base: "orders",
      joins: [{ table: "users", localColumn: "user_id", foreignColumn: "id" }],
      measures: ["amount"],
      seriesColumn: "plan",
    });
    expect(derived.countMode).toBe(false);
    expect(derived.valueColumn).toBe("amount");
    expect(derived.seriesTableMap).toEqual({ amount: "orders" });
    expect(derived.breakdownTable).toBe("users");
  });

  it("empty measures with measures available → plots all available", () => {
    const derived = deriveConnectionFields(TABLES, {
      base: "orders",
      joins: [],
      measures: [],
    });
    expect(derived.countMode).toBe(false);
    expect(derived.query).toContain("orders.amount");
  });
});

describe("resolveJoinKey", () => {
  it("prefers a declared foreign key", () => {
    expect(resolveJoinKey(orders, users)).toEqual({
      localColumn: "user_id",
      foreignColumn: "id",
    });
  });

  it("reverse foreign key (base is the referenced table)", () => {
    expect(resolveJoinKey(users, orders)).toEqual({
      localColumn: "id",
      foreignColumn: "user_id",
    });
  });

  it("falls back to a shared key-named column", () => {
    const a: BuilderTable = {
      name: "a",
      columns: [{ name: "orbit_id", type: "integer" }],
    };
    const b: BuilderTable = {
      name: "b",
      columns: [{ name: "orbit_id", type: "integer" }],
    };
    expect(resolveJoinKey(a, b)).toEqual({
      localColumn: "orbit_id",
      foreignColumn: "orbit_id",
    });
  });
});

describe("shared-route compatibility — emitted SQL survives the macro pipeline", () => {
  const timeRange: TimeRange = { type: "relative", value: "24h" };

  it("substituteVariables expands every macro the builder emits", () => {
    const sql = buildConnectionQuery({
      tables: TABLES,
      base: "users",
      joins: [],
      timeCol: "created_at",
      measures: [],
      countMode: true,
    });
    const { sql: expanded, hadTimeMacro } = substituteVariables(
      sql,
      {},
      timeRange,
      "postgres",
    );
    expect(hadTimeMacro).toBe(true);
    expect(expanded).not.toContain("$__");
  });

  it("injectConditions accepts the expanded query without throwing", () => {
    const sql = buildConnectionQuery({
      tables: TABLES,
      base: "orders",
      joins: [],
      timeCol: "created_at",
      measures: ["amount"],
      countMode: false,
      measureAgg: "sum",
    });
    const { sql: expanded } = substituteVariables(sql, {}, timeRange, "postgres");
    const injected = injectConditions(expanded, {
      timeRange,
      timeColumn: "created_at",
      timeAlreadyFiltered: true,
      dialect: "postgres",
    });
    expect(injected.sql.length).toBeGreaterThan(0);
    expect(injected.sql).not.toContain("$__");
  });
});
