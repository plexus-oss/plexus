import { describe, it, expect } from "vitest";
import {
  materializeConnectionDataSource,
  suggestPanelsForTable,
} from "@/lib/dashboard/suggest";
import type { BuilderTable } from "@/lib/dashboard/connection-query-builder";
import { substituteVariables } from "@/lib/transforms/connection-query";
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
    { name: "created_at", type: "timestamp with time zone" },
    { name: "amount", type: "numeric" },
  ],
};

describe("materializeConnectionDataSource", () => {
  it("count intent counts rows even when measures exist (intent beats inference)", () => {
    const ds = materializeConnectionDataSource(
      "src-1",
      {
        version: 1,
        table: "orders",
        aggregate: { fn: "count" },
        bucket: "day",
      },
      [orders],
    );
    expect(ds.query).toBe(
      "SELECT $__timeGroup(orders.created_at, 'day') AS created_at, count(*) AS count" +
        " FROM orders" +
        " WHERE $__timeFilter(orders.created_at)" +
        " GROUP BY $__timeGroup(orders.created_at, 'day')" +
        " ORDER BY $__timeGroup(orders.created_at, 'day')",
    );
    expect(ds.valueColumn).toBe("count");
    expect(ds.customQuery).toBe(false);
    expect(ds.builder?.generatedQuery).toBe(ds.query);
    expect(ds.builder?.timeColumn).toBe("created_at");
  });

  it("avg intent buckets the measure", () => {
    const ds = materializeConnectionDataSource(
      "src-1",
      {
        version: 1,
        table: "orders",
        aggregate: { fn: "avg", column: "amount" },
        bucket: "day",
      },
      [orders],
    );
    expect(ds.query).toContain("avg(orders.amount) AS amount");
    expect(ds.valueColumn).toBe("amount");
    expect(ds.selectedColumns).toEqual(["amount"]);
  });

  it("auto bucket keeps the range-sized $__timeGroup form", () => {
    const ds = materializeConnectionDataSource(
      "src-1",
      {
        version: 1,
        table: "users",
        aggregate: { fn: "count" },
        bucket: "auto",
      },
      [users],
    );
    expect(ds.query).toContain("$__timeGroup(users.created_at)");
    expect(ds.query).not.toContain("'auto'");
  });
});

describe("suggestPanelsForTable", () => {
  it("users table → 'Users per day' count-bar first", () => {
    const [first] = suggestPanelsForTable(users, "src-1");
    expect(first.title).toBe("Users per day");
    expect(first.panelType).toBe("bar");
    expect(first.dataSource.builder?.aggregate.fn).toBe("count");
    expect(first.dataSource.query).toContain("count(*)");
  });

  it("table with measures also suggests avg lines", () => {
    const suggestions = suggestPanelsForTable(orders, "src-1");
    expect(suggestions[0].dataSource.builder?.aggregate.fn).toBe("count");
    const avg = suggestions.find(
      (s) => s.dataSource.builder?.aggregate.fn === "avg",
    );
    expect(avg?.panelType).toBe("line");
    expect(avg?.dataSource.builder?.aggregate.column).toBe("amount");
  });

  it("no time column → raw datagrid fallback", () => {
    const lookup: BuilderTable = {
      name: "lookup",
      columns: [{ name: "code", type: "text" }],
    };
    const suggestions = suggestPanelsForTable(lookup, "src-1");
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].panelType).toBe("datagrid");
    expect(suggestions[0].dataSource.query).toBe("SELECT * FROM lookup");
  });
});

describe("entityFilter threading (discovered-entity slice)", () => {
  const telemetry: BuilderTable = {
    name: "telemetry",
    columns: [
      { name: "recorded_at", type: "timestamp with time zone" },
      { name: "drone_id", type: "text" },
      { name: "battery", type: "numeric" },
    ],
  };
  const entityFilter = { column: "drone_id", value: "7" };

  it("materializeConnectionDataSource scopes query AND generatedQuery", () => {
    const ds = materializeConnectionDataSource(
      "src-1",
      {
        version: 1,
        table: "telemetry",
        aggregate: { fn: "count" },
        bucket: "day",
      },
      [telemetry],
      entityFilter,
    );
    expect(ds.query).toContain(" AND telemetry.drone_id = '7'");
    expect(ds.builder?.generatedQuery).toBe(ds.query);
  });

  it("absent → materialized query is byte-identical (no predicate)", () => {
    const spec = {
      version: 1 as const,
      table: "telemetry",
      aggregate: { fn: "count" as const },
      bucket: "day" as const,
    };
    const without = materializeConnectionDataSource("src-1", spec, [telemetry]);
    expect(without.query).not.toContain("drone_id");
  });

  it("every suggestion for the table carries the predicate", () => {
    const suggestions = suggestPanelsForTable(telemetry, "src-1", {
      entityFilter,
    });
    expect(suggestions.length).toBeGreaterThan(1);
    for (const s of suggestions) {
      expect(s.dataSource.query).toContain("telemetry.drone_id = '7'");
    }
  });

  it("no-time-column datagrid fallback is also scoped", () => {
    const lookup: BuilderTable = {
      name: "lookup",
      columns: [
        { name: "code", type: "text" },
        { name: "drone_id", type: "text" },
      ],
    };
    const [only] = suggestPanelsForTable(lookup, "src-1", { entityFilter });
    expect(only.dataSource.query).toBe(
      "SELECT * FROM lookup WHERE lookup.drone_id = '7'",
    );
  });
});

describe("fixed-bucket $__timeGroup macro expansion", () => {
  const timeRange: TimeRange = { type: "relative", value: "30d" };

  it("postgres → date_trunc", () => {
    const { sql } = substituteVariables(
      "SELECT $__timeGroup(users.created_at, 'day') AS created_at",
      {},
      timeRange,
      "postgres",
    );
    expect(sql).toBe("SELECT date_trunc('day', users.created_at) AS created_at");
  });

  it("clickhouse → toStartOfInterval", () => {
    const { sql } = substituteVariables(
      "SELECT $__timeGroup(created_at, 'month') AS created_at",
      {},
      timeRange,
      "clickhouse",
    );
    expect(sql).toBe(
      'SELECT toStartOfInterval("created_at", INTERVAL 1 MONTH) AS created_at',
    );
  });

  it("single-arg form is unchanged (historical panels)", () => {
    const { sql } = substituteVariables(
      "SELECT $__timeGroup(created_at) AS created_at",
      {},
      timeRange,
      "postgres",
    );
    expect(sql).toContain("to_timestamp(floor(extract(epoch from");
  });
});
