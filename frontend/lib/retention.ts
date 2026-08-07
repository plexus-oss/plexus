/**
 * Data retention windows shown to users. Source of truth is the ClickHouse
 * TTL clauses in clickhouse/server/schema.sql — keep these in sync:
 *   telemetry       TTL timestamp + 7 DAY TO VOLUME 'cold', + 1095 DAY DELETE
 *   telemetry_1min  TTL ts_min + 90 DAY DELETE
 *   telemetry_1hr   TTL ts_hour + 5 YEAR DELETE
 *   events          TTL timestamp + 90 DAY DELETE
 */
export const RETENTION = {
  /** Raw telemetry rows, deleted after this many days. */
  rawTelemetryDays: 1095,
  /** Days raw telemetry stays on hot SSD before moving to the S3 cold tier. */
  rawHotDays: 7,
  /** 1-minute rollups. */
  rollup1MinDays: 90,
  /** Hourly rollups (5 years). */
  rollup1HrDays: 1825,
  /** Events / logs. */
  eventsDays: 90,
} as const;
