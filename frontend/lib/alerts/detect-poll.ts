/**
 * Poll-based alert detection — the core scan.
 *
 * Covers the monitor types that push evaluation cannot reach:
 *
 *  1. Event ("new row") monitors on CONNECTION sources — the customer's data
 *     lives in THEIR store and never flows through the gateway, so arrival can
 *     only be observed by polling it (generic driver path).
 *  2. Threshold (source_limits) monitors on CONNECTION sources — same read,
 *     each new row's value evaluated against min/max.
 *  3. Event monitors on DEVICE sources — polled from the owned ClickHouse
 *     store (telemetry lands there via gateway → Redis → loader). Device
 *     THRESHOLDS are deliberately NOT polled: the Go alert-service owns them
 *     on the live stream, and a second evaluator would double-alert.
 *  4. Event + threshold monitors on DISCOVERED device sources — auto-discovery
 *     mints device sources whose data is a slice of a parent CONNECTION's
 *     table (source_associations: filter_column = filter_value). These have no
 *     credentials of their own, so they poll the PARENT connection with the
 *     entity predicate appended, and are excluded from the ClickHouse device
 *     path (3). Alerts still fire against the discovered source.
 *
 * Runs as an in-process loop tick (lib/scheduler/poll-loop.ts) and via the
 * manual /api/internal/detect-poll route.
 *
 * Watermark contract: `poll_watermark` is an opaque string rendered by the
 * source DB itself (see lib/alerts/event-poll-sql.ts). A NULL watermark means
 * "initialize": record the newest existing row's time WITHOUT alerting, so a
 * new monitor never storms over historical backlog. The watermark advances
 * even when the dedup window suppresses the alert — suppressed rows must not
 * re-fire later.
 */

import "server-only";

import { and, eq, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import {
  eventMonitors,
  sourceAssociations,
  sourceLimits,
  sources,
} from "@/lib/db/schema";
import {
  eventMonitorQueries,
  sourceLimitQueries,
} from "@/lib/db/queries/sources";
import { adminSourceQueries } from "@/lib/db/server";
import type {
  EventMonitorRecord,
  Source,
  SourceAssociation,
  SourceLimitRecord,
} from "@/lib/db/types";
import type { DataSourceType } from "@/lib/db/types";
import { decrypt } from "@/lib/encryption";
import {
  executeQuery,
  getSchema,
  buildSSHTunnelConfig,
} from "@/lib/db/data-source-connections";
import { getClient } from "@/lib/db/clickhouse";
import type { SchemaInfo } from "@/lib/db/drivers/types";
import {
  checkCircuit,
  recordSuccess,
  recordFailure,
  singleflight,
} from "@/lib/db/query-cache";
import { evaluateLimit } from "@/lib/limits";
import {
  buildInitWatermarkSql,
  buildNewRowsSql,
  isPollDialect,
  POLL_ROW_LIMIT,
} from "@/lib/alerts/event-poll-sql";
import { resolvePollTarget } from "@/lib/alerts/resolve-poll-target";
import { fireEventAlert, fireLimitAlert } from "@/lib/alerts/fire-alert";

const SOURCE_CONCURRENCY = 3;
const QUERY_TIMEOUT_MS = 10_000;
/** Don't re-attempt a live schema fetch for a source more often than this. */
const SCHEMA_FETCH_MIN_INTERVAL_MS = 10 * 60 * 1000;

const schemaFetchAttempts = new Map<string, number>();

export interface PollStats {
  monitors: number;
  sourcesPolled: number;
  fired: number;
  initialized: number;
  skipped: number;
  errors: number;
}

/** One monitor to poll: an event monitor or a threshold (limit). */
type PollUnit =
  | { kind: "event"; row: EventMonitorRecord }
  | { kind: "limit"; row: SourceLimitRecord };

interface UnitWithSource {
  unit: PollUnit;
  /** The source whose store is polled — always a CONNECTION source here. */
  source: Source;
  /**
   * Present for discovered-entity monitors: the DEVICE source the alert fires
   * against, plus the association whose predicate slices the parent table.
   */
  entity?: { source: Source; association: SourceAssociation };
}

function unitId(unit: PollUnit): string {
  return unit.row.id;
}

/** Joined row for a discovered-entity monitor (branch 4). */
interface EntityMonitorRow<R extends EventMonitorRecord | SourceLimitRecord> {
  row: R;
  /** The discovered DEVICE source the monitor is attached to. */
  source: Source;
  assoc: SourceAssociation;
  /** The parent CONNECTION source the association points at. */
  parent: Source;
}

/**
 * A device can carry several associations (unique per connection+table); a
 * monitor's watermark is single, so it must map to exactly ONE poll target.
 * Keep one row per monitor, preferring the association whose table matches
 * the monitor's pinned table_name.
 */
function dedupeEntityRows<R extends EventMonitorRecord | SourceLimitRecord>(
  rows: EntityMonitorRow<R>[],
): EntityMonitorRow<R>[] {
  const byMonitor = new Map<string, EntityMonitorRow<R>>();
  for (const r of rows) {
    const existing = byMonitor.get(r.row.id);
    if (
      !existing ||
      (r.row.table_name &&
        r.assoc.table_name === r.row.table_name &&
        existing.assoc.table_name !== r.row.table_name)
    ) {
      byMonitor.set(r.row.id, r);
    }
  }
  return [...byMonitor.values()];
}

function updatePollState(
  unit: PollUnit,
  orgId: string,
  data: {
    poll_watermark?: string | null;
    last_polled_at?: string;
    table_name?: string | null;
    time_column?: string | null;
    last_status?: string | null;
    last_error?: string | null;
    last_evaluated_at?: string;
  },
): Promise<void> {
  return unit.kind === "event"
    ? eventMonitorQueries.updatePollState(orgId, unit.row.id, data)
    : sourceLimitQueries.updatePollState(orgId, unit.row.id, data);
}

/**
 * Record the outcome of a poll attempt so the UI can show Working / Skipped /
 * Failing. Health writes must never throw into the scan — a monitor that can't
 * even record its own skip shouldn't take down the whole source's batch.
 */
async function recordHealth(
  unit: PollUnit,
  orgId: string,
  status: "ok" | "skipped" | "error",
  error: string | null,
  nowIso: string,
): Promise<void> {
  try {
    await updatePollState(unit, orgId, {
      last_status: status,
      last_error: error,
      last_evaluated_at: nowIso,
    });
  } catch (err) {
    console.error("[detect-poll] health write failed:", unitId(unit), err);
  }
}

/** Record the same skip reason for every unit in a group-level skip. */
async function recordGroupSkip(
  group: UnitWithSource[],
  reason: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  await Promise.all(
    group.map((item) =>
      recordHealth(item.unit, item.unit.row.org_id, "skipped", reason, nowIso),
    ),
  );
}

/** One full scan across all orgs. Exported for the loop and the manual route. */
export async function detectPollOnce(): Promise<PollStats> {
  const stats: PollStats = {
    monitors: 0,
    sourcesPolled: 0,
    fired: 0,
    initialized: 0,
    skipped: 0,
    errors: 0,
  };

  // Discovered-entity monitors sit on DEVICE sources that have a
  // source_associations row; they poll the PARENT connection (aliased join)
  // with the association's predicate. The device/ClickHouse branch explicitly
  // excludes them so a discovered source is never double-processed.
  const parentConn = alias(sources, "parent_conn");
  const hasAssociation = db
    .select({ one: sql`1` })
    .from(sourceAssociations)
    .where(eq(sourceAssociations.entity_id, eventMonitors.source_id));

  // Admin Drizzle pool (no RLS) — scans across orgs, like detect-offline.
  // event_monitors.source_id and source_limits.source_id are both real UUID
  // FKs onto sources.id (migration 0013).
  const [connEvents, connLimits, deviceEvents, entityEvents, entityLimits] =
    await Promise.all([
      db
        .select({ row: eventMonitors, source: sources })
        .from(eventMonitors)
        .innerJoin(sources, eq(sources.id, eventMonitors.source_id))
        .where(
          and(
            eq(eventMonitors.enabled, true),
            eq(sources.source_type, "connection"),
            eq(sources.status, "online"),
          ),
        ) as unknown as Promise<{ row: EventMonitorRecord; source: Source }[]>,
      db
        .select({ row: sourceLimits, source: sources })
        .from(sourceLimits)
        .innerJoin(sources, eq(sources.id, sourceLimits.source_id))
        .where(
          and(
            eq(sources.source_type, "connection"),
            eq(sources.status, "online"),
          ),
        ) as unknown as Promise<{ row: SourceLimitRecord; source: Source }[]>,
      db
        .select({ row: eventMonitors, source: sources })
        .from(eventMonitors)
        .innerJoin(sources, eq(sources.id, eventMonitors.source_id))
        .where(
          and(
            eq(eventMonitors.enabled, true),
            eq(sources.source_type, "device"),
            notExists(hasAssociation),
          ),
        ) as unknown as Promise<{ row: EventMonitorRecord; source: Source }[]>,
      db
        .select({ row: eventMonitors, source: sources, assoc: sourceAssociations, parent: parentConn })
        .from(eventMonitors)
        .innerJoin(sources, eq(sources.id, eventMonitors.source_id))
        .innerJoin(
          sourceAssociations,
          and(
            eq(sourceAssociations.entity_id, eventMonitors.source_id),
            eq(sourceAssociations.org_id, sources.org_id),
          ),
        )
        .innerJoin(parentConn, eq(parentConn.id, sourceAssociations.connection_id))
        .where(
          and(
            eq(eventMonitors.enabled, true),
            eq(sources.source_type, "device"),
            eq(parentConn.source_type, "connection"),
            eq(parentConn.status, "online"),
          ),
        ) as unknown as Promise<EntityMonitorRow<EventMonitorRecord>[]>,
      db
        .select({ row: sourceLimits, source: sources, assoc: sourceAssociations, parent: parentConn })
        .from(sourceLimits)
        .innerJoin(sources, eq(sources.id, sourceLimits.source_id))
        .innerJoin(
          sourceAssociations,
          and(
            eq(sourceAssociations.entity_id, sourceLimits.source_id),
            eq(sourceAssociations.org_id, sources.org_id),
          ),
        )
        .innerJoin(parentConn, eq(parentConn.id, sourceAssociations.connection_id))
        .where(
          and(
            eq(sources.source_type, "device"),
            eq(parentConn.source_type, "connection"),
            eq(parentConn.status, "online"),
          ),
        ) as unknown as Promise<EntityMonitorRow<SourceLimitRecord>[]>,
    ]);

  const connectionUnits: UnitWithSource[] = [
    ...connEvents.map((r) => ({
      unit: { kind: "event", row: r.row } as PollUnit,
      source: r.source,
    })),
    ...connLimits.map((r) => ({
      unit: { kind: "limit", row: r.row } as PollUnit,
      source: r.source,
    })),
    ...dedupeEntityRows(entityEvents).map((r) => ({
      unit: { kind: "event", row: r.row } as PollUnit,
      source: r.parent,
      entity: { source: r.source, association: r.assoc },
    })),
    ...dedupeEntityRows(entityLimits).map((r) => ({
      unit: { kind: "limit", row: r.row } as PollUnit,
      source: r.parent,
      entity: { source: r.source, association: r.assoc },
    })),
  ];

  stats.monitors = connectionUnits.length + deviceEvents.length;
  if (stats.monitors === 0) return stats;

  // Group by the id of the source being POLLED — for discovered entities
  // that's the parent connection, so they share creds/circuit/snapshot with
  // direct monitors on the same connection.
  const bySource = new Map<string, UnitWithSource[]>();
  for (const item of connectionUnits) {
    const group = bySource.get(item.source.id) ?? [];
    group.push(item);
    bySource.set(item.source.id, group);
  }

  await processInBatches(
    [...bySource.values()],
    SOURCE_CONCURRENCY,
    async (group) => {
      try {
        await pollConnectionSource(group, stats);
        stats.sourcesPolled++;
      } catch (err) {
        stats.errors++;
        console.error(
          "[detect-poll] source failed:",
          group[0]?.source.id,
          err,
        );
      }
    },
  );

  if (deviceEvents.length > 0) {
    const deviceSources = new Set(deviceEvents.map((r) => r.source.id));
    await processInBatches(deviceEvents, SOURCE_CONCURRENCY, async (item) => {
      try {
        await pollDeviceEventMonitor(item.row, item.source, stats);
      } catch (err) {
        stats.errors++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          "[detect-poll] device monitor failed:",
          item.row.id,
          message,
        );
        await eventMonitorQueries
          .updatePollState(item.row.org_id, item.row.id, {
            last_status: "error",
            last_error: message,
            last_evaluated_at: new Date().toISOString(),
          })
          .catch(() => {});
      }
    });
    stats.sourcesPolled += deviceSources.size;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Connection sources (customer stores, generic driver path)
// ---------------------------------------------------------------------------

async function pollConnectionSource(
  group: UnitWithSource[],
  stats: PollStats,
): Promise<void> {
  const source = group[0].source;

  const connectionType = source.connection_type;
  if (!isPollDialect(connectionType ?? null)) {
    stats.skipped += group.length;
    const reason = `Source type '${connectionType}' can't be polled for alerts`;
    logSkip(source.id, unitId(group[0].unit), [reason]);
    await recordGroupSkip(group, reason);
    return;
  }
  if (!source.credentials_encrypted) {
    stats.skipped += group.length;
    await recordGroupSkip(group, "Source has no stored connection credentials");
    return;
  }

  const circuitError = checkCircuit(source.id);
  if (circuitError) {
    stats.skipped += group.length;
    await recordGroupSkip(
      group,
      "Paused after repeated connection failures — retrying automatically",
    );
    return;
  }

  const connectionString = decrypt(source.credentials_encrypted);
  const sshTunnel = source.ssh_credentials_encrypted
    ? buildSSHTunnelConfig(
        (source.metadata || {}) as Record<string, unknown>,
        decrypt(source.ssh_credentials_encrypted),
      )
    : undefined;
  const existingConfig = (source.config as Record<string, unknown>) ?? {};

  // Schema snapshot: normally written by the check-connections cron, but that
  // may never run in some deployments — fall back to a throttled live fetch
  // when an unpinned monitor needs it.
  let snapshot =
    (existingConfig.schemaSnapshot as SchemaInfo | undefined) ?? null;
  // Snapshot needed when a time column must be detected, or when a monitor
  // has neither a pinned table nor an association to supply one.
  const needsSnapshot = group.some(
    ({ unit, entity }) =>
      !unit.row.time_column || !(unit.row.table_name || entity),
  );
  if (!snapshot && needsSnapshot) {
    snapshot = await fetchSchemaThrottled(source, connectionString, sshTunnel);
  }

  const runQuery = (query: string) =>
    executeQuery({
      type: connectionType as DataSourceType,
      connectionString,
      query,
      limit: POLL_ROW_LIMIT,
      timeout: QUERY_TIMEOUT_MS,
      sshTunnel,
      existingConfig,
    });

  const dialect = connectionType as Parameters<
    typeof buildNewRowsSql
  >[0]["dialect"];

  for (const item of group) {
    const { unit, entity } = item;
    const monitor = unit.row;
    try {
      const resolved = resolvePollTarget(
        monitor,
        snapshot,
        entity?.association ?? null,
      );
      const nowIso = new Date().toISOString();
      if (!resolved.ok) {
        stats.skipped++;
        logSkip(source.id, monitor.id, [resolved.reason]);
        await recordHealth(unit, monitor.org_id, "skipped", resolved.reason, nowIso);
        continue;
      }

      if (resolved.persist) {
        await updatePollState(unit, monitor.org_id, resolved.persist);
      }

      const { target } = resolved;

      // User-authored row predicate — event monitors only.
      const filters =
        unit.kind === "event" && unit.row.filters?.length
          ? { filters: unit.row.filters }
          : {};

      if (!monitor.poll_watermark) {
        // First tick (or post-reconfigure): record where "now" is, don't alert.
        const init = await runQuery(
          buildInitWatermarkSql({
            dialect,
            ...target,
            numericCursor: target.cursorKind === "numeric",
            ...filters,
          }),
        );
        recordSuccess(source.id);
        const wm = init.rows[0]?.plexus_wm;
        if (wm == null) throw new Error("init watermark query returned no row");
        await updatePollState(unit, monitor.org_id, {
          poll_watermark: String(wm),
          last_polled_at: nowIso,
          last_status: "ok",
          last_error: null,
          last_evaluated_at: nowIso,
        });
        stats.initialized++;
        continue;
      }

      // NOTE: with filters, the watermark only advances past MATCHING rows —
      // a long non-matching tail after the watermark is re-scanned each tick
      // (indexed range scan; same behavior as the entity predicate).
      const result = await runQuery(
        buildNewRowsSql({
          dialect,
          ...target,
          valueColumn: monitor.metric,
          watermark: monitor.poll_watermark,
          limit: POLL_ROW_LIMIT,
          ...(unit.kind === "event" && unit.row.context_columns?.length
            ? { contextColumns: unit.row.context_columns }
            : {}),
          ...filters,
        }),
      );
      recordSuccess(source.id);

      if (result.rows.length === 0) {
        await updatePollState(unit, monitor.org_id, {
          last_polled_at: nowIso,
          last_status: "ok",
          last_error: null,
          last_evaluated_at: nowIso,
        });
        continue;
      }

      const rows = result.rows;
      const newWatermark = String(rows[rows.length - 1].plexus_ts);

      // Discovered-entity alerts fire against the DISCOVERED source (the
      // monitor's own source), not the parent connection polled for data.
      const alertSource = entity?.source ?? source;
      const fired =
        unit.kind === "event"
          ? await fireEventBatch(unit.row, alertSource, target, rows, nowIso)
          : await fireLimitBatch(unit.row, alertSource, target, rows, nowIso);
      if (fired) stats.fired++;

      // Advance even when nothing fired (dedup suppression, or no violating
      // values in a limit batch) — these rows are evaluated, done, final.
      await updatePollState(unit, monitor.org_id, {
        poll_watermark: newWatermark,
        last_polled_at: nowIso,
        last_status: "ok",
        last_error: null,
        last_evaluated_at: nowIso,
      });
    } catch (err) {
      stats.errors++;
      recordFailure(source.id);
      const message = err instanceof Error ? err.message : String(err);
      console.error("[detect-poll] monitor failed:", monitor.id, message);
      await recordHealth(
        unit,
        monitor.org_id,
        "error",
        message,
        new Date().toISOString(),
      );
    }
  }
}

interface PolledTarget {
  table: string;
  schema?: string;
  timeColumn: string;
  /** Entity predicate applied for discovered sources. */
  filterColumn?: string;
  filterValue?: string;
}

type PolledRow = Record<string, unknown>;

/**
 * Scalar poll facts, spread at the TOP LEVEL of context_snapshot: the alert
 * panel, email, and Slack renderers all show scalar snapshot entries and skip
 * nested objects, so nesting these (the old `_poll` shape) hid them entirely.
 */
function pollContext(
  target: PolledTarget,
  rows: PolledRow[],
): Record<string, unknown> {
  const last = rows[rows.length - 1];
  return {
    table: target.table,
    ...(target.filterColumn != null && target.filterValue != null
      ? { filter_column: target.filterColumn, filter_value: target.filterValue }
      : {}),
    row_count: rows.length,
    ...(rows.length === POLL_ROW_LIMIT ? { truncated: true } : {}),
    first_ts: String(rows[0].plexus_ts),
    last_ts: String(last.plexus_ts),
    latest_value: String(last.plexus_value),
  };
}

/** The last row's context-column values, keyed by column name. */
function contextValues(
  contextColumns: string[] | null,
  row: PolledRow,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [i, col] of (contextColumns ?? []).entries()) {
    const v = row[`plexus_ctx_${i}`];
    if (v !== undefined && v !== null) values[col] = String(v);
  }
  return values;
}

const MAX_SAMPLE_ROWS = 3;
/** per_row delivery: individual alerts per tick before collapsing to a digest. */
const MAX_PER_ROW_ALERTS = 10;

/** "email=ann@example.com, name=Ann" or "metric = value" for one row. */
function rowDetail(
  monitor: EventMonitorRecord,
  row: PolledRow,
): { detail: string; hasContext: boolean; values: Record<string, string> } {
  const values = contextValues(monitor.context_columns, row);
  const pairs = Object.entries(values);
  return pairs.length > 0
    ? { detail: pairs.map(([k, v]) => `${k}=${v}`).join(", "), hasContext: true, values }
    : {
        detail: `${monitor.metric} = ${String(row.plexus_value)}`,
        hasContext: false,
        values,
      };
}

function visualizationSnapshot(
  monitor: EventMonitorRecord,
): Record<string, unknown> {
  return monitor.visualization
    ? { _visualization: JSON.parse(JSON.stringify(monitor.visualization)) }
    : {};
}

async function fireEventBatch(
  monitor: EventMonitorRecord,
  source: Source,
  target: PolledTarget,
  rows: PolledRow[],
  nowIso: string,
): Promise<boolean> {
  if (monitor.delivery === "per_row") {
    return fireEventPerRow(monitor, source, target, rows, nowIso);
  }

  const last = rows[rows.length - 1];
  const { detail, hasContext, values: lastValues } = rowDetail(monitor, last);

  // "New users row — email=ann@example.com, name=Ann (+2 more)" when context
  // columns are configured; the monitored column's value otherwise.
  const more = rows.length > 1 ? ` (+${rows.length - 1} more)` : "";
  const defaultMessage = hasContext
    ? `New ${target.table} row — ${detail}${more}`
    : `New event: ${detail}${more}`;

  // Newest-first sample rows, kept under an underscore key: renderers skip
  // object values, so these are for the API/detail views, not the flat rows.
  const samples =
    monitor.context_columns?.length && rows.length > 0
      ? rows.slice(-MAX_SAMPLE_ROWS).reverse().map((row) => ({
          ts: String(row.plexus_ts),
          value: String(row.plexus_value),
          ...contextValues(monitor.context_columns, row),
        }))
      : null;

  const alert = await fireEventAlert({
    orgId: monitor.org_id,
    sourceId: source.id,
    source,
    metric: monitor.metric,
    // A new row IS the event; the honest numeric value is how many arrived.
    value: rows.length,
    severity: monitor.severity,
    triggeredAt: nowIso,
    message: monitor.message || defaultMessage,
    contextSnapshot: {
      ...pollContext(target, rows),
      ...lastValues,
      ...(samples ? { _samples: samples } : {}),
      ...visualizationSnapshot(monitor),
    },
    eventMetadata: {
      value: rows.length,
      monitor_id: monitor.id,
      table: target.table,
      time_column: target.timeColumn,
    },
  });
  return alert !== null;
}

/**
 * per_row delivery: one alert per matching row (each bypasses the dedup
 * window — every row is a distinct event), capped at MAX_PER_ROW_ALERTS per
 * tick; the overflow collapses into one digest alert so a backfill can't
 * storm the notification channels.
 */
async function fireEventPerRow(
  monitor: EventMonitorRecord,
  source: Source,
  target: PolledTarget,
  rows: PolledRow[],
  nowIso: string,
): Promise<boolean> {
  let fired = false;
  const individual = rows.slice(0, MAX_PER_ROW_ALERTS);
  for (const row of individual) {
    const { detail, hasContext, values } = rowDetail(monitor, row);
    const defaultMessage = hasContext
      ? `New ${target.table} row — ${detail}`
      : `New event: ${detail}`;
    const alert = await fireEventAlert({
      orgId: monitor.org_id,
      sourceId: source.id,
      source,
      metric: monitor.metric,
      value: 1,
      severity: monitor.severity,
      triggeredAt: nowIso,
      message: monitor.message || defaultMessage,
      skipDedup: true,
      contextSnapshot: {
        table: target.table,
        row_ts: String(row.plexus_ts),
        latest_value: String(row.plexus_value),
        ...values,
        ...visualizationSnapshot(monitor),
      },
      eventMetadata: {
        value: 1,
        monitor_id: monitor.id,
        table: target.table,
        time_column: target.timeColumn,
      },
    });
    fired = fired || alert !== null;
  }

  const overflow = rows.length - individual.length;
  if (overflow > 0) {
    const alert = await fireEventAlert({
      orgId: monitor.org_id,
      sourceId: source.id,
      source,
      metric: monitor.metric,
      value: overflow,
      severity: monitor.severity,
      triggeredAt: nowIso,
      message: `${overflow} more new ${target.table} rows in the same batch`,
      skipDedup: true,
      contextSnapshot: {
        ...pollContext(target, rows),
        ...visualizationSnapshot(monitor),
      },
      eventMetadata: {
        value: overflow,
        monitor_id: monitor.id,
        table: target.table,
        time_column: target.timeColumn,
      },
    });
    fired = fired || alert !== null;
  }
  return fired;
}

async function fireLimitBatch(
  limit: SourceLimitRecord,
  source: Source,
  target: PolledTarget,
  rows: PolledRow[],
  nowIso: string,
): Promise<boolean> {
  // Evaluate every new value; fire once on the first (earliest) violation.
  let violations = 0;
  let first: { value: number; bound: "min" | "max"; threshold: number } | null =
    null;
  for (const row of rows) {
    const raw = row.plexus_value;
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) continue;

    const evaluation = evaluateLimit(value, {
      min: limit.min ?? undefined,
      max: limit.max ?? undefined,
      severity: limit.severity,
    });
    if (!evaluation.isViolation) continue;

    violations++;
    first ??= {
      value,
      bound: evaluation.violatedBound!,
      threshold:
        evaluation.violatedBound === "min" ? limit.min! : limit.max!,
    };
  }
  if (!first) return false;

  const alert = await fireLimitAlert({
    orgId: limit.org_id,
    sourceId: source.id,
    source,
    metric: limit.metric,
    value: first.value,
    bound: first.bound,
    threshold: first.threshold,
    severity: limit.severity,
    limitId: limit.id,
    triggeredAt: nowIso,
    message: limit.message,
    contextSnapshot: { ...pollContext(target, rows), violations },
    eventMetadata: {
      value: first.value,
      limit: { min: limit.min, max: limit.max, severity: limit.severity },
      violations,
      table: target.table,
      time_column: target.timeColumn,
    },
  });
  return alert !== null;
}

// ---------------------------------------------------------------------------
// Device sources (owned ClickHouse store)
// ---------------------------------------------------------------------------

/**
 * The owned store keys telemetry by (org_id, source_id=SLUG, metric,
 * timestamp DateTime64(3)) — exactly this query's shape, so it rides the
 * sorting key. Parameters are bound (query_params), not inlined.
 */
async function pollDeviceEventMonitor(
  monitor: EventMonitorRecord,
  source: Source,
  stats: PollStats,
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (!process.env.PLEXUS_CLICKHOUSE_URL) {
    stats.skipped++;
    await eventMonitorQueries.updatePollState(monitor.org_id, monitor.id, {
      last_status: "skipped",
      last_error: "Telemetry store not configured for this deployment",
      last_evaluated_at: nowIso,
    });
    return;
  }
  const client = getClient();
  const params = {
    org: monitor.org_id,
    sid: source.slug,
    metric: monitor.metric,
  };

  if (!monitor.poll_watermark) {
    const res = await client.query({
      query: `
        SELECT if(count() = 0, toString(now64(3)), toString(max(timestamp))) AS plexus_wm
        FROM telemetry
        WHERE org_id = {org:String} AND source_id = {sid:String} AND metric = {metric:String}
      `,
      query_params: params,
      format: "JSONEachRow",
    });
    const [row] = (await res.json()) as { plexus_wm: string }[];
    if (!row?.plexus_wm) throw new Error("init watermark query returned no row");
    await eventMonitorQueries.updatePollState(monitor.org_id, monitor.id, {
      poll_watermark: row.plexus_wm,
      last_polled_at: nowIso,
      last_status: "ok",
      last_error: null,
      last_evaluated_at: nowIso,
    });
    stats.initialized++;
    return;
  }

  const res = await client.query({
    query: `
      SELECT toString(timestamp) AS plexus_ts, value AS plexus_value
      FROM telemetry
      WHERE org_id = {org:String} AND source_id = {sid:String} AND metric = {metric:String}
        AND timestamp > {wm:DateTime64(3, 'UTC')}
      ORDER BY timestamp ASC
      LIMIT ${POLL_ROW_LIMIT}
    `,
    query_params: { ...params, wm: monitor.poll_watermark },
    format: "JSONEachRow",
  });
  const rows = (await res.json()) as PolledRow[];

  if (rows.length === 0) {
    await eventMonitorQueries.updatePollState(monitor.org_id, monitor.id, {
      last_polled_at: nowIso,
      last_status: "ok",
      last_error: null,
      last_evaluated_at: nowIso,
    });
    return;
  }

  const fired = await fireEventBatch(
    monitor,
    source,
    { table: "telemetry", timeColumn: "timestamp" },
    rows,
    nowIso,
  );
  if (fired) stats.fired++;

  await eventMonitorQueries.updatePollState(monitor.org_id, monitor.id, {
    poll_watermark: String(rows[rows.length - 1].plexus_ts),
    last_polled_at: nowIso,
    last_status: "ok",
    last_error: null,
    last_evaluated_at: nowIso,
  });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function fetchSchemaThrottled(
  source: Source,
  connectionString: string,
  sshTunnel: ReturnType<typeof buildSSHTunnelConfig>,
): Promise<SchemaInfo | null> {
  const lastAttempt = schemaFetchAttempts.get(source.id) ?? 0;
  if (Date.now() - lastAttempt < SCHEMA_FETCH_MIN_INTERVAL_MS) return null;
  schemaFetchAttempts.set(source.id, Date.now());

  try {
    const schema = await singleflight(`schema:${source.id}`, () =>
      getSchema({
        type: source.connection_type as DataSourceType,
        connectionString,
        sshTunnel,
        existingConfig: (source.config as Record<string, unknown>) ?? {},
      }),
    );
    // Persist so the UI and future ticks get it for free (merges config).
    await adminSourceQueries.updateLastConnected(source.id, {
      schemaSnapshot: schema,
      schemaCheckedAt: new Date().toISOString(),
    });
    return schema;
  } catch (err) {
    recordFailure(source.id);
    console.warn(
      "[detect-poll] schema fetch failed:",
      source.id,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function logSkip(sourceId: string, monitorId: string, reasons: string[]): void {
  console.warn(
    JSON.stringify({
      event: "poll_skip",
      source: sourceId,
      monitor: monitorId,
      reasons,
    }),
  );
}

/** Small worker pool — same shape as the check-connections cron. */
async function processInBatches<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}
