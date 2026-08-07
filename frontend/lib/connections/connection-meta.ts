/**
 * Lightweight connection-type metadata shared by the Terminal agent + its Apply
 * card. Just the label, the connection-string placeholder, and the category —
 * the full setup guides live in `components/data/add-source-dialog.tsx`.
 *
 * The Terminal proposes the connection *shape* (type + slug + name); the actual
 * connection string (with credentials) is typed into the Apply card client-side
 * and never reaches the model.
 */

import type { ConnectionType } from "@/lib/db/types";

export interface ConnectionMeta {
  type: ConnectionType;
  label: string;
  placeholder: string;
  category: "timeseries" | "table";
}

export const CONNECTION_META: ConnectionMeta[] = [
  {
    type: "postgres",
    label: "PostgreSQL",
    placeholder: "postgresql://user:pass@host:5432/db",
    category: "table",
  },
  {
    type: "timescaledb",
    label: "TimescaleDB",
    placeholder: "postgresql://user:pass@host:5432/db",
    category: "timeseries",
  },
  {
    type: "mysql",
    label: "MySQL",
    placeholder: "mysql://user:pass@host:3306/db",
    category: "table",
  },
  {
    type: "clickhouse",
    label: "ClickHouse",
    placeholder: "clickhouse://user:pass@host:8443/db",
    category: "timeseries",
  },
  {
    type: "influxdb",
    label: "InfluxDB",
    placeholder: "http://localhost:8086?token=xxx&org=xxx&bucket=xxx",
    category: "timeseries",
  },
  {
    type: "prometheus",
    label: "Prometheus / Thanos",
    placeholder: "https://thanos.example.com?token=YOUR_TOKEN",
    category: "timeseries",
  },
];

export const CONNECTION_TYPE_VALUES = CONNECTION_META.map((c) => c.type);

export function connectionMeta(type: string): ConnectionMeta | undefined {
  return CONNECTION_META.find((c) => c.type === type);
}
