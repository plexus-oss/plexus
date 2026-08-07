import "server-only";
import type { DataSourceType } from "../types";
import type { SSHTunnelConfig } from "../ssh-tunnel";

export type DriverCredentials = Record<string, string | undefined>;
export type DriverConfig = Record<string, unknown>;

export interface DriverContext {
  type: DataSourceType;
  config: DriverConfig;
  creds: DriverCredentials;
  sshTunnel?: SSHTunnelConfig;
}

export interface QueryOptions {
  query: string;
  params?: Record<string, unknown> & { __filterParams?: unknown[] };
  limit?: number;
  timeout?: number;
}

export interface ConnectionTestResult {
  success: boolean;
  error?: string;
  metadata?: {
    host?: string;
    database?: string;
    version?: string;
    server_version?: string;
    tables?: number;
    metrics?: number;
    buckets?: string[];
  };
}

export interface QueryResult {
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  executionTimeMs: number;
  truncated: boolean;
}

export interface SchemaInfo {
  tables: Array<{
    name: string;
    schema?: string;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      isPrimaryKey?: boolean;
      foreignKey?: { table: string; column: string } | null;
    }>;
    rowCount?: number;
  }>;
}

export interface ConnectionDriver {
  testConnection(ctx: DriverContext): Promise<ConnectionTestResult>;
  getSchema(ctx: DriverContext): Promise<SchemaInfo>;
  executeQuery(ctx: DriverContext, opts: QueryOptions): Promise<QueryResult>;
  parseConnectionString(s: string): { config: DriverConfig; creds: DriverCredentials };
  toConnectionString?(config: DriverConfig, creds: DriverCredentials): string;
  readonly supportsTunnel: boolean;
}
