import "server-only";
import { Pool } from "pg";
import { Client as PgClient } from "pg";
import type {
  ConnectionDriver, DriverContext, DriverConfig, DriverCredentials,
  ConnectionTestResult, SchemaInfo, QueryResult, QueryOptions,
} from "./types";
import { withTunnel } from "./shared/ssh-helpers";
import { mapPgType } from "./shared/type-mappers";
import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, DEFAULT_QUERY_TIMEOUT } from "./shared/query-helpers";
import { getPostgresPool } from "../connection-pool";

interface ParsedPgConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  sslExplicit?: boolean;
}

function parsePostgresConnectionString(connectionString: string): ParsedPgConfig {
  const schemeMatch = connectionString.match(/^postgres(?:ql)?:\/\//i);
  if (!schemeMatch) {
    throw new Error("Invalid PostgreSQL connection string: must start with postgresql:// or postgres://");
  }

  const withoutScheme = connectionString.slice(schemeMatch[0].length);
  const slashIdx = withoutScheme.indexOf("/");
  const authority = slashIdx >= 0 ? withoutScheme.slice(0, slashIdx) : withoutScheme;
  const pathAndQuery = slashIdx >= 0 ? withoutScheme.slice(slashIdx) : "/";

  const lastAt = authority.lastIndexOf("@");
  if (lastAt === -1) {
    throw new Error("Invalid PostgreSQL connection string: missing credentials (user:password@host)");
  }

  const userInfo = authority.slice(0, lastAt);
  const hostPort = authority.slice(lastAt + 1);

  const colonIdx = userInfo.indexOf(":");
  const rawUser = colonIdx >= 0 ? userInfo.slice(0, colonIdx) : userInfo;
  const rawPassword = colonIdx >= 0 ? userInfo.slice(colonIdx + 1) : "";

  const safeDecode = (s: string) => {
    try { return decodeURIComponent(s); } catch { return s; }
  };

  let host: string;
  let port: number;
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    host = hostPort.slice(1, close);
    port = parseInt(hostPort.slice(close + 2)) || 5432;
  } else {
    const [h, p] = hostPort.split(":");
    host = h;
    port = parseInt(p) || 5432;
  }

  const queryIdx = pathAndQuery.indexOf("?");
  const database = queryIdx >= 0 ? pathAndQuery.slice(1, queryIdx) : pathAndQuery.slice(1);
  const sslmode = queryIdx >= 0
    ? new URLSearchParams(pathAndQuery.slice(queryIdx + 1)).get("sslmode")
    : null;

  return {
    host,
    port,
    database,
    user: safeDecode(rawUser),
    password: safeDecode(rawPassword),
    ssl: sslmode !== "disable",
    sslExplicit: sslmode !== null,
  };
}

function ctxToConfig(ctx: DriverContext): ParsedPgConfig {
  return {
    host: ctx.config.host as string,
    port: ctx.config.port as number,
    database: ctx.config.database as string,
    user: ctx.config.user as string,
    password: ctx.creds.password ?? "",
    ssl: ctx.config.ssl as boolean | undefined,
    sslExplicit: ctx.config.sslExplicit as boolean | undefined,
  };
}

const PG_SCHEMA_EXCLUSIONS = `
  'pg_catalog', 'information_schema',
  'auth', 'storage', 'realtime', 'extensions', 'supabase_functions',
  'supabase_migrations', 'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks',
  'vault', 'net', 'cron', 'pgbouncer', 'dbdev', 'tiger', 'tiger_data', 'topology'
`;

class PostgresDriver implements ConnectionDriver {
  readonly supportsTunnel = true;

  parseConnectionString(connectionString: string): { config: DriverConfig; creds: DriverCredentials } {
    const { password, ...rest } = parsePostgresConnectionString(connectionString);
    return { config: rest as unknown as DriverConfig, creds: { password } };
  }

  toConnectionString(config: DriverConfig, creds: DriverCredentials): string {
    const c = config as Record<string, unknown>;
    const pass = creds.password ? `:${encodeURIComponent(creds.password)}` : "";
    const ssl = c.ssl === false ? "?sslmode=disable" : "";
    return `postgresql://${encodeURIComponent(c.user as string)}${pass}@${c.host}:${c.port}/${c.database}${ssl}`;
  }

  async testConnection(ctx: DriverContext): Promise<ConnectionTestResult> {
    let pool: Pool | null = null;
    let tunnelInfo: import("../ssh-tunnel").TunnelInfo | null = null;

    try {
      let config = ctxToConfig(ctx);

      if (ctx.sshTunnel) {
        const tunneled = await withTunnel(config, ctx.sshTunnel);
        config = tunneled.config;
        tunnelInfo = tunneled.tunnel;
      }

      pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 10000,
        max: 1,
      });

      const client = await pool.connect();

      const versionResult = await client.query("SELECT version()");
      const version = versionResult.rows[0]?.version?.split(" ")[0] || "PostgreSQL";

      const tablesResult = await client.query(`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_schema NOT IN (${PG_SCHEMA_EXCLUSIONS})
          AND table_schema NOT LIKE 'pg_temp%'
          AND table_schema NOT LIKE 'pg_toast%'
          AND table_schema NOT LIKE '_timescaledb%'
          AND table_schema NOT LIKE 'timescaledb_%'
      `);
      const tableCount = parseInt(tablesResult.rows[0]?.count) || 0;

      client.release();

      return {
        success: true,
        metadata: {
          host: ctxToConfig(ctx).host,
          database: ctxToConfig(ctx).database,
          version,
          tables: tableCount,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection failed";
      if (message.startsWith("SSH ") || message.startsWith("Cannot reach bastion")) {
        return { success: false, error: message };
      }
      return {
        success: false,
        error: message.includes("ECONNREFUSED")
          ? ctx.sshTunnel
            ? "Database unreachable through SSH tunnel - verify the RDS endpoint is accessible from the bastion host"
            : "Connection refused - check host and port"
          : message.includes("authentication")
            ? "Authentication failed - check username and password"
            : message.includes("does not exist")
              ? "Database does not exist"
              : message,
      };
    } finally {
      if (pool) await pool.end();
      if (tunnelInfo) await tunnelInfo.close();
    }
  }

  async getSchema(ctx: DriverContext): Promise<SchemaInfo> {
    let pool: Pool | null = null;
    let tunnelInfo: import("../ssh-tunnel").TunnelInfo | null = null;

    try {
      let config = ctxToConfig(ctx);

      if (ctx.sshTunnel) {
        const tunneled = await withTunnel(config, ctx.sshTunnel);
        config = tunneled.config;
        tunnelInfo = tunneled.tunnel;
      }

      pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : false,
        max: 1,
      });

      const client = await pool.connect();

      const result = await client.query(`
        SELECT
          t.table_schema,
          t.table_name,
          c.column_name,
          c.data_type,
          c.is_nullable
        FROM information_schema.tables t
        JOIN information_schema.columns c
          ON t.table_name = c.table_name
          AND t.table_schema = c.table_schema
        WHERE t.table_schema NOT IN (${PG_SCHEMA_EXCLUSIONS})
          AND t.table_schema NOT LIKE 'pg_temp%'
          AND t.table_schema NOT LIKE 'pg_toast%'
          AND t.table_schema NOT LIKE '_timescaledb%'
          AND t.table_schema NOT LIKE 'timescaledb_%'
        ORDER BY t.table_schema, t.table_name, c.ordinal_position
      `);

      const constraintResult = await client.query(`
        SELECT
          kcu.table_schema,
          kcu.table_name,
          kcu.column_name,
          tc.constraint_type,
          ccu.table_name AS foreign_table,
          ccu.column_name AS foreign_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        LEFT JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
          AND tc.table_schema NOT IN (${PG_SCHEMA_EXCLUSIONS})
      `);

      client.release();

      const constraints = new Map<string, { isPrimaryKey: boolean; foreignKey: { table: string; column: string } | null }>();
      for (const row of constraintResult.rows) {
        const key = `${row.table_schema}.${row.table_name}.${row.column_name}`;
        const existing = constraints.get(key) || { isPrimaryKey: false, foreignKey: null };
        if (row.constraint_type === "PRIMARY KEY") existing.isPrimaryKey = true;
        if (row.constraint_type === "FOREIGN KEY" && row.foreign_table && row.foreign_column) {
          existing.foreignKey = { table: row.foreign_table, column: row.foreign_column };
        }
        constraints.set(key, existing);
      }

      const tablesMap = new Map<string, SchemaInfo["tables"][0]>();
      for (const row of result.rows) {
        const key = `${row.table_schema}.${row.table_name}`;
        if (!tablesMap.has(key)) {
          tablesMap.set(key, { name: row.table_name, schema: row.table_schema, columns: [] });
        }
        const constraintKey = `${row.table_schema}.${row.table_name}.${row.column_name}`;
        const constraint = constraints.get(constraintKey);
        tablesMap.get(key)!.columns.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === "YES",
          isPrimaryKey: constraint?.isPrimaryKey || undefined,
          foreignKey: constraint?.foreignKey || undefined,
        });
      }

      return { tables: Array.from(tablesMap.values()) };
    } finally {
      if (pool) await pool.end();
      if (tunnelInfo) await tunnelInfo.close();
    }
  }

  async executeQuery(ctx: DriverContext, opts: QueryOptions): Promise<QueryResult> {
    const startTime = Date.now();
    let pgConfig = ctxToConfig(ctx);
    const limit = Math.min(opts.limit || DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

    if (ctx.sshTunnel) {
      const { config: tunneledConfig, tunnel } = await withTunnel(pgConfig, ctx.sshTunnel);
      pgConfig = tunneledConfig;

      const client = new PgClient({
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        user: pgConfig.user,
        password: pgConfig.password,
        ssl: pgConfig.ssl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: opts.timeout || DEFAULT_QUERY_TIMEOUT,
        statement_timeout: opts.timeout || DEFAULT_QUERY_TIMEOUT,
      });

      try {
        await client.connect();
        return await executeWithClient(client, opts, limit, startTime);
      } finally {
        await client.end();
        await tunnel.close();
      }
    }

    const pool = getPostgresPool({
      host: pgConfig.host,
      port: pgConfig.port,
      database: pgConfig.database,
      user: pgConfig.user,
      password: pgConfig.password,
      ssl: pgConfig.ssl,
      connectionTimeoutMillis: opts.timeout || DEFAULT_QUERY_TIMEOUT,
      statement_timeout: opts.timeout || DEFAULT_QUERY_TIMEOUT,
    });

    const client = await pool.connect();
    try {
      return await executeWithClient(client, opts, limit, startTime);
    } finally {
      client.release();
    }
  }
}

async function executeWithClient(
  client: {
    query(text: string, values?: unknown[]): Promise<{
      rows: Record<string, unknown>[];
      fields: { name: string; dataTypeID: number }[];
    }>;
  },
  opts: QueryOptions,
  limit: number,
  startTime: number,
): Promise<QueryResult> {
  let finalQuery = opts.query.trim();
  if (!/\bLIMIT\s+\d+/i.test(finalQuery)) {
    finalQuery = `SELECT * FROM (${finalQuery}) AS _q LIMIT ${limit + 1}`;
  }

  const filterParams = opts.params?.__filterParams;
  const queryParams =
    filterParams && filterParams.length > 0
      ? filterParams
      : opts.params
        ? Object.values(opts.params)
        : undefined;
  const result = await client.query(finalQuery, queryParams);

  const truncated = result.rows.length > limit;
  const rows = truncated ? result.rows.slice(0, limit) : result.rows;
  const columns = result.fields.map((f) => ({ name: f.name, type: mapPgType(f.dataTypeID) }));

  return { columns, rows, rowCount: rows.length, executionTimeMs: Date.now() - startTime, truncated };
}

export const postgresDriver = new PostgresDriver();
