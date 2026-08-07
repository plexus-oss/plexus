# AGENTS.md — clickhouse

**Telemetry storage + the Redis→CH loader.**
- `server/` — ClickHouse (Fly `plexus-ch`): raw `telemetry` + `telemetry_1min`/`telemetry_1hr`
  rollups (materialized views) + `events`; hot SSD → S3 cold tier. Schema = `server/schema.sql`.
- `loader/` — Python (Fly `plexus-ch-loader`): `XREADGROUP` drains `telemetry.stream:*`,
  zstd-decompresses, batch-inserts into `telemetry_dist`/`events_dist`. XACK only after insert.

The **rollup schema is a shared contract** — both the frontend (`nextjs_reader`) and the
read API (`telemetry_writer`) read these tables + rollup columns. Renaming a column/table
breaks ingest and both readers. DB-user auth split is enforced in `server/configs/.../users.xml`.

Workspace map: `../ARCHITECTURE.md`; canonical hosts/terms: `../GLOSSARY.md`.
