/**
 * discoverOnce — one tick of entity discovery across every org.
 *
 * For each online connection with discovery rules: read the distinct identity
 * values, mint (or converge on) one source per value, upsert the association
 * row that carries the slice predicate, and refresh per-entity freshness from
 * one grouped MAX(time) query. Mirrors detect-poll's safety conventions:
 * per-connection circuit breaker, 10s query timeout, error isolation — one
 * broken customer DB never stalls the tick.
 *
 * Runs on the always-on Fly machine via lib/scheduler/discovery-loop.ts.
 */
import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sources } from "@/lib/db/schema";
import { sourceAssociationQueries } from "@/lib/db/queries/sources";
import { adminSourceQueries } from "@/lib/db/server";
import type { Source, DataSourceType } from "@/lib/db/types";
import { decrypt } from "@/lib/encryption";
import {
  executeQuery,
  buildSSHTunnelConfig,
} from "@/lib/db/data-source-connections";
import {
  checkCircuit,
  recordSuccess,
  recordFailure,
} from "@/lib/db/query-cache";
import { isPollDialect } from "@/lib/alerts/event-poll-sql";
import { buildDistinctIdentitySql, buildFreshnessSql } from "./sql";
import { discoveryRulesOf, type DiscoveryRule } from "./types";
import { slugForIdentity } from "./identity";

const QUERY_TIMEOUT_MS = 10_000;
/** Per-tick cache of already-synced (org, slug) pairs, like the register route. */
const knownEntityCache = new Set<string>();

export interface DiscoveryStats {
  connections: number;
  rules: number;
  discovered: number;
  converged: number;
  freshness: number;
  errors: number;
}

export async function discoverOnce(): Promise<DiscoveryStats> {
  const stats: DiscoveryStats = {
    connections: 0,
    rules: 0,
    discovered: 0,
    converged: 0,
    freshness: 0,
    errors: 0,
  };

  const connections = (await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.source_type, "connection"),
        eq(sources.status, "online"),
        isNotNull(sources.credentials_encrypted),
      ),
    )) as Source[];

  for (const connection of connections) {
    const rules = discoveryRulesOf(
      connection.config as Record<string, unknown>,
    ).filter((r) => r.enabled);
    if (rules.length === 0) continue;
    if (!isPollDialect(connection.connection_type ?? null)) continue;
    if (checkCircuit(connection.id)) continue;
    stats.connections++;

    for (const rule of rules) {
      stats.rules++;
      try {
        const result = await syncRule(connection, rule, stats);
        recordSuccess(connection.id);
        void result;
      } catch (err) {
        stats.errors++;
        recordFailure(connection.id);
        console.error(
          JSON.stringify({
            event: "discovery_rule_failed",
            connection: connection.slug,
            table: rule.table,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }

  return stats;
}

/** Sync one rule end-to-end. Exported for the inline run on rule save. */
export async function syncRule(
  connection: Source,
  rule: DiscoveryRule,
  stats: DiscoveryStats,
): Promise<void> {
  const dialect = connection.connection_type ?? null;
  if (!isPollDialect(dialect)) return;
  const connectionString = decrypt(connection.credentials_encrypted!);
  const sshTunnel = connection.ssh_credentials_encrypted
    ? buildSSHTunnelConfig(
        (connection.metadata || {}) as Record<string, unknown>,
        decrypt(connection.ssh_credentials_encrypted),
      )
    : undefined;
  const runQuery = (query: string) =>
    executeQuery({
      type: dialect as DataSourceType,
      connectionString,
      query,
      timeout: QUERY_TIMEOUT_MS,
      sshTunnel,
      existingConfig: (connection.config as Record<string, unknown>) ?? {},
    });

  // 1) Distinct identities → mint or converge.
  const identityResult = await runQuery(
    buildDistinctIdentitySql(dialect, rule),
  );
  const values = identityResult.rows
    .map((r) => r.plexus_id)
    .filter((v): v is string | number => v !== null && v !== undefined)
    .map(String);

  const entityIdBySlug = new Map<string, string>();
  for (const raw of values) {
    const slug = slugForIdentity(raw, rule.kind);
    const cacheKey = `${connection.org_id}:${slug}`;
    let entity: Source | null = null;

    if (!knownEntityCache.has(cacheKey)) {
      try {
        const inserted = await adminSourceQueries.insert(connection.org_id, {
          source_type: "device",
          slug,
          name: raw,
          status: "pending",
          device_type: rule.kind,
          metadata: {
            auto_created: true,
            discovered_from: connection.id,
            identity_value: raw,
          },
        });
        entity = inserted[0] ?? null;
        if (entity) stats.discovered++;
      } catch (err) {
        // Unique violation → the entity already exists (possibly a REAL push
        // device with the same slug — one entity, two feeds). Converge on it.
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!entity) {
      entity = await adminSourceQueries.resolveRef(connection.org_id, slug);
      if (entity) stats.converged++;
    }
    if (!entity) continue;
    knownEntityCache.add(cacheKey);
    entityIdBySlug.set(slug, entity.id);

    await sourceAssociationQueries.upsert(connection.org_id, {
      entity_type: "device",
      entity_id: entity.id,
      connection_id: connection.id,
      table_name: rule.table,
      table_schema: rule.schema ?? null,
      filter_column: rule.idColumn,
      filter_value: raw,
      label: raw,
    });

    // Compat mirror: existing readers (device-page chip, linked-devices list,
    // satellite-sheet-style slicing) consume metadata.linked_connections.
    // The association table stays the source of truth.
    const meta = (entity.metadata ?? {}) as Record<string, unknown>;
    const linked = Array.isArray(meta.linked_connections)
      ? (meta.linked_connections as Record<string, unknown>[])
      : [];
    const already = linked.some(
      (l) => l.connection_id === connection.id && l.filter_value === raw,
    );
    if (!already) {
      await adminSourceQueries.update(entity.id, {
        metadata: {
          ...meta,
          linked_connections: [
            ...linked,
            {
              connection_id: connection.id,
              filter_column: rule.idColumn,
              filter_value: raw,
            },
          ],
        },
      });
    }
  }

  // 2) Freshness: one grouped query → last_seen_at per entity.
  if (rule.timeColumn) {
    const freshness = await runQuery(
      buildFreshnessSql(dialect, { ...rule, timeColumn: rule.timeColumn }),
    );
    for (const row of freshness.rows) {
      const raw = row.plexus_id;
      const seen = row.last_seen;
      if (raw === null || raw === undefined || !seen) continue;
      const entityId = entityIdBySlug.get(
        slugForIdentity(String(raw), rule.kind),
      );
      if (!entityId) continue;
      const iso = toIso(seen);
      if (!iso) continue;
      await adminSourceQueries.update(entityId, { last_seen_at: iso });
      stats.freshness++;
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } })?.cause;
  if (cause?.code === "23505") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("duplicate") || msg.includes("unique");
}

function toIso(value: unknown): string | null {
  const d =
    value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
