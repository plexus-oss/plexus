import { describe, it, expect } from "vitest";
import {
  buildInitWatermarkSql,
  buildNewRowsSql,
} from "@/lib/alerts/event-poll-sql";

// The no-filter outputs are pinned byte-for-byte: adding the optional entity
// predicate (discovered sources) must not perturb existing monitors' SQL.

const base = {
  table: "readings",
  timeColumn: "ts",
  valueColumn: "temp",
  watermark: "2026-07-20 10:00:00.123456",
} as const;

describe("buildNewRowsSql (no filter — byte-identical baseline)", () => {
  it("postgres", () => {
    expect(buildNewRowsSql({ dialect: "postgres", ...base })).toBe(
      `SELECT "ts"::text AS plexus_ts, "temp" AS plexus_value ` +
        `FROM "readings" ` +
        `WHERE "ts" > '2026-07-20 10:00:00.123456' ` +
        `ORDER BY "ts" ASC ` +
        `LIMIT 1000`,
    );
  });

  it("postgres with schema + explicit limit", () => {
    expect(
      buildNewRowsSql({
        dialect: "postgres",
        ...base,
        schema: "public",
        limit: 50,
      }),
    ).toBe(
      `SELECT "ts"::text AS plexus_ts, "temp" AS plexus_value ` +
        `FROM "public"."readings" ` +
        `WHERE "ts" > '2026-07-20 10:00:00.123456' ` +
        `ORDER BY "ts" ASC ` +
        `LIMIT 50`,
    );
  });

  it("mysql", () => {
    expect(buildNewRowsSql({ dialect: "mysql", ...base })).toBe(
      "SELECT CAST(`ts` AS CHAR) AS plexus_ts, `temp` AS plexus_value " +
        "FROM `readings` " +
        "WHERE `ts` > '2026-07-20 10:00:00.123456' " +
        "ORDER BY `ts` ASC " +
        "LIMIT 1000",
    );
  });

  it("clickhouse", () => {
    expect(buildNewRowsSql({ dialect: "clickhouse", ...base })).toBe(
      "SELECT toString(`ts`) AS plexus_ts, `temp` AS plexus_value " +
        "FROM `readings` " +
        "WHERE `ts` > '2026-07-20 10:00:00.123456' " +
        "ORDER BY `ts` ASC " +
        "LIMIT 1000",
    );
  });
});

describe("buildNewRowsSql (context columns)", () => {
  it("appends aliased context columns to the projection (postgres)", () => {
    expect(
      buildNewRowsSql({
        dialect: "postgres",
        ...base,
        contextColumns: ["email", "name"],
      }),
    ).toBe(
      `SELECT "ts"::text AS plexus_ts, "temp" AS plexus_value, "email" AS plexus_ctx_0, "name" AS plexus_ctx_1 ` +
        `FROM "readings" ` +
        `WHERE "ts" > '2026-07-20 10:00:00.123456' ` +
        `ORDER BY "ts" ASC ` +
        `LIMIT 1000`,
    );
  });

  it("quotes context columns per dialect (clickhouse)", () => {
    expect(
      buildNewRowsSql({
        dialect: "clickhouse",
        ...base,
        contextColumns: ["email"],
      }),
    ).toBe(
      "SELECT toString(`ts`) AS plexus_ts, `temp` AS plexus_value, `email` AS plexus_ctx_0 " +
        "FROM `readings` " +
        "WHERE `ts` > '2026-07-20 10:00:00.123456' " +
        "ORDER BY `ts` ASC " +
        "LIMIT 1000",
    );
  });

  it("empty context columns leave SQL byte-identical", () => {
    expect(
      buildNewRowsSql({ dialect: "postgres", ...base, contextColumns: [] }),
    ).toBe(buildNewRowsSql({ dialect: "postgres", ...base }));
  });
});

describe("buildNewRowsSql (entity filter)", () => {
  it("appends the predicate to the WHERE clause (postgres)", () => {
    expect(
      buildNewRowsSql({
        dialect: "postgres",
        ...base,
        filterColumn: "device_id",
        filterValue: "dev-1",
      }),
    ).toBe(
      `SELECT "ts"::text AS plexus_ts, "temp" AS plexus_value ` +
        `FROM "readings" ` +
        `WHERE "ts" > '2026-07-20 10:00:00.123456' ` +
        `AND "device_id" = 'dev-1' ` +
        `ORDER BY "ts" ASC ` +
        `LIMIT 1000`,
    );
  });

  it("appends the predicate with dialect quoting (clickhouse)", () => {
    expect(
      buildNewRowsSql({
        dialect: "clickhouse",
        ...base,
        filterColumn: "device_id",
        filterValue: "dev-1",
      }),
    ).toBe(
      "SELECT toString(`ts`) AS plexus_ts, `temp` AS plexus_value " +
        "FROM `readings` " +
        "WHERE `ts` > '2026-07-20 10:00:00.123456' " +
        "AND `device_id` = 'dev-1' " +
        "ORDER BY `ts` ASC " +
        "LIMIT 1000",
    );
  });

  it("escapes quotes in the filter value and column", () => {
    const sqlText = buildNewRowsSql({
      dialect: "postgres",
      ...base,
      filterColumn: 'weird"col',
      filterValue: "o'brien",
    });
    expect(sqlText).toContain(`AND "weird""col" = 'o''brien' `);
  });

  it("filterColumn alone (no value) leaves SQL unfiltered", () => {
    expect(
      buildNewRowsSql({ dialect: "postgres", ...base, filterColumn: "d" }),
    ).toBe(buildNewRowsSql({ dialect: "postgres", ...base }));
  });
});

describe("buildNewRowsSql (monitor filters)", () => {
  it("ANDs predicates after the watermark (postgres)", () => {
    expect(
      buildNewRowsSql({
        dialect: "postgres",
        ...base,
        filters: [
          { column: "event_type", op: "eq", value: "signup" },
          { column: "plan", op: "neq", value: "free" },
        ],
      }),
    ).toBe(
      `SELECT "ts"::text AS plexus_ts, "temp" AS plexus_value ` +
        `FROM "readings" ` +
        `WHERE "ts" > '2026-07-20 10:00:00.123456' ` +
        `AND "event_type" = 'signup' ` +
        `AND "plan" != 'free' ` +
        `ORDER BY "ts" ASC ` +
        `LIMIT 1000`,
    );
  });

  it("renders comparison ops and escapes values (clickhouse)", () => {
    expect(
      buildNewRowsSql({
        dialect: "clickhouse",
        ...base,
        filters: [{ column: "amount", op: "gte", value: "o'brien" }],
      }),
    ).toBe(
      "SELECT toString(`ts`) AS plexus_ts, `temp` AS plexus_value " +
        "FROM `readings` " +
        "WHERE `ts` > '2026-07-20 10:00:00.123456' " +
        "AND `amount` >= 'o''brien' " +
        "ORDER BY `ts` ASC " +
        "LIMIT 1000",
    );
  });

  it("empty filters leave SQL byte-identical", () => {
    expect(
      buildNewRowsSql({ dialect: "postgres", ...base, filters: [] }),
    ).toBe(buildNewRowsSql({ dialect: "postgres", ...base }));
  });

  it("entity filter and monitor filters both apply, entity first", () => {
    expect(
      buildNewRowsSql({
        dialect: "postgres",
        ...base,
        filterColumn: "device_id",
        filterValue: "dev-1",
        filters: [{ column: "event_type", op: "eq", value: "signup" }],
      }),
    ).toBe(
      `SELECT "ts"::text AS plexus_ts, "temp" AS plexus_value ` +
        `FROM "readings" ` +
        `WHERE "ts" > '2026-07-20 10:00:00.123456' ` +
        `AND "device_id" = 'dev-1' ` +
        `AND "event_type" = 'signup' ` +
        `ORDER BY "ts" ASC ` +
        `LIMIT 1000`,
    );
  });
});

describe("buildInitWatermarkSql (numeric cursor)", () => {
  const target = { table: "readings", timeColumn: "id" } as const;

  it("postgres falls back to '0', not the clock", () => {
    expect(
      buildInitWatermarkSql({
        dialect: "postgres",
        ...target,
        numericCursor: true,
      }),
    ).toBe(`SELECT COALESCE(MAX("id")::text, '0') AS plexus_wm FROM "readings"`);
  });

  it("clickhouse guards empty with '0'", () => {
    expect(
      buildInitWatermarkSql({
        dialect: "clickhouse",
        ...target,
        numericCursor: true,
      }),
    ).toBe(
      "SELECT if(count() = 0, '0', toString(max(`id`))) AS plexus_wm FROM `readings`",
    );
  });

  it("applies monitor filters to the WHERE clause", () => {
    expect(
      buildInitWatermarkSql({
        dialect: "postgres",
        table: "readings",
        timeColumn: "id",
        numericCursor: true,
        filters: [{ column: "event_type", op: "eq", value: "signup" }],
      }),
    ).toBe(
      `SELECT COALESCE(MAX("id")::text, '0') AS plexus_wm ` +
        `FROM "readings" WHERE "event_type" = 'signup'`,
    );
  });
});

describe("buildInitWatermarkSql (no filter — byte-identical baseline)", () => {
  const target = { table: "readings", timeColumn: "ts" } as const;

  it("postgres", () => {
    expect(buildInitWatermarkSql({ dialect: "postgres", ...target })).toBe(
      `SELECT COALESCE(MAX("ts")::text, now()::text) AS plexus_wm FROM "readings"`,
    );
  });

  it("timescaledb with schema", () => {
    expect(
      buildInitWatermarkSql({
        dialect: "timescaledb",
        ...target,
        schema: "metrics",
      }),
    ).toBe(
      `SELECT COALESCE(MAX("ts")::text, now()::text) AS plexus_wm FROM "metrics"."readings"`,
    );
  });

  it("mysql", () => {
    expect(buildInitWatermarkSql({ dialect: "mysql", ...target })).toBe(
      "SELECT COALESCE(CAST(MAX(`ts`) AS CHAR), CAST(NOW(6) AS CHAR)) AS plexus_wm FROM `readings`",
    );
  });

  it("clickhouse", () => {
    expect(buildInitWatermarkSql({ dialect: "clickhouse", ...target })).toBe(
      "SELECT if(count() = 0, toString(now64(3)), toString(max(`ts`))) AS plexus_wm FROM `readings`",
    );
  });
});

describe("buildInitWatermarkSql (entity filter)", () => {
  it("adds a WHERE clause (postgres) — the builder has none without it", () => {
    expect(
      buildInitWatermarkSql({
        dialect: "postgres",
        table: "readings",
        timeColumn: "ts",
        filterColumn: "device_id",
        filterValue: "dev-1",
      }),
    ).toBe(
      `SELECT COALESCE(MAX("ts")::text, now()::text) AS plexus_wm ` +
        `FROM "readings" WHERE "device_id" = 'dev-1'`,
    );
  });

  it("adds a WHERE clause (clickhouse) with escaping", () => {
    expect(
      buildInitWatermarkSql({
        dialect: "clickhouse",
        table: "readings",
        timeColumn: "ts",
        filterColumn: "device_id",
        filterValue: "o'brien",
      }),
    ).toBe(
      "SELECT if(count() = 0, toString(now64(3)), toString(max(`ts`))) AS plexus_wm " +
        "FROM `readings` WHERE `device_id` = 'o''brien'",
    );
  });
});
