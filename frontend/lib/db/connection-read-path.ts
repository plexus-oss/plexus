import "server-only";
import { executeQuery } from "./data-source-connections";

/**
 * Connection-first migration — Phase 1 read-path plumbing.
 * See ../../../tasks/connection-migration.md (workspace root).
 *
 * Goal: route telemetry reads through the GENERIC connection/driver path (`executeQuery`)
 * instead of the owned-ClickHouse "adaptive" path (`queryTelemetryAdaptive`), so the owned
 * store becomes "just another connection" and we can collapse to one read path.
 *
 * This module is intentionally additive and inert until a flag turns it on for a specific
 * org. It changes no existing behaviour on import.
 *
 * ⚠️ MULTI-TENANCY — READ THIS. The owned Plexus ClickHouse is a SINGLE SHARED store: one
 * `telemetry` table for ALL orgs, isolated ONLY by the `org_id` column at query time. Its
 * credential can read every tenant's data. Therefore:
 *   - The owned-store connection is SERVER-SIDE ONLY. Its credential must never be handed to a
 *     tenant, and every read MUST carry `WHERE org_id = …` (this builder always does).
 *   - NEVER register the shared owned store as a customer-facing connection — that would expose
 *     all tenants' data (`SELECT * FROM telemetry`).
 *   - A "managed store" handed to a customer as a real connection must be PROVISIONED PER-ORG
 *     (per-org ClickHouse user + row policy, per-org database, or per-org service) so the
 *     credential is physically scoped to that org. See PLAN-CONNECTION-FIRST.md §4 / §6.4.
 */

/**
 * Per-org read-path flag. Defaults OFF → zero behaviour change.
 *
 * Mechanism is an env allowlist of org ids (NOT a feature-flag table — those were dropped
 * in migration 00041). An env var means: no schema change, instantly reversible, flippable
 * per-environment, and trivially auditable.
 *
 *   CONNECTION_READPATH_ORG_IDS=org_datacenter,org_other
 */
export function shouldUseConnectionReadPath(orgId: string): boolean {
  const raw = process.env.CONNECTION_READPATH_ORG_IDS;
  if (!raw) return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(orgId);
}

export interface TelemetryPoint {
  timestamp: Date;
  value: number;
}

export interface RawTelemetryQuery {
  orgId: string;
  /** The source SLUG — `telemetry.source_id` is the slug string, not the sources UUID. */
  sourceSlug: string;
  metric: string;
  startTime: Date;
  endTime: Date;
  limit?: number;
}

function escapeLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Format a Date as a ClickHouse DateTime64(3,'UTC') literal: 'YYYY-MM-DD HH:MM:SS.mmm'. */
function toCHDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Raw telemetry SELECT against the owned ClickHouse, as plain SQL so it can run through the
 * generic driver path. Mirrors the ≤1h "raw" tier of `queryTelemetryAdaptive` (i.e.
 * `queryTelemetry`) — the cleanest apples-to-apples tier for the parity check. Literals are
 * inlined (and escaped) because the driver's typed-param path is String-only; all inputs here
 * are server-controlled, never user text.
 */
export function buildRawTelemetrySql(params: RawTelemetryQuery): string {
  const { orgId, sourceSlug, metric, startTime, endTime, limit = 100000 } = params;
  return `
    SELECT timestamp, value
    FROM telemetry
    WHERE org_id = '${escapeLiteral(orgId)}'
      AND source_id = '${escapeLiteral(sourceSlug)}'
      AND metric = '${escapeLiteral(metric)}'
      AND timestamp >= '${toCHDateTime(startTime)}'
      AND timestamp <= '${toCHDateTime(endTime)}'
    ORDER BY timestamp ASC
    LIMIT ${Math.floor(limit)}
  `.trim();
}

/**
 * Read raw telemetry via the generic connection/driver path against a telemetry-store
 * ClickHouse connection. Returns the same point shape as the raw tier of
 * `queryTelemetryAdaptive`, so the two can be diffed for parity (see the harness in
 * `scripts/connection-read-path-parity.ts`) and, once parity holds, swapped behind the flag.
 *
 * `conn.connectionString` is what `executeQuery` already accepts:
 *   - harness / legacy form: a `clickhouse://user:pass@host/db` URL, or
 *   - production form: the decrypted JSON creds (`{...}`) — in which case also pass
 *     `conn.existingConfig` (the connection row's `config`: url/username/database).
 */
export async function readRawTelemetryViaConnection(
  params: RawTelemetryQuery,
  conn: { connectionString: string; existingConfig?: Record<string, unknown> },
): Promise<TelemetryPoint[]> {
  const result = await executeQuery({
    type: "clickhouse",
    connectionString: conn.connectionString,
    existingConfig: conn.existingConfig,
    query: buildRawTelemetrySql(params),
    limit: params.limit ?? 100000,
  });

  return result.rows.map((row) => ({
    timestamp: new Date(`${String(row.timestamp).replace(" ", "T")}Z`),
    value: typeof row.value === "string" ? parseFloat(row.value) : Number(row.value),
  }));
}
