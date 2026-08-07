import "server-only";
import type { DataSourceType } from "../types";
import type { ConnectionDriver } from "./types";
import { postgresDriver } from "./postgres";
import { clickhouseDriver } from "./clickhouse";
import { influxdbDriver } from "./influxdb";
import { mysqlDriver } from "./mysql";
import { prometheusDriver } from "./prometheus";

const registry = new Map<DataSourceType, ConnectionDriver>([
  ["postgres", postgresDriver],
  ["timescaledb", postgresDriver],
  ["clickhouse", clickhouseDriver],
  ["influxdb", influxdbDriver],
  ["mysql", mysqlDriver],
  ["prometheus", prometheusDriver],
]);

export function getDriver(type: DataSourceType): ConnectionDriver {
  const driver = registry.get(type);
  if (!driver) throw new Error(`No driver registered for connection type: ${type}`);
  return driver;
}
