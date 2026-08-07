import { describe, it, expect } from "vitest";
import {
  resolvePollTarget,
  type PollAssociation,
} from "@/lib/alerts/resolve-poll-target";
import type { SchemaInfo } from "@/lib/db/drivers/types";

const snapshot = {
  tables: [
    {
      name: "readings",
      schema: "public",
      columns: [
        { name: "created_at", type: "timestamp with time zone" },
        { name: "device_id", type: "text" },
        { name: "temp", type: "numeric" },
      ],
    },
  ],
} as unknown as SchemaInfo;

const assoc: PollAssociation = {
  table_name: "readings",
  table_schema: "public",
  filter_column: "device_id",
  filter_value: "dev-1",
};

describe("resolvePollTarget with an association (discovered entity)", () => {
  it("uses the association's table/schema and sets the filter", () => {
    const res = resolvePollTarget(
      { metric: "temp", table_name: null, time_column: null },
      snapshot,
      assoc,
    );
    expect(res).toEqual({
      ok: true,
      target: {
        table: "readings",
        schema: "public",
        timeColumn: "created_at",
        filterColumn: "device_id",
        filterValue: "dev-1",
      },
      persist: { table_name: "readings", time_column: "created_at" },
    });
  });

  it("monitor-pinned table/time win, filter still applies, no snapshot needed", () => {
    const res = resolvePollTarget(
      { metric: "temp", table_name: "readings", time_column: "created_at" },
      null,
      assoc,
    );
    expect(res).toEqual({
      ok: true,
      target: {
        table: "readings",
        schema: "public",
        timeColumn: "created_at",
        filterColumn: "device_id",
        filterValue: "dev-1",
      },
    });
  });

  it("association without a predicate resolves but sets no filter", () => {
    const res = resolvePollTarget(
      { metric: "temp", table_name: null, time_column: "created_at" },
      null,
      { ...assoc, filter_column: null, filter_value: null },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.target.filterColumn).toBeUndefined();
      expect(res.target.filterValue).toBeUndefined();
    }
  });

  it("fails when time column cannot be resolved without a snapshot", () => {
    const res = resolvePollTarget(
      { metric: "temp", table_name: null, time_column: null },
      null,
      assoc,
    );
    expect(res.ok).toBe(false);
  });
});

describe("resolvePollTarget without an association (existing behavior)", () => {
  it("resolves the unique table containing the metric from the snapshot", () => {
    const res = resolvePollTarget(
      { metric: "temp", table_name: null, time_column: null },
      snapshot,
    );
    expect(res).toEqual({
      ok: true,
      target: { table: "readings", schema: "public", timeColumn: "created_at" },
      persist: { table_name: "readings", time_column: "created_at" },
    });
  });

  it("pinned monitors resolve without a snapshot and carry no filter", () => {
    const res = resolvePollTarget(
      { metric: "temp", table_name: "readings", time_column: "created_at" },
      null,
    );
    expect(res).toEqual({
      ok: true,
      target: { table: "readings", schema: undefined, timeColumn: "created_at" },
    });
  });
});
