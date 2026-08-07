import { describe, it, expect } from "vitest";
import {
  buildConnectionQuery,
  joinCastNeeded,
  resolveJoinKey,
  typeClass,
  type BuilderTable,
} from "@/lib/dashboard/connection-query-builder";
import {
  injectConditions,
  substituteVariables,
} from "@/lib/transforms/connection-query";
import { filtersToSqlConditions } from "@/lib/transforms/sql";
import type { TimeRange } from "@/lib/types/dashboard";

// orders.user_id is TEXT while users.id is UUID — the prod failure shape.
const users: BuilderTable = {
  name: "users",
  columns: [
    { name: "id", type: "uuid", isPrimaryKey: true },
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
      type: "text",
      foreignKey: { table: "users", column: "id" },
    },
    { name: "created_at", type: "timestamp with time zone" },
    { name: "amount", type: "numeric" },
  ],
};

describe("typeClass / joinCastNeeded", () => {
  it("classifies common SQL types", () => {
    expect(typeClass("uuid")).toBe("uuid");
    expect(typeClass("character varying(64)")).toBe("text");
    expect(typeClass("BIGINT")).toBe("numeric");
    expect(typeClass("timestamp without time zone")).toBe("time");
    expect(typeClass("boolean")).toBe("bool");
  });

  it("uuid↔text is castable; numeric↔text is incompatible; same type is fine", () => {
    const uuid = { name: "a", type: "uuid" };
    const text = { name: "b", type: "text" };
    const num = { name: "c", type: "integer" };
    expect(joinCastNeeded(uuid, text)).toBe("text");
    expect(joinCastNeeded(text, uuid)).toBe("text");
    expect(joinCastNeeded(num, text)).toBe("incompatible");
    expect(joinCastNeeded(text, { name: "d", type: "varchar" })).toBeNull();
    expect(joinCastNeeded(undefined, text)).toBeNull();
  });
});

describe("resolveJoinKey type safety", () => {
  it("FK-declared joins pass through even with mismatched types", () => {
    expect(resolveJoinKey(orders, users)).toEqual({
      localColumn: "user_id",
      foreignColumn: "id",
    });
  });

  it("refuses name-matched auto-joins with incompatible types", () => {
    const a: BuilderTable = {
      name: "a",
      columns: [{ name: "batch_no", type: "integer" }],
    };
    const b: BuilderTable = {
      name: "b",
      columns: [{ name: "batch_no", type: "text" }],
    };
    expect(resolveJoinKey(a, b)).toBeNull();
  });

  it("still auto-joins uuid↔text name matches (castable)", () => {
    const a: BuilderTable = {
      name: "a",
      columns: [{ name: "sat_id", type: "text" }],
    };
    const b: BuilderTable = {
      name: "b",
      columns: [{ name: "sat_id", type: "uuid" }],
    };
    expect(resolveJoinKey(a, b)).toEqual({
      localColumn: "sat_id",
      foreignColumn: "sat_id",
    });
  });
});

describe("join emission with $__text casts", () => {
  const joined = {
    tables: [orders, users],
    base: "orders",
    joins: [{ table: "users", localColumn: "user_id", foreignColumn: "id" }],
    timeCol: "created_at",
    measures: ["amount"],
    countMode: false,
  };

  it("mismatched join keys compare through $__text on both sides", () => {
    const sql = buildConnectionQuery(joined);
    expect(sql).toContain(
      "JOIN users ON $__text(orders.user_id) = $__text(users.id)",
    );
  });

  it("matched join keys stay uncast (historical emission)", () => {
    const textUsers: BuilderTable = {
      ...users,
      columns: users.columns.map((c) =>
        c.name === "id" ? { ...c, type: "text" } : c,
      ),
    };
    const sql = buildConnectionQuery({
      ...joined,
      tables: [orders, textUsers],
    });
    expect(sql).toContain("JOIN users ON orders.user_id = users.id");
  });

  it("$__text expands per dialect", () => {
    const q = "SELECT 1 FROM a JOIN b ON $__text(a.x) = $__text(b.y)";
    expect(substituteVariables(q, {}, undefined, "postgres").sql).toBe(
      "SELECT 1 FROM a JOIN b ON (a.x)::text = (b.y)::text",
    );
    expect(substituteVariables(q, {}, undefined, "clickhouse").sql).toBe(
      "SELECT 1 FROM a JOIN b ON toString(a.x) = toString(b.y)",
    );
  });
});

describe("LIKE filters cast to text", () => {
  it("postgres string ops wrap the column in ::text; equality stays bare", () => {
    const { sql } = filtersToSqlConditions(
      [
        { field: "sat_id", operator: "contains", value: "abc" },
        { field: "status", operator: "=", value: "ok" },
      ],
      1,
      "postgres",
    );
    expect(sql).toBe('"sat_id"::text LIKE $1 AND "status" = $2');
  });

  it("clickhouse uses toString", () => {
    const { sql } = filtersToSqlConditions(
      [{ field: "sat_id", operator: "startsWith", value: "x" }],
      1,
      "clickhouse",
    );
    expect(sql).toBe('toString("sat_id") LIKE $1');
  });
});

describe("double-bucket skip (alreadyAggregated)", () => {
  const timeRange: TimeRange = { type: "relative", value: "30d" };
  const bucketed = buildConnectionQuery({
    tables: [users],
    base: "users",
    joins: [],
    timeCol: "created_at",
    measures: [],
    countMode: true,
    bucket: "hour",
  });

  it("builder-bucketed queries skip the outer max() wrap", () => {
    const sub = substituteVariables(bucketed, {}, timeRange, "postgres");
    expect(sub.hadTimeGroup).toBe(true);
    const injected = injectConditions(sub.sql, {
      timeRange,
      timeColumn: "created_at",
      valueColumn: "count",
      timeAlreadyFiltered: sub.hadTimeMacro,
      alreadyAggregated: sub.hadTimeGroup,
      dialect: "postgres",
    });
    expect(injected.sql).not.toContain("max(");
    // Still gets deterministic ordering via the CTE wrap.
    expect(injected.sql).toContain("ORDER BY");
  });

  it("legacy raw-select panels with a valueColumn keep the auto-bucket layer", () => {
    const raw = 'SELECT created_at, amount FROM orders WHERE "created_at" >= NOW()';
    const injected = injectConditions(raw, {
      timeRange,
      timeColumn: "created_at",
      valueColumn: "amount",
      timeAlreadyFiltered: true,
      alreadyAggregated: false,
      dialect: "postgres",
    });
    expect(injected.sql).toContain('max("amount")');
  });
});
