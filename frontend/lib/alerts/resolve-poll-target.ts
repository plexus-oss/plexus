/**
 * Resolve which (table, time column) an event monitor on a connection source
 * should poll. Pure module so the resolution rules are unit-testable.
 *
 * A monitor's `metric` is a column name from the connection's schema (the
 * metrics endpoint flattens every table's columns), but the table it came from
 * historically wasn't persisted. New monitors store `table_name`/`time_column`
 * at creation; older ones are resolved from the schema snapshot here, and the
 * poller backfills the result (the `persist` field) so resolution happens once.
 */

import {
  detectTimeColumn,
  isIntegerType,
} from "@/lib/dashboard/column-roles";
import type { SchemaInfo } from "@/lib/db/drivers/types";

export interface PollTarget {
  table: string;
  schema?: string;
  timeColumn: string;
  /**
   * "numeric" when the cursor column is integer-typed (a monotonic id — an
   * UPDATE can never re-emit a row through it); "time" otherwise. Determined
   * from the snapshot when available; affects the init-watermark fallback.
   */
  cursorKind: "time" | "numeric";
  /** Entity predicate for discovered sources (from source_associations). */
  filterColumn?: string;
  filterValue?: string;
}

/**
 * A source_associations row for a discovered entity: the entity's data is the
 * slice of the parent connection's table where filter_column = filter_value.
 */
export interface PollAssociation {
  table_name: string;
  table_schema: string | null;
  filter_column: string | null;
  filter_value: string | null;
}

export type ResolvePollTargetResult =
  | {
      ok: true;
      target: PollTarget;
      /** Set when resolved from the snapshot — caller should persist it. */
      persist?: { table_name: string; time_column: string };
    }
  | { ok: false; reason: string };

interface MonitorPollFields {
  metric: string;
  table_name: string | null;
  time_column: string | null;
}

type SnapshotTable = SchemaInfo["tables"][number];

export function resolvePollTarget(
  monitor: MonitorPollFields,
  snapshot: SchemaInfo | null,
  association?: PollAssociation | null,
): ResolvePollTargetResult {
  // Discovered-entity monitors poll the PARENT connection's table sliced by
  // the association's predicate. Monitor-pinned table/time column still win
  // for table/time; the filter always applies when an association is present.
  if (association) {
    const table = monitor.table_name || association.table_name;
    const snapTable = findTable(snapshot, table);
    const schema =
      table === association.table_name
        ? (association.table_schema ?? snapTable?.schema)
        : snapTable?.schema;

    let timeColumn: string | undefined = monitor.time_column ?? undefined;
    let persist: { table_name: string; time_column: string } | undefined;
    if (!timeColumn) {
      if (!snapTable) {
        return {
          ok: false,
          reason: snapshot?.tables?.length
            ? `table '${table}' not found in schema snapshot`
            : "no schema snapshot available",
        };
      }
      timeColumn = detectTimeColumn(snapTable.columns);
      if (!timeColumn) {
        return {
          ok: false,
          reason: `no time column detected on table '${table}'`,
        };
      }
      persist = { table_name: table, time_column: timeColumn };
    }

    const target: PollTarget = {
      table,
      schema,
      timeColumn,
      cursorKind: cursorKind(snapTable, timeColumn),
    };
    if (association.filter_column != null && association.filter_value != null) {
      target.filterColumn = association.filter_column;
      target.filterValue = association.filter_value;
    }
    return persist ? { ok: true, target, persist } : { ok: true, target };
  }

  // Fully pinned monitors work even without (or against a stale) snapshot —
  // the customer may have dropped the table from a refreshed snapshot while
  // it still exists.
  if (monitor.table_name && monitor.time_column) {
    const table = findTable(snapshot, monitor.table_name);
    return {
      ok: true,
      target: {
        table: monitor.table_name,
        schema: table?.schema,
        timeColumn: monitor.time_column,
        cursorKind: cursorKind(table, monitor.time_column),
      },
    };
  }

  if (!snapshot?.tables?.length) {
    return { ok: false, reason: "no schema snapshot available" };
  }

  let table: SnapshotTable | undefined;
  if (monitor.table_name) {
    table = findTable(snapshot, monitor.table_name);
    if (!table) {
      return {
        ok: false,
        reason: `table '${monitor.table_name}' not found in schema snapshot`,
      };
    }
  } else {
    const matches = snapshot.tables.filter((t) =>
      t.columns.some((c) => c.name === monitor.metric),
    );
    if (matches.length === 0) {
      return {
        ok: false,
        reason: `column '${monitor.metric}' not found in any table`,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        reason: `column '${monitor.metric}' is ambiguous across ${matches.length} tables — edit the monitor to pin a table`,
      };
    }
    table = matches[0];
  }

  const timeColumn = monitor.time_column ?? detectTimeColumn(table.columns);
  if (!timeColumn) {
    return {
      ok: false,
      reason: `no time column detected on table '${table.name}'`,
    };
  }

  return {
    ok: true,
    target: {
      table: table.name,
      schema: table.schema,
      timeColumn,
      cursorKind: cursorKind(table, timeColumn),
    },
    persist: { table_name: table.name, time_column: timeColumn },
  };
}

/** "numeric" only when the snapshot proves the cursor column is integer-typed;
 * unknown types default to "time" (the historical behavior). */
function cursorKind(
  table: SnapshotTable | undefined,
  timeColumn: string,
): "time" | "numeric" {
  const type = table?.columns.find((c) => c.name === timeColumn)?.type;
  return type && isIntegerType(type) ? "numeric" : "time";
}

function findTable(
  snapshot: SchemaInfo | null,
  name: string,
): SnapshotTable | undefined {
  return snapshot?.tables?.find((t) => t.name === name);
}
