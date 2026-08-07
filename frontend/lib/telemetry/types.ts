/**
 * TelemetryProvider Abstraction
 *
 * Source-level routing so RCA, and fleet analysis
 * work with any data source (Plexus ClickHouse, external Postgres,
 * TimescaleDB, external ClickHouse).
 */

import "server-only";

import type { TelemetryQueryOptions, TelemetryRow } from "@/lib/db/clickhouse";
export type { TelemetryQueryOptions, TelemetryRow };

export interface TelemetryProvider {
  queryTelemetry(options: TelemetryQueryOptions): Promise<TelemetryRow[]>;

  getSourceMetrics(orgId: string, sourceId: string): Promise<string[]>;

  getMetricPercentiles(
    orgId: string,
    sourceId: string,
    metric: string,
    days?: number,
  ): Promise<{
    p1: number;
    p5: number;
    p50: number;
    p95: number;
    p99: number;
  } | null>;

  getLatestMetricsBySource(
    orgId: string,
    sourceIds: string[],
    days?: number,
  ): Promise<
    Record<string, Record<string, { value: number; timestamp: string }>>
  >;
}

export interface TelemetrySchemaMapping {
  table: string;
  timestampColumn: string;
  metricColumn: string | null;
  valueColumn: string | null;
  metricColumns?: string[];
  sourceIdColumn?: string | null;
  sourceIdValue?: string | null;
}
