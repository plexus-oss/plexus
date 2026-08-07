/**
 * Data Source Connection Utilities — dispatch facade
 *
 * All per-driver logic lives in lib/db/drivers/. This file:
 * - Preserves all public exports for backward compatibility
 * - Routes testConnection / getSchema / executeQuery through the driver registry
 */

import "server-only";

import { createClient as createClickHouseClient } from "@clickhouse/client";
import type { DataSourceType } from "./types";
import { getDriver } from "./drivers/registry";
import type { DriverContext, SchemaInfo } from "./drivers/types";
import type { SSHTunnelConfig } from "./ssh-tunnel";
import { validateReadOnlyQuery } from "./drivers/shared/query-helpers";
import { clickhouseDriver } from "./drivers/clickhouse";
import { encrypt, decrypt } from "@/lib/encryption";
import { adminSourceQueries } from "@/lib/db/server";

// =============================================================================
// Re-exports (preserve existing import paths)
// =============================================================================

export type {
  ConnectionTestResult,
  QueryResult,
  SchemaInfo,
} from "./drivers/types";

export type { SSHTunnelConfig } from "./ssh-tunnel";

export { validateReadOnlyQuery } from "./drivers/shared/query-helpers";

// =============================================================================
// Public connection/query config types (unchanged interface)
// =============================================================================

export interface ConnectionConfig {
  type: DataSourceType;
  connectionString: string;
  sshTunnel?: SSHTunnelConfig;
  existingConfig?: Record<string, unknown>;
}

export interface QueryConfig {
  type: DataSourceType;
  connectionString: string;
  query: string;
  params?: Record<string, unknown> & { __filterParams?: unknown[] };
  limit?: number;
  timeout?: number;
  sshTunnel?: SSHTunnelConfig;
  existingConfig?: Record<string, unknown>;
}

// =============================================================================
// SSH TUNNEL HELPER (kept in facade — cross-cutting concern)
// =============================================================================

/**
 * Build an SSHTunnelConfig from a source's metadata and decrypted SSH credential.
 * Returns undefined if SSH tunnel is not configured.
 */
export function buildSSHTunnelConfig(
  metadata: Record<string, unknown>,
  decryptedSshCredential: string,
): SSHTunnelConfig | undefined {
  const sshMeta = metadata?.ssh_tunnel as
    | {
        enabled?: boolean;
        host?: string;
        port?: number;
        username?: string;
        auth_method?: "private_key" | "password";
      }
    | undefined;

  if (!sshMeta?.enabled || !sshMeta.host || !sshMeta.username) return undefined;

  return {
    host: sshMeta.host,
    port: sshMeta.port || 22,
    username: sshMeta.username,
    ...(sshMeta.auth_method === "password"
      ? { password: decryptedSshCredential }
      : { privateKey: decryptedSshCredential }),
  };
}

// =============================================================================
// DriverContext builder — handles legacy URL format and new JSON creds format
// =============================================================================

function buildDriverContext(
  type: DataSourceType,
  connectionString: string,
  sshTunnel?: SSHTunnelConfig,
  existingConfig?: Record<string, unknown>,
): DriverContext {
  const driver = getDriver(type);
  // New format: credentials_encrypted decrypts to a JSON object
  if (connectionString.trimStart().startsWith("{")) {
    const creds = JSON.parse(connectionString);
    return { type, config: existingConfig ?? {}, creds, sshTunnel };
  }
  // Legacy format: full connection URL
  const { config: parsedConfig, creds } = driver.parseConnectionString(connectionString);
  return { type, config: { ...parsedConfig, ...(existingConfig ?? {}) }, creds, sshTunnel };
}

// =============================================================================
// Lazy migration: rewrite legacy URL creds to JSON format on first successful use
// =============================================================================

export async function maybeMigrateLegacySource(
  sourceId: string,
  type: DataSourceType,
  credentialsEncrypted: string,
  existingConfig: Record<string, unknown>,
): Promise<void> {
  const raw = decrypt(credentialsEncrypted);
  if (raw.trimStart().startsWith("{")) return; // already migrated

  try {
    const driver = getDriver(type);
    const { config: parsedConfig, creds } = driver.parseConnectionString(raw);
    await adminSourceQueries.update(sourceId, {
      credentials_encrypted: encrypt(JSON.stringify(creds)),
      config: { ...parsedConfig, ...existingConfig },
    });
  } catch {
    // Best-effort — never block the caller
  }
}

// =============================================================================
// Main dispatched exports
// =============================================================================

export async function testConnection(config: ConnectionConfig) {
  const driver = getDriver(config.type);
  const ctx = buildDriverContext(config.type, config.connectionString, config.sshTunnel, config.existingConfig);
  return driver.testConnection(ctx);
}

export async function getSchema(config: ConnectionConfig) {
  const driver = getDriver(config.type);
  const ctx = buildDriverContext(config.type, config.connectionString, config.sshTunnel, config.existingConfig);
  return driver.getSchema(ctx);
}

export async function executeQuery(config: QueryConfig) {
  if (config.type !== "influxdb") {
    const validation = validateReadOnlyQuery(config.query);
    if (!validation.valid) throw new Error(validation.error);
  }
  const driver = getDriver(config.type);
  const ctx = buildDriverContext(config.type, config.connectionString, config.sshTunnel, config.existingConfig);
  return driver.executeQuery(ctx, {
    query: config.query,
    params: config.params,
    limit: config.limit,
    timeout: config.timeout,
  });
}

// =============================================================================
// Named per-driver schema helpers (preserved for backward compat)
// =============================================================================

export async function getPostgresSchema(
  connectionString: string,
  sshTunnel?: SSHTunnelConfig,
): Promise<SchemaInfo> {
  return getSchema({ type: "postgres", connectionString, sshTunnel });
}

export async function getClickHouseSchema(
  connectionString: string,
): Promise<SchemaInfo> {
  return getSchema({ type: "clickhouse", connectionString });
}

export async function getInfluxDBSchema(
  connectionString: string,
): Promise<SchemaInfo> {
  return getSchema({ type: "influxdb", connectionString });
}

export async function getMySQLSchema(
  connectionString: string,
  sshTunnel?: SSHTunnelConfig,
): Promise<SchemaInfo> {
  return getSchema({ type: "mysql", connectionString, sshTunnel });
}

// =============================================================================
// SCHEMA DRIFT DETECTION (unchanged, cross-driver concern)
// =============================================================================

export interface SchemaDriftChange {
  table: string;
  type:
    | "table_added"
    | "table_removed"
    | "column_added"
    | "column_removed"
    | "column_type_changed";
  column?: string;
  oldType?: string;
  newType?: string;
}

export interface SchemaDrift {
  detectedAt: string;
  changes: SchemaDriftChange[];
}

/**
 * Compare two SchemaInfo snapshots and return the differences.
 * Returns null if the schemas are identical.
 */
export function diffSchema(
  previous: SchemaInfo,
  current: SchemaInfo,
): SchemaDrift | null {
  const changes: SchemaDriftChange[] = [];

  const prevTables = new Map(
    previous.tables.map((t) => {
      const key = t.schema ? `${t.schema}.${t.name}` : t.name;
      return [key, t];
    }),
  );
  const currTables = new Map(
    current.tables.map((t) => {
      const key = t.schema ? `${t.schema}.${t.name}` : t.name;
      return [key, t];
    }),
  );

  for (const [key, table] of prevTables) {
    if (!currTables.has(key)) {
      changes.push({ table: table.name, type: "table_removed" });
    }
  }

  for (const [key, currTable] of currTables) {
    const prevTable = prevTables.get(key);
    if (!prevTable) {
      changes.push({ table: currTable.name, type: "table_added" });
      continue;
    }

    const prevCols = new Map(prevTable.columns.map((c) => [c.name, c]));
    const currCols = new Map(currTable.columns.map((c) => [c.name, c]));

    for (const [colName] of prevCols) {
      if (!currCols.has(colName)) {
        changes.push({ table: currTable.name, type: "column_removed", column: colName });
      }
    }

    for (const [colName, currCol] of currCols) {
      const prevCol = prevCols.get(colName);
      if (!prevCol) {
        changes.push({ table: currTable.name, type: "column_added", column: colName });
      } else if (prevCol.type !== currCol.type) {
        changes.push({
          table: currTable.name,
          type: "column_type_changed",
          column: colName,
          oldType: prevCol.type,
          newType: currCol.type,
        });
      }
    }
  }

  if (changes.length === 0) return null;

  return { detectedAt: new Date().toISOString(), changes };
}

// =============================================================================
// TELEMETRY QUERY OPERATIONS (Read from user's ClickHouse for RCA)
// =============================================================================

function toClickHouseDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().replace("Z", "");
}

export interface TelemetryQueryOptions {
  sourceId: string;
  metric?: string;
  start: Date;
  end: Date;
  limit?: number;
}

export interface TelemetryRow {
  source_id: string;
  metric: string;
  value: number;
  value_string: string | null;
  value_json: string | null;
  timestamp: string;
  tags: Record<string, string>;
}

/**
 * Query telemetry data from a user's ClickHouse connection.
 * Used for RCA correlation analysis.
 */
export async function queryTelemetry(
  connectionString: string,
  options: TelemetryQueryOptions,
): Promise<TelemetryRow[]> {
  const { config: chConfig, creds } = clickhouseDriver.parseConnectionString(connectionString);
  const limit = options.limit || 10000;

  const client = createClickHouseClient({
    url: chConfig.url as string,
    username: chConfig.username as string,
    password: creds.password ?? "",
    database: chConfig.database as string,
    request_timeout: 30000,
  });

  try {
    const metricFilter = options.metric ? `AND metric = {metric:String}` : "";

    const query = `
      SELECT
        source_id,
        metric,
        value,
        value_string,
        value_json,
        timestamp,
        tags
      FROM telemetry
      WHERE source_id = {sourceId:String}
        AND timestamp >= {start:DateTime64(3, 'UTC')}
        AND timestamp <= {end:DateTime64(3, 'UTC')}
        ${metricFilter}
      ORDER BY timestamp ASC
      LIMIT {limit:UInt32}
    `;

    const result = await client.query({
      query,
      query_params: {
        sourceId: options.sourceId,
        start: toClickHouseDateTime(options.start),
        end: toClickHouseDateTime(options.end),
        ...(options.metric ? { metric: options.metric } : {}),
        limit,
      },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as TelemetryRow[];
    return rows;
  } catch (error) {
    console.error("[queryTelemetry] Error:", error);
    return [];
  } finally {
    await client.close();
  }
}
