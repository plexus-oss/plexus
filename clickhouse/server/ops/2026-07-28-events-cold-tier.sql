-- Events cold tier (register: ch-5-events-tiered-no-cold).
-- plexus.events declares storage_policy='tiered' but its TTL is DELETE-only, so
-- events sit on hot SSD for their whole 90-day life. This adds the same 7-day
-- hot -> S3 'cold' move telemetry already has (schema.sql telemetry TTL).
--
-- Run by hand on plexus-ch (schema.sql convention — reference-only, applied manually):
--   fly ssh console -a plexus-ch -C "clickhouse-client --queries-file /path/to/this.sql"
-- or paste the statement into clickhouse-client. materialize_ttl_after_modify=1 (default)
-- will rewrite existing parts in the background; monitor system.mutations.

ALTER TABLE plexus.events ON CLUSTER observability_cluster
    MODIFY TTL timestamp + INTERVAL 7 DAY TO VOLUME 'cold',
               timestamp + INTERVAL 90 DAY DELETE;

-- Verify afterwards:
--   SELECT name, disk_name, sum(rows) FROM system.parts
--   WHERE database='plexus' AND table='events' AND active GROUP BY name, disk_name;
