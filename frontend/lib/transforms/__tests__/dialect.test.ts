import { describe, it, expect } from "vitest";
import {
  substituteVariables,
  injectConditions,
  dialectForConnectionType,
} from "@/lib/transforms/connection-query";
import { filtersToSqlConditions } from "@/lib/transforms/sql";
import type { TimeRange } from "@/lib/types/dashboard";

const RANGE_24H: TimeRange = { type: "relative", value: "24h" };

describe("dialectForConnectionType", () => {
  it("maps each connection type to the right macro dialect", () => {
    expect(dialectForConnectionType("clickhouse")).toBe("clickhouse");
    expect(dialectForConnectionType("mysql")).toBe("mysql");
    expect(dialectForConnectionType("postgres")).toBe("postgres");
    expect(dialectForConnectionType("timescaledb")).toBe("postgres");
    // Non-SQL stores fall through to the harmless Postgres default.
    expect(dialectForConnectionType("influxdb")).toBe("postgres");
    expect(dialectForConnectionType(null)).toBe("postgres");
  });
});

describe("$__timeFilter macro renders per dialect", () => {
  const query = "SELECT * FROM t WHERE $__timeFilter(ts)";

  it("ClickHouse gets unquoted INTERVAL (not the Postgres literal — the bug)", () => {
    const { sql } = substituteVariables(query, {}, RANGE_24H, "clickhouse");
    expect(sql).toContain("INTERVAL 24 HOUR");
    expect(sql).not.toContain("INTERVAL '24 hours'");
    expect(sql).toContain('"ts"'); // ClickHouse accepts double-quoted idents
  });

  it("MySQL gets backtick identifiers and unquoted INTERVAL", () => {
    const { sql } = substituteVariables(query, {}, RANGE_24H, "mysql");
    expect(sql).toContain("INTERVAL 24 HOUR");
    expect(sql).toContain("`ts`");
    expect(sql).not.toContain('"ts"');
  });

  it("Postgres keeps its quoted-literal INTERVAL", () => {
    const { sql } = substituteVariables(query, {}, RANGE_24H, "postgres");
    expect(sql).toContain("INTERVAL '24 hours'");
    expect(sql).toContain('"ts"');
  });
});

describe("injectConditions time bucketing per dialect", () => {
  const base = "SELECT ts, value FROM t";
  const opts = {
    timeRange: { type: "relative", value: "30d" } as TimeRange,
    timeColumn: "ts",
    valueColumn: "value",
  };

  it("MySQL buckets with epoch floor and backtick identifiers", () => {
    const { sql } = injectConditions(base, { ...opts, dialect: "mysql" });
    expect(sql).toContain("FROM_UNIXTIME");
    expect(sql).toContain("`ts`");
    expect(sql).not.toContain("to_timestamp");
  });

  it("ClickHouse buckets with toStartOfInterval", () => {
    const { sql } = injectConditions(base, { ...opts, dialect: "clickhouse" });
    expect(sql).toContain("toStartOfInterval");
  });

  it("Postgres buckets with to_timestamp/epoch", () => {
    const { sql } = injectConditions(base, { ...opts, dialect: "postgres" });
    expect(sql).toContain("to_timestamp");
  });
});

describe("filtersToSqlConditions casts and quotes per dialect", () => {
  const filters = [
    { field: "name", operator: "contains", value: "abc", enabled: true },
  ] as Parameters<typeof filtersToSqlConditions>[0];

  it("MySQL uses backticks and CAST(... AS CHAR)", () => {
    const { sql } = filtersToSqlConditions(filters, 1, "mysql");
    expect(sql).toContain("`name`");
    expect(sql).toContain("CAST(`name` AS CHAR)");
  });

  it("ClickHouse uses toString()", () => {
    const { sql } = filtersToSqlConditions(filters, 1, "clickhouse");
    expect(sql).toContain('toString("name")');
  });

  it("Postgres uses ::text", () => {
    const { sql } = filtersToSqlConditions(filters, 1, "postgres");
    expect(sql).toContain('"name"::text');
  });
});
