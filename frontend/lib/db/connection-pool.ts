/**
 * Connection Pool Singleton
 *
 * Caches database connection pools keyed by connection string hash.
 * Pools are automatically cleaned up after 5 minutes of inactivity.
 *
 * NOTE: This module is server-only due to credential handling.
 */

import "server-only";

import { createHash } from "crypto";
import { Pool } from "pg";
import {
  createClient as createClickHouseClient,
  type ClickHouseClient,
} from "@clickhouse/client";
import mysql from "mysql2/promise";

// =============================================================================
// Types
// =============================================================================

interface PoolEntry<T> {
  pool: T;
  lastUsed: number;
}

// =============================================================================
// Pool Caches
// =============================================================================

const pgPools = new Map<string, PoolEntry<Pool>>();
const chClients = new Map<string, PoolEntry<ClickHouseClient>>();
const mysqlPools = new Map<string, PoolEntry<mysql.Pool>>();

const POOL_TTL = 5 * 60 * 1000; // 5 min idle timeout
const CLEANUP_INTERVAL = 60_000; // check every 60s

// =============================================================================
// Hash Helper
// =============================================================================

function hashConnectionString(connectionString: string): string {
  return createHash("sha256")
    .update(connectionString)
    .digest("hex")
    .slice(0, 16);
}

// =============================================================================
// Postgres Pool
// =============================================================================

export function getPostgresPool(config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  connectionTimeoutMillis?: number;
  statement_timeout?: number;
}): Pool {
  const key = hashConnectionString(
    `pg://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`,
  );

  const existing = pgPools.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.pool;
  }

  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 10000,
    statement_timeout: config.statement_timeout ?? 30000,
    max: 10,
  });

  pgPools.set(key, { pool, lastUsed: Date.now() });
  return pool;
}

// =============================================================================
// ClickHouse Client
// =============================================================================

export function getClickHouseClient(config: {
  url: string;
  username: string;
  password: string;
  database: string;
  request_timeout?: number;
}): ClickHouseClient {
  const key = hashConnectionString(
    `ch://${config.username}:${config.password}@${config.url}/${config.database}`,
  );

  const existing = chClients.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.pool;
  }

  const client = createClickHouseClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    request_timeout: config.request_timeout ?? 30000,
    max_open_connections: 10,
  });

  chClients.set(key, { pool: client, lastUsed: Date.now() });
  return client;
}

// =============================================================================
// MySQL Pool
// =============================================================================

export function getMySQLPool(config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  connectTimeout?: number;
}): mysql.Pool {
  const key = hashConnectionString(
    `mysql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`,
  );

  const existing = mysqlPools.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.pool;
  }

  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: config.connectTimeout ?? 10000,
    connectionLimit: 10,
    waitForConnections: true,
  });

  mysqlPools.set(key, { pool, lastUsed: Date.now() });
  return pool;
}

// =============================================================================
// Cleanup
// =============================================================================

async function cleanupIdlePools() {
  const now = Date.now();

  for (const [key, entry] of pgPools) {
    if (now - entry.lastUsed > POOL_TTL) {
      await entry.pool.end().catch(() => {});
      pgPools.delete(key);
    }
  }

  for (const [key, entry] of chClients) {
    if (now - entry.lastUsed > POOL_TTL) {
      await entry.pool.close().catch(() => {});
      chClients.delete(key);
    }
  }

  for (const [key, entry] of mysqlPools) {
    if (now - entry.lastUsed > POOL_TTL) {
      await entry.pool.end().catch(() => {});
      mysqlPools.delete(key);
    }
  }
}

// Start periodic cleanup (safe in Node.js server context)
const cleanupTimer = setInterval(cleanupIdlePools, CLEANUP_INTERVAL);
// Don't block process exit
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}
