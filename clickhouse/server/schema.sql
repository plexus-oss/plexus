-- schema.sql — REFERENCE ONLY. Not auto-applied to any running cluster.
--
-- Apply manually once the server is up, e.g.:
--     clickhouse-client --host=127.0.0.1 --user=telemetry_writer --password \
--         --multiquery < schema.sql
-- Or pipe over HTTP:
--     curl -u telemetry_writer:$CH_PASSWORD \
--         --data-binary @schema.sql 127.0.0.1:8123
--
-- Schema changes on a populated cluster are your responsibility; this file
-- is the source of truth for "what the schema should look like," not a
-- migration tool. Keep it in sync with reality.
--
-- ─── Columns the loader inserts (loader.py, CH_COLUMNS) ─────────────────
-- The insert signature is fixed; match these column names and types:
--     org_id       String
--     source_id    String
--     timestamp    DateTime64(3, 'UTC')   -- ms precision, UTC
--     metric       String
--     value        Float64
--     tags         Map(String, String)    -- Python dict → CH Map
--     metadata     String                 -- orjson-serialized JSON blob
--     _ingested_at DateTime64(3, 'UTC')   -- loader-supplied (gateway receive
--                                         -- time); overrides the DDL DEFAULT
--                                         -- now64(3) below, which only fires for
--                                         -- non-loader inserts. The events insert
--                                         -- (EVENT_COLUMNS) carries _ingested_at
--                                         -- the same way.
--
-- Default target table: plexus.telemetry_dist  (override via CH_TABLE env var) —
-- the Distributed wrapper, which routes each row to the owning shard by
-- cityHash64(org_id).
--
-- ─── Storage policies (defined in configs/clickhouse/disks.xml) ─────────
-- Set per-table via `SETTINGS storage_policy = '<name>'`:
--     'default'  — local SSD only (implicit, built into ClickHouse)
--     'tiered'   — hot: local SSD  →  cold: Tigris S3, driven by TTL
--     's3_only'  — Tigris S3 only (for long-retention rollups where local
--                  cache isn't worth it)
-- Backups go to the 's3_backup' disk via BACKUP TABLE ... TO Disk('s3_backup', '...').
--
-- ─── TTL patterns for 'tiered' ──────────────────────────────────────────
-- TTL clauses are evaluated at merge time; partitioning should be small
-- enough that whole partitions age out together or the TO VOLUME move
-- won't fire efficiently.
--
--     TTL timestamp + INTERVAL 7  DAY TO VOLUME 'cold',
--         timestamp + INTERVAL 90 DAY DELETE
--
-- Use `ALTER TABLE ... MATERIALIZE TTL` to force-apply after editing TTL.
--
-- ─── Engine & replication ───────────────────────────────────────────────
-- configs/clickhouse/config.xml defines macros {shard}=01, {replica}=01
-- and a single-shard cluster named 'observability_cluster'.
--
-- ★ Use ReplicatedMergeTree from day one, even on a single node. ★
-- You cannot convert a plain MergeTree table to Replicated in place —
-- migrating means INSERT INTO new_table SELECT * FROM old_table, which
-- is a bad day for any table with meaningful volume. Keeper is already
-- running, so the cost of "Replicated with one replica" is effectively
-- zero today, and it unlocks adding a second replica later with no DDL.
--
--     ENGINE = ReplicatedMergeTree(
--         '/clickhouse/tables/{shard}/telemetry', '{replica}')
--
-- Plain MergeTree() is only acceptable for throwaway scratch tables.
--
-- ─── Distributed table: query through it from day one ──────────────────
-- Create BOTH a local Replicated table and a Distributed wrapper over it,
-- even while 'observability_cluster' has one shard. Point readers
-- (nextjs_reader) at the Distributed table; with one shard they are
-- functionally identical, but when you add a second shard the readers
-- need zero changes — the Distributed table fans the query out for you.
--
--     CREATE TABLE plexus.telemetry_dist ON CLUSTER observability_cluster
--     AS plexus.telemetry
--     ENGINE = Distributed(
--         observability_cluster,
--         plexus,
--         telemetry,
--         cityHash64(org_id)        -- sharding key: co-locate one org
--     );
--
-- Writers can target either: the loader writes to the Distributed table
-- today (CH_TABLE=plexus.telemetry_dist), which fans each insert out to the
-- correct shard by the sharding key; writing to the local table is the
-- simpler fast path for a writer that already knows which shard it owns.
--
-- ─── ON CLUSTER for all DDL ─────────────────────────────────────────────
-- Always write DDL as `CREATE/ALTER/DROP ... ON CLUSTER observability_cluster`
-- even on a one-node cluster. It costs nothing now and means schema
-- changes propagate to every node automatically once you scale out,
-- instead of you SSH'ing into each box to apply them by hand.
--
--     CREATE TABLE plexus.telemetry ON CLUSTER observability_cluster (...)
--     ALTER TABLE plexus.telemetry ON CLUSTER observability_cluster ADD COLUMN ...
--
-- ─── Partitioning ───────────────────────────────────────────────────────
--     PARTITION BY toYYYYMMDD(timestamp)      -- daily; good default
--     PARTITION BY toStartOfHour(timestamp)   -- hourly; very high volume
--     PARTITION BY (org_id, toYYYYMMDD(timestamp))  -- per-tenant isolation
--                                             -- (beware partition explosion)
--
-- ─── Partitioning with resharding in mind ──────────────────────────────
-- The simple `toYYYYMMDD(timestamp)` partition key works fine until you
-- need to reshard (split one CH shard into two). At that point your only
-- options are: (a) reingest everything from cold storage, or (b) use
-- `ALTER TABLE ... MOVE PARTITION` — which is cheap *if* partitions align
-- with the shard boundary, and useless otherwise.
--
-- If you expect to reshard, bucket orgs into a fixed number of hash
-- buckets and partition on the bucket:
--
--     PARTITION BY (cityHash64(org_id) % 16, toYYYYMMDD(timestamp))
--
-- Each org stays pinned to one of 16 buckets for its whole lifetime, so
-- when you reshard you can MOVE whole buckets between servers atomically.
-- Tradeoff: ~16× more parts/partitions, marginally slower merges, and
-- you're committing to the bucket count forever (changing it means the
-- same reingest you were trying to avoid). Only worth it if you have a
-- concrete plan to reshard; for most setups the simple daily partition
-- plus "reingest from Tigris if we ever reshard" is the right call.
--
-- ─── Order key (primary index + sparse skip) ────────────────────────────
-- Pick by the dominant query shape; LowCardinality columns first:
--     ORDER BY (org_id, source_id, metric, timestamp)  -- per-device drill-down
--     ORDER BY (org_id, metric, timestamp)             -- org-wide rollups
--
-- ─── Column codecs worth knowing ────────────────────────────────────────
--     value    Float64 CODEC(Gorilla, ZSTD(3))   -- time-series floats
--     metadata String  CODEC(ZSTD(3))            -- JSON blobs
--     timestamp DateTime64(3,'UTC') CODEC(DoubleDelta, ZSTD(1))
--     LowCardinality(String) for org_id / source_id / metric
--
-- ─── Async-insert profile (configs/clickhouse/users.xml) ────────────────
-- The 'default' profile sets async_insert=1, async_insert_busy_timeout_ms=500.
-- The loader's batched sync inserts are already large enough to bypass the
-- benefits of async batching — this profile mainly helps ad-hoc writers.
--
-- ─── Useful table-level settings ────────────────────────────────────────
-- SETTINGS
--     storage_policy = 'tiered',
--     index_granularity = 8192,             -- default
--     min_bytes_for_wide_part = 10485760,   -- 10 MiB
--     merge_with_ttl_timeout = 3600         -- seconds between TTL-move merges
--
-- ─── Example skeleton (remove once you have real DDL) ───────────────────
--
-- CREATE DATABASE IF NOT EXISTS plexus ON CLUSTER observability_cluster;
--
-- -- Local table: physically stores rows on each shard/replica.
-- CREATE TABLE IF NOT EXISTS plexus.telemetry ON CLUSTER observability_cluster
-- (
--     org_id     LowCardinality(String),
--     source_id  LowCardinality(String),
--     timestamp  DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
--     metric     LowCardinality(String),
--     value      Float64 CODEC(Gorilla, ZSTD(3)),
--     tags       Map(LowCardinality(String), String),
--     metadata   String CODEC(ZSTD(3))
-- )
-- ENGINE = ReplicatedMergeTree(
--     '/clickhouse/tables/{shard}/telemetry', '{replica}')
-- PARTITION BY toYYYYMMDD(timestamp)
-- ORDER BY (org_id, source_id, metric, timestamp)
-- TTL timestamp + INTERVAL 7  DAY TO VOLUME 'cold',
--     timestamp + INTERVAL 90 DAY DELETE
-- SETTINGS storage_policy = 'tiered';
--
-- -- Distributed wrapper: readers query this; writers may too.
-- -- With one shard it's a pass-through; adding shards requires no changes
-- -- to anything querying telemetry_dist.
-- CREATE TABLE IF NOT EXISTS plexus.telemetry_dist ON CLUSTER observability_cluster
-- AS plexus.telemetry
-- ENGINE = Distributed(
--     observability_cluster,
--     plexus,
--     telemetry,
--     cityHash64(org_id)
-- );


-- Create the application database before any table DDL. (The example
-- skeleton above is commented-out reference only.)
CREATE DATABASE IF NOT EXISTS plexus ON CLUSTER observability_cluster;

-- Three timestamps per row (never conflate them):
--
--   timestamp      — device event time (set by the device SDK at the
--                    moment the reading was taken). The authoritative
--                    "when did this actually happen" column.
--
--   _ingested_at   — gateway receive time (envelope.ingested_at, stamped
--                    in gateway/device.go handleTelemetry + handleDeviceError
--                    and gateway/ingest.go serveIngest). Useful
--                    for computing (_ingested_at - timestamp) to see
--                    per-device clock skew + buffering lag.
--
--   _loaded_at     — ClickHouse insert time (CH-side DEFAULT now64(3)).
--                    Useful for (_loaded_at - _ingested_at) to see
--                    Redis → loader → CH pipeline latency.
CREATE TABLE plexus.telemetry ON CLUSTER observability_cluster (
      org_id        LowCardinality(String),
      source_id     LowCardinality(String),
      timestamp     DateTime64(3, 'UTC'),
      metric        LowCardinality(String),
      value         Float64 CODEC(Gorilla, ZSTD(3)),
      tags          Map(LowCardinality(String), String),
      metadata      String CODEC(ZSTD(3)),
      _ingested_at  DateTime64(3, 'UTC') DEFAULT now64(3),
      _loaded_at    DateTime64(3, 'UTC') DEFAULT now64(3)
  )
  ENGINE = ReplicatedMergeTree(
      '/clickhouse/tables/{shard}/telemetry',
      '{replica}'
  )
  ORDER BY (org_id, source_id, metric, timestamp)
  PARTITION BY (cityHash64(org_id) % 16, toYYYYMM(timestamp))
  TTL timestamp + INTERVAL 7   DAY TO VOLUME 'cold',
      timestamp + INTERVAL 1095 DAY DELETE
  SETTINGS storage_policy = 'tiered';


CREATE TABLE IF NOT EXISTS plexus.telemetry_dist ON CLUSTER observability_cluster                                                                                               
  AS plexus.telemetry                                                                                                                                                             
  ENGINE = Distributed('observability_cluster', 'plexus', 'telemetry', cityHash64(org_id)); 


-- ════════════════════════════════════════════════════════════════════                                                                                                         
  -- 1-minute rollup — serves ~10min–3d (API) / 6h–24h (frontend), capped by 90-day TTL
  -- ════════════════════════════════════════════════════════════════════                                                                                                         
                  
  CREATE TABLE IF NOT EXISTS plexus.telemetry_1min ON CLUSTER observability_cluster                                                                                               
  (                                                                                                                                                                               
      org_id        LowCardinality(String),                                                                                                                                       
      source_id     LowCardinality(String),
      metric        LowCardinality(String),
      ts_min        DateTime,                                                                                                                                                     
      min_value     SimpleAggregateFunction(min, Float64),
      max_value     SimpleAggregateFunction(max, Float64),                                                                                                                        
      sum_value     SimpleAggregateFunction(sum, Float64),
      sum_sq_value  SimpleAggregateFunction(sum, Float64),                                                                                                                        
      count_value   SimpleAggregateFunction(sum, UInt64)
  )                                                                                                                                                                               
  ENGINE = ReplicatedAggregatingMergeTree(
      '/clickhouse/tables/{shard}/telemetry_1min',                                                                                                                                
      '{replica}'                                                                                                                                                                 
  )
  ORDER BY (org_id, source_id, metric, ts_min)                                                                                                                                    
  PARTITION BY toYYYYMM(ts_min)
  TTL ts_min + INTERVAL 90 DAY DELETE;
                                                                                                                                                                                  
  CREATE MATERIALIZED VIEW IF NOT EXISTS plexus.mv_telemetry_1min
  ON CLUSTER observability_cluster                                                                                                                                                
  TO plexus.telemetry_1min                                                                                                                                                        
  AS
  SELECT                                                                                                                                                                          
      org_id,     
      source_id,
      metric,
      toStartOfMinute(timestamp) AS ts_min,
      min(value)                 AS min_value,                                                                                                                                    
      max(value)                 AS max_value,
      sum(value)                 AS sum_value,                                                                                                                                    
      sum(value * value)         AS sum_sq_value,
      count()                    AS count_value                                                                                                                                   
  FROM plexus.telemetry
  GROUP BY org_id, source_id, metric, ts_min;                                                                                                                                     
                  
  CREATE TABLE IF NOT EXISTS plexus.telemetry_1min_dist ON CLUSTER observability_cluster                                                                                          
  AS plexus.telemetry_1min
  ENGINE = Distributed('observability_cluster', 'plexus', 'telemetry_1min', cityHash64(org_id));
                                                                                                                                                          
   
  -- ════════════════════════════════════════════════════════════════════                                                                                                         
  -- 1-hour rollup — serves >=3d (API) / >24h (frontend) up to 5-year TTL, long history
  -- ════════════════════════════════════════════════════════════════════                                                                                                         
   
  CREATE TABLE IF NOT EXISTS plexus.telemetry_1hr ON CLUSTER observability_cluster                                                                                                
  (               
      org_id        LowCardinality(String),                                                                                                                                       
      source_id     LowCardinality(String),
      metric        LowCardinality(String),                                                                                                                                       
      ts_hour       DateTime,
      min_value     SimpleAggregateFunction(min, Float64),                                                                                                                        
      max_value     SimpleAggregateFunction(max, Float64),
      sum_value     SimpleAggregateFunction(sum, Float64),                                                                                                                        
      sum_sq_value  SimpleAggregateFunction(sum, Float64),
      count_value   SimpleAggregateFunction(sum, UInt64)                                                                                                                          
  )               
  ENGINE = ReplicatedAggregatingMergeTree(                                                                                                                                        
      '/clickhouse/tables/{shard}/telemetry_1hr',                                                                                                                                 
      '{replica}'
  )                                                                                                                                                                               
  ORDER BY (org_id, source_id, metric, ts_hour)
  PARTITION BY toYYYYMM(ts_hour)
  TTL ts_hour + INTERVAL 5 YEAR DELETE;                                                                                                                                           
   
  CREATE MATERIALIZED VIEW IF NOT EXISTS plexus.mv_telemetry_1hr                                                                                                                  
  ON CLUSTER observability_cluster
  TO plexus.telemetry_1hr                                                                                                                                                         
  AS              
  SELECT
      org_id,                                                                                                                                                                     
      source_id,
      metric,                                                                                                                                                                     
      toStartOfHour(timestamp) AS ts_hour,
      min(value)               AS min_value,
      max(value)               AS max_value,
      sum(value)               AS sum_value,                                                                                                                                      
      sum(value * value)       AS sum_sq_value,
      count()                  AS count_value                                                                                                                                     
  FROM plexus.telemetry
  GROUP BY org_id, source_id, metric, ts_hour;
                                                                                                                                                                                  
  CREATE TABLE IF NOT EXISTS plexus.telemetry_1hr_dist ON CLUSTER observability_cluster
  AS plexus.telemetry_1hr
  ENGINE = Distributed('observability_cluster', 'plexus', 'telemetry_1hr', cityHash64(org_id));


-- ════════════════════════════════════════════════════════════════════
-- Events — class="event" points: faults, state changes, log lines,
-- CAN frames, or any text/JSON data from a device.
--
-- `name` is the event type (low-cardinality, always a filter).
-- `body` is the payload: a raw string or a JSON-encoded object/array.
-- No rollup MVs — events are not aggregatable like metrics.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plexus.events ON CLUSTER observability_cluster
(
    org_id       LowCardinality(String),
    source_id    LowCardinality(String),
    timestamp    DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    name         LowCardinality(String),
    body         String CODEC(ZSTD(3)),
    tags         Map(LowCardinality(String), String),
    _ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
    _loaded_at   DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/events',
    '{replica}'
)
ORDER BY (org_id, source_id, name, timestamp)
PARTITION BY (cityHash64(org_id) % 16, toYYYYMM(timestamp))
TTL timestamp + INTERVAL 7 DAY TO VOLUME 'cold',
    timestamp + INTERVAL 90 DAY DELETE
SETTINGS storage_policy = 'tiered';

CREATE TABLE IF NOT EXISTS plexus.events_dist ON CLUSTER observability_cluster
AS plexus.events
ENGINE = Distributed('observability_cluster', 'plexus', 'events', cityHash64(org_id));


-- ════════════════════════════════════════════════════════════════════
-- Video sessions — one row per browser WebSocket session.
-- Billing unit: camera-hours = sum(duration_s * camera_count) / 3600
-- No TTL: billing records are kept indefinitely.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plexus.video_sessions ON CLUSTER observability_cluster
(
    org_id        LowCardinality(String),
    source_id     LowCardinality(String),
    camera_count  UInt8,
    started_at    DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    duration_s    Float32,
    _loaded_at    DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplicatedMergeTree(
    '/clickhouse/tables/{shard}/video_sessions',
    '{replica}'
)
ORDER BY (org_id, started_at)
PARTITION BY toYYYYMM(started_at);

CREATE TABLE IF NOT EXISTS plexus.video_sessions_dist ON CLUSTER observability_cluster
AS plexus.video_sessions
ENGINE = Distributed('observability_cluster', 'plexus', 'video_sessions', cityHash64(org_id));

-- ════════════════════════════════════════════════════════════════════
-- Least-privilege user for the customer-facing telemetry query console
-- (frontend /api/telemetry/connection/query). DURABLE BACKSTOP for the
-- app-layer guard in lib/db/drivers/shared/query-helpers.ts
-- (validateInternalTelemetryQuery): even if that guard is ever bypassed,
-- this user physically cannot read around the org-scoped CTE because it is
-- granted SELECT on the telemetry tables ONLY and has every table function
-- (merge/remote/url/s3/file/cluster/…) revoked.
--
-- Apply once, then point the route's client at these creds via
-- PLEXUS_CLICKHOUSE_QUERY_USER / PLEXUS_CLICKHOUSE_QUERY_PASSWORD
-- (provision the password with: fly secrets set ... -a plexus-ch).
--
--   CREATE USER IF NOT EXISTS nextjs_query
--       IDENTIFIED WITH sha256_password BY '<generated>'
--       SETTINGS readonly = 1, allow_ddl = 0,
--                allow_introspection_functions = 0,
--                max_execution_time = 30, max_result_rows = 100000;
--
--   -- SELECT only on the two tables the console needs; nothing else in
--   -- plexus.*, no system.*, no information_schema.*.
--   GRANT SELECT ON plexus.telemetry      TO nextjs_query;
--   GRANT SELECT ON plexus.telemetry_dist TO nextjs_query;
--
--   -- Revoke ALL table/dictionary functions (these are the SSRF /
--   -- cross-tenant vectors). ClickHouse grants them via named privileges:
--   REVOKE remote, remoteSecure, cluster, clusterAllReplicas,
--          url, s3, s3Cluster, gcs, file, hdfs,
--          mysql, postgresql, mongodb, jdbc, odbc, sqlite, redis,
--          azureBlobStorage, deltaLake, hudi, iceberg,
--          dictGet, addressToLine, addressToSymbol, demangle
--       ON *.* FROM nextjs_query;
--
-- NOTE: `merge()` reads only tables the user can already SELECT, so with the
-- grant above scoped to plexus.telemetry it cannot widen access; the app-layer
-- guard blocks it outright regardless.

-- ════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY BACKSTOP (Option B)  — DB-enforced tenant isolation
-- ════════════════════════════════════════════════════════════════════
-- Makes the DATABASE refuse cross-tenant rows even if an app query forgets
-- its `WHERE org_id`. The frontend stamps every ORG-SCOPED read with a custom
-- per-query setting `plexus_org_id` (lib/db/clickhouse.ts getClient(orgId)),
-- and these policies filter the tenant tables on that value. Fail-closed: a
-- read that doesn't set it (or sets the wrong org) sees ZERO rows.
--
-- Because policies attach to a USER, this design uses TWO read users:
--   • nextjs_reader   — the app's org-scoped reads. Policies below TARGET it.
--   • nextjs_global   — cross-org internal reads (rollup reconciliation, ops).
--                       NOT targeted, so it bypasses the per-org filter.
-- Deletes run as telemetry_writer (mutations, unaffected). MV population runs
-- under the loader's INSERT context (unaffected). DDL/DESCRIBE unaffected.
--
-- ── ROLLOUT ORDER (each step is safe on its own; enforcement starts at step 4)
--   1. Deploy the server config: <custom_settings_prefixes>plexus_</...>
--      (already in configs/clickhouse/config.xml) so `plexus_org_id` is a
--      legal setting. Without this, setting it would error.
--   2. Provision nextjs_global + set PLEXUS_CLICKHOUSE_GLOBAL_USER /
--      _GLOBAL_PASSWORD on the frontend (fly secrets). Until set, cross-org
--      reads fall back to nextjs_reader — fine while the policy is not yet on.
--   3. Deploy the frontend with the wiring merged (no-op while the flag is off).
--   4. Apply the policies below, THEN flip PLEXUS_CH_ROW_POLICY=1 on the
--      frontend. VERIFY IN STAGING FIRST: with the flag on and policies applied,
--      confirm dashboards/queries still return data (a missed org-scoped read
--      would now come back empty). Roll back by unsetting the flag.
--
--   CREATE USER IF NOT EXISTS nextjs_global
--       IDENTIFIED WITH sha256_password BY '<generated>'
--       SETTINGS readonly = 1;
--   GRANT SELECT ON plexus.* TO nextjs_global;   -- cross-org internal reads
--
--   -- One policy per tenant table nextjs_reader SELECTs from. The policy is
--   -- PERMISSIVE for the matching org; TO nextjs_reader scopes it to that user.
--   -- Apply to BOTH the local and _dist variants of each table.
--   CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.telemetry
--       ON CLUSTER observability_cluster
--       USING org_id = getSetting('plexus_org_id') TO nextjs_reader;
--   CREATE ROW POLICY IF NOT EXISTS org_isolation ON plexus.telemetry_dist
--       ON CLUSTER observability_cluster
--       USING org_id = getSetting('plexus_org_id') TO nextjs_reader;
--   -- Repeat verbatim for every other tenant table the reader touches:
--   --   plexus.events, plexus.events_dist,
--   --   plexus.telemetry_1min, plexus.telemetry_1min_dist,
--   --   plexus.telemetry_1hr,  plexus.telemetry_1hr_dist,
--   --   plexus.video_sessions, plexus.video_sessions_dist
--   -- (any table with an org_id column that nextjs_reader can read).
--
-- WARNING — once ANY policy exists on a table, users NOT covered by a policy
-- on it are filtered to nothing. nextjs_global is intentionally not targeted,
-- so give it a permissive policy if you ever add one that would catch it:
--   CREATE ROW POLICY IF NOT EXISTS allow_all ON plexus.telemetry
--       AS PERMISSIVE USING 1 TO nextjs_global;   -- (only if needed)
--
-- The console user (nextjs_query, above) is a separate, stricter path; if the
-- console also rides nextjs_reader, its raw SQL cannot override plexus_org_id
-- because validateInternalTelemetryQuery rejects any SETTINGS clause.

