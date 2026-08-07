/**
 * Spec derivation: turn ANY visual-built ConnectionDataSource — old or new —
 * into the builder spec that drives the source-aware editor, without parsing
 * SQL. Legacy panels (pre-builder) store every needed hint: selectedColumns
 * (measures), seriesColumn, timeColumn, valueColumn==="count" (count mode),
 * joins. Reconstruction is verified by re-materializing and requiring the
 * emitted SQL to equal the stored query byte-for-byte — the emitter is
 * snapshot-pinned, so for genuinely visual-built panels this always holds.
 *
 * `null` means SQL-owned: custom SQL, a drifted builder (out-of-band edit),
 * or a query we can't provably represent. The Query section is the editor
 * there; this is a soft guard, not a UI "mode".
 *
 * Pure and I/O-free (same rule as suggest.ts / connection-query-builder.ts).
 */

import type { BuilderTable } from "@/lib/dashboard/connection-query-builder";
import {
  materializeConnectionDataSource,
  type DraftBuilderSpec,
} from "@/lib/dashboard/suggest";
import type {
  ConnectionDataSource,
  PanelBuilderSpec,
} from "@/lib/types/dashboard";

/** Drift check — is the stored spec still the source of the stored SQL? */
export function isBuilderAuthoritative(
  ds: ConnectionDataSource | null | undefined,
): ds is ConnectionDataSource & { builder: PanelBuilderSpec } {
  return (
    !!ds?.builder && !ds.customQuery && ds.builder.generatedQuery === ds.query
  );
}

/**
 * Base table of a visual-built query. SELECT-style (`FROM x`) or Flux
 * (`_measurement == "x"`). Moved from data-source-selector.
 */
export function parseBaseTable(query: string | undefined): string | null {
  if (!query) return null;
  const m = query.match(/FROM\s+(\w+)/i);
  if (m) return m[1];
  // Flux: r["_measurement"] == "name". (The old selector's copy of this regex
  // missed the `]` and never matched — fixed here; it only feeds display and
  // the rebuild affordance, and Flux panels are SQL-owned regardless.)
  const flux = query.match(/_measurement"\]?\s*==\s*"([^"]+)"/);
  return flux ? flux[1] : null;
}

export interface DerivedSpec {
  spec: DraftBuilderSpec;
  /** "builder" = stored spec; "hints" = reconstructed from a legacy panel. */
  origin: "builder" | "hints";
}

/**
 * Derive the editable spec for a connection data source, or null when the
 * panel is SQL-owned. Read-only: never writes `builder` back — the spec is
 * only persisted when the user actually edits (write-path-only invariant).
 */
export function specFromDataSource(
  ds: ConnectionDataSource,
  tables: BuilderTable[],
): DerivedSpec | null {
  // The only real mode switch.
  if (ds.customQuery) return null;

  if (ds.builder) {
    // Authoritative spec → editable. Drifted (query edited out-of-band by an
    // old client) → SQL-owned; never show a form that lies about the SQL.
    if (ds.builder.generatedQuery !== ds.query) return null;
    const spec: DraftBuilderSpec & { generatedQuery?: string } = {
      ...ds.builder,
    };
    delete spec.generatedQuery;
    return { spec, origin: "builder" };
  }

  // ── Legacy reconstruction ──────────────────────────────────────────────
  if (!ds.query?.trim()) return null;
  const table = parseBaseTable(ds.query);
  if (!table) return null; // CTEs, exotic SQL — SQL-owned

  // Legacy visual panels only ever emitted count-mode or raw-select (the old
  // builder had no measure aggregation). `SELECT *` panels carry a timeColumn
  // hint without filtering on it — only claim the time axis when the query
  // actually uses it.
  const usesTime = ds.query.includes("$__timeFilter(");
  const spec: DraftBuilderSpec =
    ds.valueColumn === "count"
      ? {
          version: 1,
          table,
          timeColumn: usesTime ? ds.timeColumn : undefined,
          aggregate: { fn: "count" },
          groupBy: ds.seriesColumn,
          bucket: "auto",
          joins: ds.joins,
        }
      : {
          version: 1,
          table,
          timeColumn: usesTime ? ds.timeColumn : undefined,
          aggregate: {
            fn: "raw",
            columns: ds.selectedColumns?.length ? ds.selectedColumns : undefined,
          },
          groupBy: ds.seriesColumn,
          joins: ds.joins,
        };

  // Round-trip guard: the reconstruction must regenerate the stored SQL
  // byte-for-byte, else this wasn't a visual-built panel we understand
  // (hand-written SQL missing the customQuery flag, schema drift, …).
  const rebuilt = materializeConnectionDataSource(ds.sourceId, spec, tables);
  if (rebuilt.query !== ds.query) return null;

  return { spec, origin: "hints" };
}
