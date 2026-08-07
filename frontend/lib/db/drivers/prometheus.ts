import "server-only";
import type {
  ConnectionDriver,
  DriverContext,
  DriverConfig,
  DriverCredentials,
  ConnectionTestResult,
  SchemaInfo,
  QueryResult,
  QueryOptions,
} from "./types";
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  DEFAULT_QUERY_TIMEOUT,
} from "./shared/query-helpers";

// Prometheus & Thanos share the same HTTP query API (/api/v1/*), so this one
// driver covers both — Thanos Query is a drop-in for the read path.

const MAX_METRICS_LISTED = 500;

type PromSample = [number, string]; // [unix_seconds, value]

interface PromSeries {
  metric?: Record<string, string>;
  value?: PromSample;
  values?: PromSample[];
}

interface PromResponse {
  status?: "success" | "error";
  error?: string;
  data?:
    | { resultType?: string; result?: PromSeries[] | PromSample }
    | string[]
    | { version?: string };
}

interface PromConn {
  url: string;
  headers: Record<string, string>;
}

function ctxToConn(ctx: DriverContext): PromConn {
  const url = ((ctx.config.url as string) || "").replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  const { token, username, password } = ctx.creds;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (username || password) {
    const basic = Buffer.from(`${username ?? ""}:${password ?? ""}`).toString(
      "base64",
    );
    headers.Authorization = `Basic ${basic}`;
  }
  return { url, headers };
}

async function promFetch(
  conn: PromConn,
  path: string,
  params?: Record<string, string>,
  timeoutMs: number = DEFAULT_QUERY_TIMEOUT,
): Promise<PromResponse> {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${conn.url}${path}${qs}`, {
      headers: conn.headers,
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as PromResponse | null;
    if (!res.ok) {
      const message = body?.error ?? `HTTP ${res.status}`;
      throw Object.assign(new Error(message), { status: res.status });
    }
    return body ?? {};
  } finally {
    clearTimeout(timer);
  }
}

class PrometheusDriver implements ConnectionDriver {
  readonly supportsTunnel = false;

  parseConnectionString(s: string): {
    config: DriverConfig;
    creds: DriverCredentials;
  } {
    const u = new URL(s);
    const token = u.searchParams.get("token") ?? undefined;
    const base = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
    return {
      config: { url: base },
      creds: {
        token,
        username: u.username || undefined,
        password: u.password || undefined,
      },
    };
  }

  async testConnection(ctx: DriverContext): Promise<ConnectionTestResult> {
    const conn = ctxToConn(ctx);
    if (!conn.url) {
      return { success: false, error: "Missing Prometheus/Thanos URL" };
    }
    try {
      // Instant query "1" works identically on Prometheus and Thanos Query.
      const body = await promFetch(conn, "/api/v1/query", { query: "1" });
      if (body.status !== "success") {
        return { success: false, error: body.error ?? "Query endpoint error" };
      }

      // Best-effort enrichment — neither call is required to succeed.
      let server_version: string | undefined;
      try {
        const info = await promFetch(conn, "/api/v1/status/buildinfo");
        const v = (info.data as { version?: string } | undefined)?.version;
        if (v) server_version = `Prometheus ${v}`;
      } catch {
        /* Thanos may not expose buildinfo */
      }
      let metrics: number | undefined;
      try {
        const names = await promFetch(conn, "/api/v1/label/__name__/values");
        if (Array.isArray(names.data)) metrics = names.data.length;
      } catch {
        /* ignore */
      }

      return {
        success: true,
        metadata: { host: new URL(conn.url).host, server_version, metrics },
      };
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 401 || status === 403) {
        return {
          success: false,
          error: "Authentication failed — check your token or credentials",
        };
      }
      const message = error instanceof Error ? error.message : "Connection failed";
      const networkish =
        message.includes("ECONNREFUSED") ||
        message.includes("aborted") ||
        message.includes("abort");
      return {
        success: false,
        error: networkish
          ? "Connection refused or timed out — check the URL and network/VPN"
          : message,
      };
    }
  }

  async getSchema(ctx: DriverContext): Promise<SchemaInfo> {
    const conn = ctxToConn(ctx);
    try {
      const names = await promFetch(conn, "/api/v1/label/__name__/values");
      const metricNames = Array.isArray(names.data)
        ? (names.data as string[])
        : [];
      const tables = metricNames.slice(0, MAX_METRICS_LISTED).map((name) => ({
        name,
        columns: [
          { name: "timestamp", type: "timestamp", nullable: false },
          { name: "value", type: "number", nullable: false },
          { name: "labels", type: "map", nullable: true },
        ],
      }));
      return { tables };
    } catch {
      return { tables: [] };
    }
  }

  async executeQuery(
    ctx: DriverContext,
    opts: QueryOptions,
  ): Promise<QueryResult> {
    const conn = ctxToConn(ctx);
    const start = Date.now();
    const body = await promFetch(
      conn,
      "/api/v1/query",
      { query: opts.query },
      opts.timeout ?? DEFAULT_QUERY_TIMEOUT,
    );
    if (body.status !== "success") {
      throw new Error(body.error ?? "PromQL query failed");
    }

    const data = body.data as { resultType?: string; result?: PromSeries[] | PromSample };
    const rows: Array<Record<string, unknown>> = [];
    const labelKeys = new Set<string>();

    const pushSample = (
      metric: Record<string, string>,
      sample: PromSample,
    ) => {
      Object.keys(metric).forEach((k) => labelKeys.add(k));
      rows.push({
        ...metric,
        timestamp: new Date(sample[0] * 1000).toISOString(),
        value: Number(sample[1]),
      });
    };

    if (data?.resultType === "vector" && Array.isArray(data.result)) {
      for (const s of data.result as PromSeries[]) {
        if (s.value) pushSample(s.metric ?? {}, s.value);
      }
    } else if (data?.resultType === "matrix" && Array.isArray(data.result)) {
      for (const s of data.result as PromSeries[]) {
        for (const v of s.values ?? []) pushSample(s.metric ?? {}, v);
      }
    } else if (data?.resultType === "scalar") {
      pushSample({}, data.result as PromSample);
    }

    const limit = Math.min(opts.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const truncated = rows.length > limit;
    const limited = truncated ? rows.slice(0, limit) : rows;

    return {
      columns: [
        ...[...labelKeys].map((name) => ({ name, type: "string" })),
        { name: "timestamp", type: "timestamp" },
        { name: "value", type: "number" },
      ],
      rows: limited,
      rowCount: limited.length,
      executionTimeMs: Date.now() - start,
      truncated,
    };
  }
}

export const prometheusDriver = new PrometheusDriver();
