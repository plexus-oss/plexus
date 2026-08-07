import "server-only";
import { createClient as createClickHouseClient } from "@clickhouse/client";
import type {
  ConnectionDriver, DriverContext, DriverConfig, DriverCredentials,
  ConnectionTestResult, SchemaInfo, QueryResult, QueryOptions,
} from "./types";
import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, DEFAULT_QUERY_TIMEOUT } from "./shared/query-helpers";
import { getClickHouseClient as getCachedClickHouseClient } from "../connection-pool";

interface ParsedCHConfig {
  url: string;
  username: string;
  password: string;
  database: string;
}

function parseClickHouseConnectionString(connectionString: string): ParsedCHConfig {
  let url: URL;
  if (connectionString.startsWith("clickhouse://")) {
    url = new URL(connectionString.replace("clickhouse://", "https://"));
  } else {
    url = new URL(connectionString);
  }
  return {
    url: `${url.protocol}//${url.host}`,
    username: url.username || "default",
    password: url.password || "",
    database: url.pathname.slice(1) || "default",
  };
}

function ctxToConfig(ctx: DriverContext): ParsedCHConfig {
  return {
    url: ctx.config.url as string,
    username: ctx.config.username as string,
    password: ctx.creds.password ?? "",
    database: ctx.config.database as string,
  };
}

class ClickHouseDriver implements ConnectionDriver {
  readonly supportsTunnel = false;

  parseConnectionString(connectionString: string): { config: DriverConfig; creds: DriverCredentials } {
    const { password, ...rest } = parseClickHouseConnectionString(connectionString);
    return { config: rest as unknown as DriverConfig, creds: { password } };
  }

  toConnectionString(config: DriverConfig, creds: DriverCredentials): string {
    const urlObj = new URL(config.url as string);
    const username = encodeURIComponent(config.username as string);
    const password = encodeURIComponent(creds.password ?? "");
    const database = config.database as string;
    return `clickhouse://${username}:${password}@${urlObj.host}/${database}`;
  }

  async testConnection(ctx: DriverContext): Promise<ConnectionTestResult> {
    const config = ctxToConfig(ctx);
    try {
      const client = createClickHouseClient({
        url: config.url,
        username: config.username,
        password: config.password,
        database: config.database,
        request_timeout: 10000,
      });

      const result = await client.query({ query: "SELECT version() as version", format: "JSONEachRow" });
      const rows = (await result.json()) as { version: string }[];
      const version = rows?.[0]?.version || "ClickHouse";

      const tablesResult = await client.query({
        query: `SELECT count() as count FROM system.tables WHERE database = '${config.database}'`,
        format: "JSONEachRow",
      });
      const tablesRows = (await tablesResult.json()) as { count: string }[];
      const tableCount = parseInt(tablesRows[0]?.count) || 0;

      await client.close();

      return {
        success: true,
        metadata: { host: new URL(config.url).host, database: config.database, version, tables: tableCount },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection failed";
      return {
        success: false,
        error: message.includes("ECONNREFUSED")
          ? "Connection refused - check host and port"
          : message.includes("Authentication")
            ? "Authentication failed - check username and password"
            : message,
      };
    }
  }

  async getSchema(ctx: DriverContext): Promise<SchemaInfo> {
    const config = ctxToConfig(ctx);
    const client = createClickHouseClient({
      url: config.url,
      username: config.username,
      password: config.password,
      database: config.database,
    });

    try {
      const result = await client.query({
        query: `
          SELECT database, table, name as column_name, type as data_type
          FROM system.columns
          WHERE database = '${config.database}'
          ORDER BY database, table, position
        `,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as {
        database: string; table: string; column_name: string; data_type: string;
      }[];

      const tablesMap = new Map<string, SchemaInfo["tables"][0]>();
      for (const row of rows) {
        if (!tablesMap.has(row.table)) {
          tablesMap.set(row.table, { name: row.table, schema: row.database, columns: [] });
        }
        tablesMap.get(row.table)!.columns.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.data_type.startsWith("Nullable"),
        });
      }

      return { tables: Array.from(tablesMap.values()) };
    } finally {
      await client.close();
    }
  }

  async executeQuery(ctx: DriverContext, opts: QueryOptions): Promise<QueryResult> {
    const startTime = Date.now();
    const config = ctxToConfig(ctx);
    const limit = Math.min(opts.limit || DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

    const client = getCachedClickHouseClient({
      url: config.url,
      username: config.username,
      password: config.password,
      database: config.database,
      request_timeout: opts.timeout || DEFAULT_QUERY_TIMEOUT,
    });

    let finalQuery = opts.query.trim();
    if (!/\bLIMIT\s+\d+/i.test(finalQuery)) {
      finalQuery = `SELECT * FROM (${finalQuery}) AS _q LIMIT ${limit + 1}`;
    }

    const describeResult = await client.query({ query: `DESCRIBE (${opts.query})`, format: "JSONEachRow" });
    const describeRows = (await describeResult.json()) as Array<{ name: string; type: string }>;
    const columns = describeRows.map((row) => ({ name: row.name, type: row.type }));

    const filterParams = opts.params?.__filterParams;
    let chQueryParams: Record<string, unknown> | undefined;
    if (filterParams && filterParams.length > 0) {
      chQueryParams = {};
      for (let i = 0; i < filterParams.length; i++) {
        const paramName = `p${i + 1}`;
        chQueryParams[paramName] = String(filterParams[i]);
        finalQuery = finalQuery.replace(`$${i + 1}`, `{${paramName}:String}`);
      }
    }

    const result = await client.query({
      query: finalQuery,
      format: "JSONEachRow",
      ...(chQueryParams && { query_params: chQueryParams }),
    });

    const allRows = (await result.json()) as Array<Record<string, unknown>>;
    const truncated = allRows.length > limit;
    const rows = truncated ? allRows.slice(0, limit) : allRows;

    return { columns, rows, rowCount: rows.length, executionTimeMs: Date.now() - startTime, truncated };
  }
}

export const clickhouseDriver = new ClickHouseDriver();
