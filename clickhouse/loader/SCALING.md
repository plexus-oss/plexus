# Loader scaling & HA

Reference for the "two-replica + XAUTOCLAIM" pattern. **Not implemented today**
— single replica + Fly auto-restart covers current needs. This doc captures
the design so we don't re-derive it when the day comes.

## When to move past one replica

Only when one of these is true:

1. **Throughput ceiling hit** — sustained CH insert lag or growing Redis PEL.
2. **Zero-downtime failover required** — the ~30s ingest pause during Fly
   restarts is unacceptable (customer-facing query path or SLA).

Expected sustained throughput on one `shared-cpu-1x` with async pipelining is
~60-150k rows/sec. At realistic telemetry volumes this leaves ~10-30× headroom,
so (1) won't bite for a long time. Don't add the second replica preemptively.

## Design: two replicas, same consumer group

Both replicas join `ch-loader` on every `telemetry.stream:*` key with **distinct
consumer names**. Redis delivers each message to exactly one consumer — no
explicit sharding math in the loader. Load balances automatically.

- `loader-<machine-id-A>` gets its half of the messages
- `loader-<machine-id-B>` gets the other half
- Neither knows about the other

When a replica dies, its PEL (pending-entries list) is stranded until the
live peer **claims** the entries via `XAUTOCLAIM`. Without that, dead work
sits forever.

## The XAUTOCLAIM sweep (the missing piece)

A parallel async task that runs alongside the ingest loop:

```python
async def xautoclaim_sweep(r, ch):
    """Reap stranded PEL entries from dead peers every ~60s."""
    MIN_IDLE_MS = 5 * 60 * 1000   # 5 minutes
    BATCH       = 500

    while running:
        for stream in stream_names:
            next_id = "0-0"
            while True:
                next_id, claimed, _ = await r.xautoclaim(
                    stream, CONSUMER_GROUP, CONSUMER_NAME,
                    MIN_IDLE_MS, start_id=next_id, count=BATCH,
                )
                if not claimed:
                    break
                rows, acks = parse_claimed(claimed, stream)
                if rows:
                    try:
                        await ch.insert(CH_TABLE, rows, column_names=CH_COLUMNS)
                    except Exception:
                        break  # leave in our PEL for retry
                await ack_all(r, acks)
        await asyncio.sleep(60)
```

Added to the main `TaskGroup` alongside `ingest_loop` and the health server.
~30-40 lines. No-op unless a peer is actually dead.

**Idle threshold 5 minutes**: short enough that real deaths recover quickly,
long enough to survive GC pauses and network hiccups without false claims.
Tune after deployment if needed.

## Prerequisites before scaling to 2

1. **Async loader refactor complete** (Phase A + B). XAUTOCLAIM slots in as
   a second `TaskGroup` task — trivial on async, annoying on sync.
2. **XAUTOCLAIM sweep task merged and tested.**
3. **`CONSUMER_NAME` derived from `FLY_MACHINE_ID`** so each machine gets a
   distinct name automatically:
   ```python
   CONSUMER_NAME = os.environ.get(
       "CONSUMER_NAME",
       f"loader-{os.environ.get('FLY_MACHINE_ID', 'local')[:8]}",
   )
   ```
4. **Drop `LOADER_SHARD_ID` / `LOADER_SHARD_COUNT` entirely.** Hash-by-org
   sharding is less flexible than consumer-group distribution — it pins orgs
   to specific replicas so an imbalanced mix overloads one replica. Redis
   does the balancing for free; remove the hash code.
5. **Confirm `ReplicatedMergeTree` insert dedup is on** (`replicated_deduplication_window
   = 100`, default). Protects against double-insert during failover.
   **Critical safety net. Don't disable.**

## Deploy sequence

```bash
# 1. Deploy the updated async loader (with XAUTOCLAIM task + FLY_MACHINE_ID-based name)
./deploy.sh deploy

# 2. Scale to two machines
fly scale count 2 -a plexus-ch-loader

# 3. Verify two distinct consumers in the group
fly ssh console -a plexus-ch-loader -C \
  "redis-cli -u $REDIS_URL XINFO GROUPS telemetry.stream:test-org-1"
# Expect: "consumers 2"
```

## Failure tests (before trusting HA)

```bash
# Test 1: kill one, verify the other claims its PEL
fly machine stop <id-A> -a plexus-ch-loader
# Watch logs on machine B; within ~5-6 min it should claim and drain A's PEL.
fly machine start <id-A> -a plexus-ch-loader

# Test 2: dedup fires during recovery
# After test 1, check system.part_log for DuplicatedPart events — they prove
# the safety net worked.
SELECT countIf(event_type='DuplicatedPart')
FROM system.part_log WHERE table='telemetry' AND event_date=today();
```

## Cost

| Config | $/mo | Recovery time | Notes |
|---|---|---|---|
| 1 replica (today) | ~$5 | ~30 s (Fly auto-restart) | Current plan |
| 2 replicas + XAUTOCLAIM | ~$10 | ~0-6 min depending on idle threshold | Real HA |
| Multi-region 2 replicas | ~$10 + egress | same | Survives datacenter loss |

## What XAUTOCLAIM does NOT solve

- **Alive-but-frozen consumer** shorter than the idle threshold → won't claim.
- **Both replicas saturated** → vertical scale, not more replicas.
- **ClickHouse or Redis down** → no amount of loader replicas helps.

## Why NOT cold-standby ("start a backup when primary fails")

Tempting because it sounds cheaper (~$6-8/mo vs $10), but:

- **Recovery time is roughly equivalent** (15-40s cold-boot + join vs 0-6min XAUTOCLAIM).
  Cold-standby isn't meaningfully faster.
- **Watchdog complexity**: need a separate monitoring process with Fly API
  access to start the standby. Token rotation, failure testing, split-brain
  handling during cutover. Days of work to build and verify.
- **Drift risk**: stopped standby images diverge from primary over time.
  When it actually matters, the standby might run stale code.

Two always-on replicas is strictly better for ~$4-5/mo more. Skip cold-standby.

## TL;DR

Today: one replica. When HA becomes a real need, in order:

1. Finish async refactor
2. Add `xautoclaim_sweep` task
3. Switch `CONSUMER_NAME` default to `FLY_MACHINE_ID`
4. Remove `LOADER_SHARD_ID` / `LOADER_SHARD_COUNT`
5. `fly scale count 2`
6. Exercise failure tests before declaring HA works
