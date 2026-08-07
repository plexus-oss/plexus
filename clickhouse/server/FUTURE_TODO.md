# ClickHouse server — deferred tuning

## Merge scheduling

After `OPTIMIZE TABLE` restored query performance, the underlying cause was
part accumulation outpacing background merges on `shared-cpu-2x`. Two settings
to apply when this recurs or before scaling write volume:

```sql
ALTER TABLE plexus.telemetry ON CLUSTER observability_cluster
MODIFY SETTING
    min_age_to_force_merge_seconds = 7200,   -- force-merge parts older than 2h
    merge_with_ttl_timeout = 3600;           -- re-evaluate TTL moves every hour
```

`min_age_to_force_merge_seconds` makes CH merge parts that have been sitting
unmerged for 2+ hours even if they haven't hit the normal size threshold — the
main lever for keeping part count low on a low-to-moderate write workload.

`merge_with_ttl_timeout` controls how often the background TTL job runs to
move aged parts from hot (local SSD) to cold (Tigris S3). Default is 14400s
(4h); 3600s keeps the hot tier tighter.

If the degradation recurs frequently, the real fix is upgrading to
`performance-2x` in fly.toml — dedicated cores mean merges run continuously
rather than competing for shared CPU burst credits.
