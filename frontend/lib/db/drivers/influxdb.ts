import "server-only";
import { InfluxDB } from "@influxdata/influxdb-client";
import type {
  ConnectionDriver, DriverContext, DriverConfig, DriverCredentials,
  ConnectionTestResult, SchemaInfo, QueryResult, QueryOptions,
} from "./types";
import { inferInfluxType } from "./shared/type-mappers";
import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT, DEFAULT_QUERY_TIMEOUT } from "./shared/query-helpers";

interface ParsedInfluxConfig {
  url: string;
  org: string;
  bucket: string;
  version: "v2" | "v3";
}

function parseInfluxDBConnectionString(connectionString: string): { config: ParsedInfluxConfig; token: string } {
  const url = new URL(connectionString);
  const token = url.searchParams.get("token");
  const org = url.searchParams.get("org");
  const bucket = url.searchParams.get("bucket");
  const version = url.searchParams.get("v") === "3" ? "v3" : "v2";

  if (!token) throw new Error("InfluxDB connection string missing 'token' parameter");
  if (!org) throw new Error("InfluxDB connection string missing 'org' parameter");
  if (!bucket) throw new Error("InfluxDB connection string missing 'bucket' parameter");

  const baseUrl = `${url.protocol}//${url.host}`;
  return { config: { url: baseUrl, org, bucket, version }, token };
}

function ctxToConfig(ctx: DriverContext): { url: string; org: string; bucket: string; version: "v2" | "v3"; token: string } {
  return {
    url: ctx.config.url as string,
    org: ctx.config.org as string,
    bucket: ctx.config.bucket as string,
    version: (ctx.config.version as "v2" | "v3") ?? "v2",
    token: ctx.creds.token ?? "",
  };
}

function sqlToFlux(sql: string, bucket: string): string | null {
  const match = sql.match(/^\s*SELECT\s+.+?\s+FROM\s+(\w+)/i);
  if (!match) return null;
  const measurement = match[1];
  return `from(bucket: "${bucket}")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r["_measurement"] == "${measurement}")\n  |> sort(columns: ["_time"], desc: true)`;
}

class InfluxDBDriver implements ConnectionDriver {
  readonly supportsTunnel = false;

  parseConnectionString(connectionString: string): { config: DriverConfig; creds: DriverCredentials } {
    const { config, token } = parseInfluxDBConnectionString(connectionString);
    return { config: config as unknown as DriverConfig, creds: { token } };
  }

  toConnectionString(config: DriverConfig, creds: DriverCredentials): string {
    const params = new URLSearchParams({
      token: creds.token ?? "",
      org: config.org as string,
      bucket: config.bucket as string,
    });
    if (config.version === "v3") params.set("v", "3");
    return `${config.url}?${params}`;
  }

  async testConnection(ctx: DriverContext): Promise<ConnectionTestResult> {
    const config = ctxToConfig(ctx);
    try {
      const healthRes = await fetch(`${config.url}/health`, {
        headers: { Authorization: `Token ${config.token}` },
      });

      if (!healthRes.ok) {
        return {
          success: false,
          error: healthRes.status === 401 || healthRes.status === 403
            ? "Authentication failed - check your API token"
            : `Connection failed (${healthRes.status})`,
        };
      }

      let server_version = "InfluxDB";
      try {
        const body = await healthRes.json();
        if (body.version) server_version = body.version;
      } catch {
        // v3 returns plain text "OK"
      }

      return { success: true, metadata: { host: new URL(config.url).host, server_version } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection failed";
      return {
        success: false,
        error: message.includes("ECONNREFUSED") ? "Connection refused - check host and port" : message,
      };
    }
  }

  async getSchema(ctx: DriverContext): Promise<SchemaInfo> {
    const config = ctxToConfig(ctx);
    return config.version === "v3" ? this.getSchemaV3(config) : this.getSchemaV2(config);
  }

  private async getSchemaV2(config: ReturnType<typeof ctxToConfig>): Promise<SchemaInfo> {
    const influxDB = new InfluxDB({ url: config.url, token: config.token });
    const queryApi = influxDB.getQueryApi(config.org);
    const tables: SchemaInfo["tables"] = [];

    const measurements: string[] = [];
    const measurementsQuery = `import "influxdata/influxdb/schema"\nschema.measurements(bucket: "${config.bucket}")`;
    await new Promise<void>((resolve, reject) => {
      queryApi.queryRows(measurementsQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          if (o._value) measurements.push(o._value as string);
        },
        error: reject,
        complete: resolve,
      });
    });

    for (const measurement of measurements) {
      const columns: SchemaInfo["tables"][0]["columns"] = [
        { name: "_time", type: "dateTime:RFC3339", nullable: false },
      ];

      const fieldsQuery = `import "influxdata/influxdb/schema"\nschema.measurementFieldKeys(bucket: "${config.bucket}", measurement: "${measurement}")`;
      await new Promise<void>((resolve, reject) => {
        queryApi.queryRows(fieldsQuery, {
          next(row, tableMeta) {
            const o = tableMeta.toObject(row);
            if (o._value) columns.push({ name: o._value as string, type: "field", nullable: true });
          },
          error: reject,
          complete: resolve,
        });
      });

      const tagsQuery = `import "influxdata/influxdb/schema"\nschema.measurementTagKeys(bucket: "${config.bucket}", measurement: "${measurement}")`;
      await new Promise<void>((resolve, reject) => {
        queryApi.queryRows(tagsQuery, {
          next(row, tableMeta) {
            const o = tableMeta.toObject(row);
            if (o._value) columns.push({ name: o._value as string, type: "tag", nullable: true });
          },
          error: reject,
          complete: resolve,
        });
      });

      tables.push({ name: measurement, schema: config.bucket, columns });
    }

    return { tables };
  }

  private async getSchemaV3(config: ReturnType<typeof ctxToConfig>): Promise<SchemaInfo> {
    const queryV3 = async (sql: string): Promise<Record<string, unknown>[]> => {
      const res = await fetch(`${config.url}/api/v3/query_sql`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ q: sql, db: config.bucket }),
      });
      if (!res.ok) throw new Error(`InfluxDB v3 query failed (${res.status}): ${await res.text()}`);
      return res.json();
    };

    const tableRows = await queryV3(
      "SELECT table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'system') ORDER BY table_name",
    );
    const measurements = tableRows.map((r) => r.table_name as string).filter(Boolean);

    const tables: SchemaInfo["tables"] = [];
    for (const measurement of measurements) {
      const columns: SchemaInfo["tables"][0]["columns"] = [
        { name: "time", type: "dateTime:RFC3339", nullable: false },
      ];

      const colRows = await queryV3(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${measurement}'`,
      );

      for (const col of colRows) {
        const name = col.column_name as string;
        if (!name || name === "time") continue;
        columns.push({ name, type: (col.data_type as string) ?? "field", nullable: true });
      }

      tables.push({ name: measurement, schema: config.bucket, columns });
    }

    return { tables };
  }

  async executeQuery(ctx: DriverContext, opts: QueryOptions): Promise<QueryResult> {
    const config = ctxToConfig(ctx);
    return config.version === "v3"
      ? this.executeQueryV3(config, opts)
      : this.executeQueryV2(config, opts);
  }

  private async executeQueryV2(config: ReturnType<typeof ctxToConfig>, opts: QueryOptions): Promise<QueryResult> {
    const startTime = Date.now();
    const limit = Math.min(opts.limit || DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const influxDB = new InfluxDB({ url: config.url, token: config.token, timeout: opts.timeout || DEFAULT_QUERY_TIMEOUT });
    const queryApi = influxDB.getQueryApi(config.org);

    let finalQuery = opts.query.trim();
    if (/^\s*SELECT\s/i.test(finalQuery)) {
      const converted = sqlToFlux(finalQuery, config.bucket);
      if (converted) {
        finalQuery = converted;
      } else {
        throw new Error(
          'InfluxDB requires Flux queries, not SQL. Example: from(bucket: "' + config.bucket + '") |> range(start: -1h)',
        );
      }
    }

    if (!/\|\s*>\s*limit\s*\(/i.test(finalQuery)) {
      finalQuery = `${finalQuery}\n  |> limit(n: ${limit + 1})`;
    }

    const allRows: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      queryApi.queryRows(finalQuery, {
        next(row, tableMeta) { allRows.push(tableMeta.toObject(row)); },
        error: reject,
        complete: resolve,
      });
    });

    const truncated = allRows.length > limit;
    const rows = truncated ? allRows.slice(0, limit) : allRows;
    const columns: QueryResult["columns"] = [];
    if (rows.length > 0) {
      for (const [key, value] of Object.entries(rows[0])) {
        columns.push({ name: key, type: inferInfluxType(value) });
      }
    }

    return { columns, rows, rowCount: rows.length, executionTimeMs: Date.now() - startTime, truncated };
  }

  private async executeQueryV3(config: ReturnType<typeof ctxToConfig>, opts: QueryOptions): Promise<QueryResult> {
    const startTime = Date.now();
    const limit = Math.min(opts.limit || DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);

    let finalQuery = opts.query.trim();
    if (!/\bLIMIT\b/i.test(finalQuery)) {
      finalQuery = `${finalQuery} LIMIT ${limit + 1}`;
    }

    const res = await fetch(`${config.url}/api/v3/query_sql`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ q: finalQuery, db: config.bucket }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`InfluxDB v3 query failed (${res.status}): ${body}`);
    }

    const allRows = (await res.json()) as Array<Record<string, unknown>>;
    const truncated = allRows.length > limit;
    const rows = truncated ? allRows.slice(0, limit) : allRows;

    const columns: QueryResult["columns"] = [];
    if (rows.length > 0) {
      for (const [key, value] of Object.entries(rows[0])) {
        columns.push({ name: key, type: inferInfluxType(value) });
      }
    }

    return { columns, rows, rowCount: rows.length, executionTimeMs: Date.now() - startTime, truncated };
  }
}

export const influxdbDriver = new InfluxDBDriver();
