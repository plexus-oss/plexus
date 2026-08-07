import "server-only";
import mysql from "mysql2/promise";
import type {
  ConnectionDriver, DriverContext, DriverConfig, DriverCredentials,
  ConnectionTestResult, SchemaInfo, QueryResult, QueryOptions,
} from "./types";
import { withTunnel } from "./shared/ssh-helpers";
import { mapMySQLType } from "./shared/type-mappers";
import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, DEFAULT_QUERY_TIMEOUT } from "./shared/query-helpers";
import { getMySQLPool } from "../connection-pool";

interface ParsedMySQLConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  sslExplicit?: boolean;
}

function parseMySQLConnectionString(connectionString: string): ParsedMySQLConfig {
  const schemeMatch = connectionString.match(/^mysql:\/\//i);
  if (!schemeMatch) throw new Error("Invalid MySQL connection string: must start with mysql://");

  const withoutScheme = connectionString.slice(schemeMatch[0].length);
  const slashIdx = withoutScheme.indexOf("/");
  const authority = slashIdx >= 0 ? withoutScheme.slice(0, slashIdx) : withoutScheme;
  const pathAndQuery = slashIdx >= 0 ? withoutScheme.slice(slashIdx) : "/";

  const lastAt = authority.lastIndexOf("@");
  if (lastAt === -1) throw new Error("Invalid MySQL connection string: missing credentials (user:password@host)");

  const userInfo = authority.slice(0, lastAt);
  const hostPort = authority.slice(lastAt + 1);

  const colonIdx = userInfo.indexOf(":");
  const rawUser = colonIdx >= 0 ? userInfo.slice(0, colonIdx) : userInfo;
  const rawPassword = colonIdx >= 0 ? userInfo.slice(colonIdx + 1) : "";

  const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

  const [h, p] = hostPort.split(":");
  const host = h;
  const port = parseInt(p) || 3306;

  const queryIdx = pathAndQuery.indexOf("?");
  const database = queryIdx >= 0 ? pathAndQuery.slice(1, queryIdx) : pathAndQuery.slice(1);
  const sslParam = queryIdx >= 0
    ? new URLSearchParams(pathAndQuery.slice(queryIdx + 1)).get("ssl")
    : null;

  return {
    host, port, database,
    user: safeDecode(rawUser),
    password: safeDecode(rawPassword),
    ssl: sslParam !== "false",
    sslExplicit: sslParam !== null,
  };
}

function ctxToConfig(ctx: DriverContext): ParsedMySQLConfig {
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

class MySQLDriver implements ConnectionDriver {
  readonly supportsTunnel = true;

  parseConnectionString(connectionString: string): { config: DriverConfig; creds: DriverCredentials } {
    const { password, ...rest } = parseMySQLConnectionString(connectionString);
    return { config: rest as unknown as DriverConfig, creds: { password } };
  }

  toConnectionString(config: DriverConfig, creds: DriverCredentials): string {
    const pass = creds.password ? `:${encodeURIComponent(creds.password)}` : "";
    const ssl = config.ssl === false ? "?ssl=false" : "";
    return `mysql://${encodeURIComponent(config.user as string)}${pass}@${config.host}:${config.port}/${config.database}${ssl}`;
  }

  async testConnection(ctx: DriverContext): Promise<ConnectionTestResult> {
    let connection: mysql.Connection | null = null;
    let tunnelInfo: import("../ssh-tunnel").TunnelInfo | null = null;

    try {
      let config = ctxToConfig(ctx);

      if (ctx.sshTunnel) {
        const tunneled = await withTunnel(config, ctx.sshTunnel);
        config = tunneled.config;
        tunnelInfo = tunneled.tunnel;
      }

      connection = await mysql.createConnection({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        connectTimeout: 10000,
      });

      const [versionRows] = await connection.query("SELECT VERSION() as version");
      const version = (versionRows as Array<{ version: string }>)[0]?.version || "MySQL";

      const [tableRows] = await connection.query(
        "SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
        [config.database],
      );
      const tableCount = parseInt(String((tableRows as Array<{ count: number }>)[0]?.count)) || 0;

      return {
        success: true,
        metadata: { host: config.host, database: config.database, version, tables: tableCount },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection failed";
      return {
        success: false,
        error: message.includes("ECONNREFUSED")
          ? "Connection refused - check host and port"
          : message.includes("Access denied")
            ? "Authentication failed - check username and password"
            : message.includes("Unknown database")
              ? "Database does not exist"
              : message,
      };
    } finally {
      if (connection) await connection.end();
      if (tunnelInfo) await tunnelInfo.close();
    }
  }

  async getSchema(ctx: DriverContext): Promise<SchemaInfo> {
    let connection: mysql.Connection | null = null;
    let tunnelInfo: import("../ssh-tunnel").TunnelInfo | null = null;

    try {
      let config = ctxToConfig(ctx);

      if (ctx.sshTunnel) {
        const tunneled = await withTunnel(config, ctx.sshTunnel);
        config = tunneled.config;
        tunnelInfo = tunneled.tunnel;
      }

      connection = await mysql.createConnection({
        host: config.host, port: config.port, database: config.database,
        user: config.user, password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        connectTimeout: 10000,
      });

      const [rows] = await connection.query(
        `SELECT
          TABLE_NAME AS table_name,
          COLUMN_NAME AS column_name,
          DATA_TYPE AS data_type,
          IS_NULLABLE AS is_nullable
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [config.database],
      );

      const tablesMap = new Map<string, SchemaInfo["tables"][0]>();
      for (const row of rows as Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>) {
        if (!tablesMap.has(row.table_name)) {
          tablesMap.set(row.table_name, { name: row.table_name, columns: [] });
        }
        tablesMap.get(row.table_name)!.columns.push({
          name: row.column_name, type: row.data_type, nullable: row.is_nullable === "YES",
        });
      }

      return { tables: Array.from(tablesMap.values()) };
    } finally {
      if (connection) await connection.end();
      if (tunnelInfo) await tunnelInfo.close();
    }
  }

  async executeQuery(ctx: DriverContext, opts: QueryOptions): Promise<QueryResult> {
    const startTime = Date.now();
    let mysqlConfig = ctxToConfig(ctx);
    const limit = Math.min(opts.limit || DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

    if (ctx.sshTunnel) {
      const { config: tunneledConfig, tunnel } = await withTunnel(mysqlConfig, ctx.sshTunnel);
      mysqlConfig = tunneledConfig;

      const connection = await mysql.createConnection({
        host: mysqlConfig.host, port: mysqlConfig.port, database: mysqlConfig.database,
        user: mysqlConfig.user, password: mysqlConfig.password,
        ssl: mysqlConfig.ssl ? { rejectUnauthorized: false } : undefined,
        connectTimeout: opts.timeout || DEFAULT_QUERY_TIMEOUT,
      });

      try {
        return await executeWithConnection(connection, opts, limit, startTime);
      } finally {
        await connection.end();
        await tunnel.close();
      }
    }

    const pool = getMySQLPool({
      host: mysqlConfig.host, port: mysqlConfig.port, database: mysqlConfig.database,
      user: mysqlConfig.user, password: mysqlConfig.password, ssl: mysqlConfig.ssl,
      connectTimeout: opts.timeout || DEFAULT_QUERY_TIMEOUT,
    });

    const connection = await pool.getConnection();
    try {
      return await executeWithConnection(connection, opts, limit, startTime);
    } finally {
      connection.release();
    }
  }
}

async function executeWithConnection(
  connection: { query(sql: string, values?: unknown[]): Promise<[unknown, unknown]> },
  opts: QueryOptions,
  limit: number,
  startTime: number,
): Promise<QueryResult> {
  let finalQuery = opts.query.trim();
  if (!/\bLIMIT\s+\d+/i.test(finalQuery)) {
    finalQuery = `SELECT * FROM (${finalQuery}) AS _q LIMIT ${limit + 1}`;
  }

  const filterParams = opts.params?.__filterParams;
  let mysqlParams: unknown[] | undefined;
  if (filterParams && filterParams.length > 0) {
    mysqlParams = filterParams;
    for (let i = filterParams.length; i >= 1; i--) {
      finalQuery = finalQuery.replace(new RegExp(`\\$${i}`, "g"), "?");
    }
  }

  const [rows, fields] = await connection.query(finalQuery, mysqlParams);
  const resultRows = rows as Array<Record<string, unknown>>;
  const truncated = resultRows.length > limit;
  const finalRows = truncated ? resultRows.slice(0, limit) : resultRows;
  const columns = (fields as mysql.FieldPacket[]).map((field) => ({ name: field.name, type: mapMySQLType(field.type) }));

  return { columns, rows: finalRows, rowCount: finalRows.length, executionTimeMs: Date.now() - startTime, truncated };
}

export const mysqlDriver = new MySQLDriver();
