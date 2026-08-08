# clickhouse + loader

![License: Elastic 2.0](https://img.shields.io/badge/license-Elastic%202.0-blue)

Telemetry sink for Plexus. Reads device data from Redis Streams, batches it,
and writes to ClickHouse with tiered storage on Tigris S3.

## Current deploy state

| Component             | Status         | Where                                                           |
| --------------------- | -------------- | --------------------------------------------------------------- |
| **ClickHouse server** | 🟢 Live on Fly | `plexus-ch` app in `plexus-725` / `iad`                         |
| **ClickHouse loader** | 🟢 Live on Fly | `plexus-ch-loader` app in `plexus-725` / `iad`, async-pipelined |

**Public endpoint:** `https://plexus-ch.fly.dev` (Fly edge, TLS terminated at the edge, plain HTTP 8123 to the machine)
**Web SQL console:** `https://plexus-ch.fly.dev/play`
**Internal (6PN):** `plexus-ch.internal:8123` (HTTP) / `:9000` (native), reachable from other Fly apps in `plexus-725`
**Machine:** `performance-2x` + 4 GB RAM (~$62/mo, 2 dedicated cores since 2026-05-28); 10 GB volume `plexus_ch_data` in zone `1c3a`. Moved off `shared-cpu-2x` after background merges (base table + 1min/1hr rollup MVs) saturated the shared-CPU burst credits and drove reader queries to 20-48s.
**Storage:** Embedded Keeper in-process. Tigris bucket `plexus-ch` with two prefixes — `clickhouse/cold_storage/` (TTL targets) and `clickhouse/backups/` (BACKUP TABLE targets). Credentials via Fly-provisioned `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.

### Users

| User               | Auth reaches via                    | Access                                           | Use case                                        |
| ------------------ | ----------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| `admin`            | public HTTPS (`0.0.0.0/0` + `::/0`) | full read+write+DDL, `access_management=1`       | schema dev, `/play`, ad-hoc queries, management |
| `nextjs_reader`    | public HTTPS                        | `readonly=2` (read-only data, settings-writable) | app read path                                   |
| `telemetry_writer` | 6PN only (`fdaa::/16`)              | full write                                       | loader ingest path                              |

**Passwords live only in 1Password.** `users.xml` carries no hashes anymore — it resolves them from the environment via `from_env=` (`CH_WRITER_PASSWORD_SHA256` / `CH_READER_PASSWORD_SHA256` / `CH_ADMIN_PASSWORD_SHA256`). There's no plaintext (and no hash) in the repo. To rotate: generate a new plaintext, hash it (`printf %s "$PASSWORD" | shasum -a 256 | cut -d' ' -f1`), update the `*_SHA256` secret on `plexus-ch` plus every consumer's plaintext secret, redeploy. Full checklist: [Credentials](#credentials).

The writer is locked to 6PN by a `sed` in `server/Dockerfile` — committed `users.xml` allows `0.0.0.0/0` for the writer so local compose works, then the Fly image rewrites it to `fdaa::/16` at build time.

### Schema

`server/schema.sql` is **reference-only** — not auto-applied on either local compose or Fly. Currently being developed live via `/play` against the deployed instance. When finalized, commit it and apply via `./server/deploy.sh schema` (tunnels through `fly proxy` + `clickhouse-client` as the 6PN-scoped writer).

### First-time / day-2 ops

Use the `./server/deploy.sh` script. Subcommands: `init` (first-time setup), `deploy` (build + deploy), `secrets` (re-apply from `.env.deploy`), `schema` (apply `schema.sql` via proxy), `status`, `logs`, `health`, `ssh`, `rollback`, `destroy`. Run `./server/deploy.sh` with no args for the full subcommand list.

## Components

```
 ┌────────────┐   XREADGROUP    ┌──────────┐    HTTP insert    ┌──────────┐
 │ gateway    │───────────────▶ │ ch-loader│──────────────────▶│ ch-01    │
 │ (Redis)    │                 │  (python)│                   │ (CH srv) │
 └────────────┘                 └──────────┘                   └────┬─────┘
                                      │                             │
                                      ▼                             ▼
                              ┌──────────────┐              ┌───────────────┐
                              │  Next.js     │              │  ch-keeper    │
                              │(rec. filter) │              │ (Raft / ZK)   │
                              └──────────────┘              └───────────────┘
                                                                    │
                                                                    ▼
                                                            ┌───────────────┐
                                                            │ Tigris S3     │
                                                            │ cold + backup │
                                                            └───────────────┘
```

- **ch-keeper** — ClickHouse Keeper (Raft). Single node today; coordinates
  replication + DDL for any future `Replicated*` tables.
- **ch-01** — ClickHouse server. Tiered storage: local SSD → Tigris S3 after
  TTL. Backups also go to a separate Tigris bucket.
- **ch-loader** — Python process that owns the Redis → CH hop. Discovers
  streams by `SCAN`ning Redis for `telemetry.stream:*`, joins the `ch-loader`
  consumer group on each, and batch-inserts to ClickHouse. Persistence is
  gated by a recording filter (only sources with `config.recording = true`),
  bootstrapped from the Next.js app at startup and kept fresh via push. No
  downsampling — the 1-min/1-hr rollup MVs aggregate at query time. ACKs
  messages only after a confirmed insert.

## Data flow

1. Device envelopes land in Redis Streams keyed by org
   (`telemetry.stream:<org_id>`).
2. Loader `SCAN`s for `telemetry.stream:*` and joins the `ch-loader` consumer
   group on every stream it discovers (rediscovery every
   `STREAM_DISCOVERY_INTERVAL`).
3. Each iteration: `XREADGROUP` a batch → parse v:2 envelopes → keep only
   sources with `config.recording = true` (the recording filter) → route
   metric points to `plexus.telemetry_dist` and event points to
   `plexus.events_dist` → `XACK`. No downsampling; the 1-min/1-hr rollup MVs
   aggregate at query time.
4. On insert failure the loader re-enters "pending mode" and re-reads the
   unacked batch from its own PEL next tick. On startup it drains its PEL
   before switching to live reads, so a crashed-and-restarted loader never
   loses work.

## Subprojects

Two independent deploys share this repo; they're coupled only by a contract
(the `plexus.telemetry` schema + the `telemetry_writer` password).

```
clickhouse/
├── server/                      → deploys to plexus-ch (🟢 live)
│   ├── deploy.sh                # init/deploy/secrets/schema/status/...
│   ├── fly.toml                 # Fly app config (performance-2x, 4 GB, 10 GB vol)
│   ├── Dockerfile               # bakes configs + rewrites hostnames/networks for Fly
│   ├── docker-compose.yml       # local: keeper + ch-01
│   ├── docker-compose.override.yml  # local: drops the 9000 host port (conflict)
│   ├── .env.example             # local compose env template
│   ├── .env.deploy.example      # Fly secrets template (CH_PASSWORD, replication secret)
│   ├── schema.sql               # reference DDL (not auto-applied anywhere)
│   └── configs/
│       ├── keeper/keeper_config.xml  # single-node Raft; standalone on compose, embedded on Fly
│       └── clickhouse/
│           ├── config.xml       # cluster + keeper + macros
│           ├── users.xml        # admin, nextjs_reader, telemetry_writer
│           └── disks.xml        # tiered / s3_only / backup policies
└── loader/                      → deploys to plexus-ch-loader (🟢 live)
    ├── docker-compose.yml       # loader (+ optional local redis)
    ├── .env.example
    ├── loader.py                # main loop
    ├── Dockerfile
    └── pyproject.toml
```

Full commentary on storage policies, TTL, partitioning, and the
`ReplicatedMergeTree` / `Distributed` patterns lives in `server/schema.sql`.

## Running locally

Each subproject stands up on its own (see each subproject's `deploy.sh` and
`AGENTS.md` for more); short version:

```
cd server
cp .env.example .env               # fill in CH_PASSWORD + AWS_*/Minio creds
docker compose up -d
```

For the loader:

```
cd loader
cp .env.example .env               # point CH_HOST wherever, set REDIS_URL; set PLEXUS_API_URL+PLEXUS_INTERNAL_SECRET or RECORDING_FILTER_DISABLED=1 (dev)
docker compose up -d               # add --profile local-redis for a self-contained Redis
```

ClickHouse HTTP on `127.0.0.1:8123`. Loader health check on `127.0.0.1:8080`.
Apply `schema.sql` manually once CH is up — it's reference-only, not auto-loaded.

## Deploying to Fly

Use `./server/deploy.sh`:

```
cd server
cp .env.deploy.example .env.deploy  # CH_PASSWORD + CH_REPLICATION_SECRET
./deploy.sh init                    # app + Tigris bucket + volume + secrets + first deploy
./deploy.sh health                  # sanity check
./deploy.sh schema                  # apply schema.sql via fly proxy tunnel
```

Subsequent deploys: `./deploy.sh deploy`. Run `./deploy.sh` with no args for
all subcommands and day-2 ops (logs, ssh, rollback, destroy, scaling).

## Environment knobs (loader)

| var                         | default                      | notes                                                                                     |
| --------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| `REDIS_URL`                 | `redis://localhost:6379`     | Gateway's Redis                                                                            |
| `CH_HOST`                   | `ch-01`                      | ClickHouse host                                                                           |
| `CH_PORT`                   | `8123`                       | ClickHouse HTTP port                                                                      |
| `CH_USER`                   | `telemetry_writer`           | Writer user                                                                               |
| `CH_TABLE`                  | `plexus.telemetry_dist`      | Metric target (Distributed wrapper)                                                       |
| `EVENT_TABLE`               | `plexus.events_dist`         | Event target                                                                              |
| `VIDEO_SESSION_TABLE`       | `plexus.video_sessions_dist` | Video-session target                                                                      |
| `PLEXUS_API_URL`            | _(required)_                 | Next.js base URL for the recording-filter bootstrap; loader exits at boot if unset (unless `RECORDING_FILTER_DISABLED=1`) |
| `PLEXUS_INTERNAL_SECRET`    | _(required)_                 | Shared secret for the recording bootstrap/push (`x-internal-secret`); loader exits at boot if unset (unless `RECORDING_FILTER_DISABLED=1`) |
| `RECORDING_FILTER_DISABLED` | _(unset)_                    | Dev-only: `1` boots without the two vars above — filter off (persist all), push unauthenticated |
| `BATCH_SIZE`                | `5000`                       | Total messages per `xreadgroup` (split per-stream)                                        |
| `BATCH_INTERVAL`            | `2.0`                        | Block seconds                                                                             |
| `STREAM_DISCOVERY_INTERVAL` | `60`                         | Seconds between `telemetry.stream:*` rediscovery `SCAN`s                                   |
| `CONN_RECYCLE_INTERVAL`     | `900`                        | Seconds between ClickHouse client reconnects                                              |
| `HEALTH_PORT`               | `8080`                       | Health/metrics + `POST /recording` HTTP server                                            |
| `CONSUMER_NAME`             | `loader-0`                   | Override only if running >1 replica (must be unique per replica)                          |

## Scaling up

Today is a single keeper + single ClickHouse + single loader. The code is
wired to scale horizontally; the sequence is:

1. **Expand the keeper quorum** from 1 to 3 via Raft `reconfig` (not by
   standing up a second cluster). Update every ClickHouse server's
   `config.xml` to list all three keepers **before** retiring the original.
2. **Add another ClickHouse shard** to `remote_servers` in `config.xml`, then
   create tables as `ReplicatedMergeTree` and query via a `Distributed`
   wrapper. `schema.sql` shows the pattern; do this from day one even on one
   node so you don't have to migrate later.
3. **Scale the loader** via the consumer group, not by sharding. Redis
   Streams already distributes messages across group members, so add replicas
   instead of pinning orgs to boxes. Give each machine a distinct consumer
   name — set `CONSUMER_NAME` to `FLY_MACHINE_ID` so they don't share a
   Pending Entries List — enable the `XAUTOCLAIM` sweep (see below) so a dead
   replica's unacked work is reclaimed, then `fly scale count 2`. The old
   `LOADER_SHARD_ID` / `LOADER_SHARD_COUNT` (and the never-implemented
   `CH_HOSTS`) hash-by-org approach has been removed — see `loader/SCALING.md`.

### ⚠️ Before running more than one loader replica: add `XAUTOCLAIM`

Each loader tracks its unacked messages in its own Pending Entries List (PEL)
inside Redis, keyed by `CONSUMER_NAME`. Today, if a replica crashes, **only
that replica can recover its own pending work** — when it restarts, it drains
its PEL before reading live messages. No other replica will touch it.

That's fine for a single replica. It's **not** fine the moment you run
multiple replicas and treat any of them as disposable, because a permanently
dead replica's in-flight batch is stranded forever.

The fix is `XAUTOCLAIM`: a periodic sweep where live replicas steal messages
that have been idle in a dead peer's PEL for longer than some threshold
(e.g. 5 minutes). It's a small addition — maybe 30 lines — but it needs to
land **before** you scale the loader past one replica, or before any planned
shard-count change.

Reshard rule of thumb: don't change loader replica count under load. Drain
(stop writers, let PEL clear, restart with new config) or implement
`XAUTOCLAIM` first.

## Known gaps

- **`XAUTOCLAIM` not implemented.** Fine for a single loader replica
  (pending-mode recovery handles crashes of the same consumer). Required
  before scaling past one replica — see `loader/SCALING.md`.
- **Schema evolution is manual.** `server/schema.sql` is reference-only
  and not auto-applied. Changes to a populated cluster require you to
  run the new DDL by hand (e.g., `ALTER TABLE ... ON CLUSTER ...`) and
  keep `schema.sql` in sync with reality.
- **The loader used to ship with a `downsample()` path** driven by a
  Redis device-config cache that was never actually written to by any
  producer. The refactor removed it — downsampling now happens entirely
  via the 1-minute / 1-hour MVs at query time. No action required; flag
  is here only so future readers know why `downsample_hz` shows up in
  some older docs.

## Credentials

> **⚠️ The previously committed password hashes are burned.** Until 2026-08, `configs/clickhouse/users.xml` shipped fixed `password_sha256_hex` values for `telemetry_writer`, `nextjs_reader`, and `admin`, and the writer's example plaintext sat in the `.env.example` files. All of that lives in git history — treat every pre-rotation password as compromised. **When the env-driven `users.xml` deploys, rotate all three passwords in the same window**, or the old (public) credentials keep working in prod.

`users.xml` now reads the hashes from the environment: `CH_WRITER_PASSWORD_SHA256`, `CH_READER_PASSWORD_SHA256`, `CH_ADMIN_PASSWORD_SHA256`. Generate a hash from a plaintext:

```bash
printf %s "$PASSWORD" | shasum -a 256 | cut -d' ' -f1     # macOS
printf %s "$PASSWORD" | sha256sum | cut -d' ' -f1         # Linux
```

Rotation checklist (single maintenance window — every consumer of a rotated password must be updated together):

```bash
# 1. ClickHouse server — new hashes (+ the writer plaintext config.xml references)
fly secrets set -a plexus-ch \
  CH_WRITER_PASSWORD_SHA256=<sha256-of-new-writer-password> \
  CH_READER_PASSWORD_SHA256=<sha256-of-new-reader-password> \
  CH_ADMIN_PASSWORD_SHA256=<sha256-of-new-admin-password> \
  CH_PASSWORD=<new-writer-password>

# 2. Loader — writer plaintext
fly secrets set -a plexus-ch-loader CH_PASSWORD=<new-writer-password>

# 3. Frontend — reader plaintext
fly secrets set -a plexus-frontend PLEXUS_CLICKHOUSE_PASSWORD=<new-reader-password>

# 4. Data API — its ClickHouse plaintext (match whichever user it connects as)
fly secrets set -a plexus-data-api CLICKHOUSE_PASSWORD=<new-writer-password>

# 5. Redeploy plexus-ch so users.xml picks up the new hashes
cd server && ./deploy.sh deploy
```

`fly secrets set` restarts the consumer apps automatically; `plexus-ch` needs the deploy in step 5 (or a machine restart) for the new env to take effect. Update 1Password with the new plaintexts as part of the same window.

## License

Source-available under the [Elastic License 2.0](./LICENSE) — all code, free
and enterprise features alike, is in the open; enterprise features unlock
with a license key.

| | Free | Enterprise |
|---|---|---|
| Ingest, storage, dashboards, instruments, alerts | ✓ | ✓ |
| Single-team auth | ✓ | ✓ |
| Grafana dashboard import | ✓ | ✓ |
| Self-hosting (no caps, no phone-home) | ✓ | ✓ |
| SSO / SAML / SCIM | | key |
| RBAC + fine-grained permissions | | key |
| Audit logs | | key |
| Multi-tenancy | | key |
| Air-gapped release channel + CVE SLA | | key |
| Support entitlements | | key |

See [../docs/licensing.md](../docs/licensing.md) for the plain-language guide.
