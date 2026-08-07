# Plexus Gateway + App — Design & Plan

The design for what we're shipping now. Pairs with three reference docs:

- **`ARCHITECTURE.md`** — how the gateway works *today* (protocols, auth, the
  three data paths, the back-pressure model). The source of truth for current
  behavior and for the invariants this plan must not break.
- **`STRATEGY.md`** — deferred scaling design (clustered/active-active
  mechanics and their known gaps, the cell architecture, the SDK-hints
  pattern, deferred levers). Recorded so it isn't rediscovered; none of it is
  being shipped now.
- **`README.md`** — how to deploy.

This plan covers only current work: the §4 broadcast-group correction and the
self-serve product. It supersedes and absorbs the former `scaling-guide.md`,
`multi-machine-plan.md`, and `FUTURE_TODO.md` (the deferred parts now live in
`STRATEGY.md`).

---

## 1. Goal & requirements

One codebase, two hosting models, no fork:

- **Cloud product** — multi-tenant SaaS, many orgs across many machines,
  horizontally scaled, Fly-routed.
- **Self-serve** — a single customer self-hosting on *any* cloud via Docker +
  docker-compose. **Single-org** (no multi-tenancy inside an install). A single
  machine is in excess of what one customer needs, so self-serve is
  vertically-scaled and never needs sharding.

Constraints, from requirements:

- **Strong performance & simplicity.** Neither model carries the other's
  complexity.
- **Datastores: bundle-by-default, swappable-by-URL.** Ship Redis + ClickHouse +
  Postgres in the compose file; expose each as a connection URL so a customer can
  point at managed instances. Managed Redis/ClickHouse are first-class BYO.
- **Do not break the back-pressure design** (§5). It was hard-won in production.
- **Stay on portable primitives.** Vanilla Redis Streams + consumer groups only —
  no RedisTimeSeries or other modules (they break managed-Redis BYO; see §7).

---

## 2. Core principle: topology is configuration, not a fork

The two hosting models are not two architectures. They are two points on one
scaling curve: `N = many orgs across many machines` (cloud) vs `N = 1 org on one
box` (self-serve). The per-org stream (`telemetry.stream:{org}`) collapses to one
stream; the multi-tenant data model degrades to single-tenant for free.

This works because **OrgReaders are connection-driven**: a reader spawns when the
first browser for an org connects and is torn down when the last leaves. A node
reads exactly the orgs it currently holds connections for — never more. So the
*engine* is already topology-agnostic; the only thing that differs between
topologies is **how connections are distributed to nodes — the front door, not
the engine.**

- **Single box** — all connections land here → this node reads all orgs.
- **Active-passive** — the switch sends all connections to the active node → it
  reads all orgs; the passive node has zero connections → zero readers → touches
  nothing.
- **Active-active (cloud scale)** — connections land on *any* node (no affinity);
  §4 per-instance groups let each node fan out independently, and a device-location
  map routes commands. No node owns an org, and no client is ever pinned.
  Deferred — design and known gaps live in `STRATEGY.md`.

The XADD write side is even more robust: multiple nodes writing one org's stream
is always fine (append-only), so even a messy failover loses nothing.

---

## 3. The `CLUSTER_MODE` seam

`CLUSTER_MODE = standalone | clustered`, **default `standalone`**.

Everything that coordinates a *cluster* is additive and gated on `clustered`. In
`standalone` these goroutines simply never start:

| Concern | standalone (self-serve: single box or active-passive) | clustered (cloud, active-active) |
|---|---|---|
| Machine registrar goroutine (liveness) | off | on |
| Device-location map writes | off (one node knows all its devices) | on |
| Cross-instance command forwarding | off (devices are always local) | on |
| Connection distribution | single URL / external switch | Fly LB, no affinity |

The cluster code is purely additive — a machine registrar, the device-location
map, and command forwarding — gated behind the mode flag and defaulted off. It is
*not* a rewrite of the read/fan-out path.

**Devices never *need* to change.** This is the load-bearing choice: cluster
awareness lives entirely in the gateways (which you deploy), and *nothing
required* of the device SDK (which you can't update — installs are in the
field). Devices connect to the public URL, Fly routes them to any node, and
they stream + receive commands exactly as today. No `/assign`, no routing
header, no pinning. Future SDK improvements follow the server-driven-hints
pattern (`STRATEGY.md` §5): the gateway may send optional hint messages that
old SDKs ignore; gateway correctness never depends on SDK version.

**Two discipline invariants** (the seam stays honest only if both hold):

1. **Sharding requirements never leak into the standalone path.** If a change
   can't be cleanly gated, the seam is in the wrong place.
2. **Broadcast fan-out never depends on routing** (see §4). Otherwise the engine
   silently re-couples to the front door.

### Clustered mechanics — deferred, see `STRATEGY.md`

The active-active layer (machine registrar, device-location map, cross-instance
command forwarding) is **not being shipped now**, and the drafted design is
**known-incomplete**: the in-process hub paths — video relay, device presence
(`init` / `source_status`), and the `command_result` return path — break
cross-node as drafted. **Do not run N≥2 active-active off this plan.** Full
mechanics, the gap list, and prerequisites live in `STRATEGY.md` §2–§3.

---

## 4. The broadcast-group correction (do-regardless) — ✅ SHIPPED

**This is the one correctness change that makes multi-node topologies safe, and it
also helps the current single instance.** Shipped as Phase 0
(`gateway_config.go`, `downsample.go`, `redis.go`); the description below records
what changed and why.

**Before:** the live reader used a **shared** group `dashboard`, a hardcoded
consumer name `dashboard-01`, and **acked** every entry. Correctness across nodes
depended
entirely on "only one OrgReader per org is ever active." That single assumption is
the *entire* reason the old org-sticky-routing scheme existed — and removing it is
what lets the cloud run active-active with no client pinning (§3).

**The bug this hides:** a consumer group is a **work-sharing** primitive — with two
consumers in one group, Redis *partitions* entries (each entry to one consumer).
But live fan-out is a **broadcast** — every node serving a browser for org X needs
*every* entry for X. A per-instance consumer *name* in a shared group makes this
worse (clean 50/50 split). The right fix is a per-instance **group**.

**What changed:**

- **Per-instance group** `dashboard:{instanceID}` (`downsample.go` `Start()`).
  Each node's group independently receives every entry — no partitioning, no
  dependence on single-reader-per-org.
- **`NOACK`** on the live read (`redis.go` `XReadGroup` `noAck` arg; `XAck` and
  the per-poll ack are gone). Live data is never replayed — a reconnecting
  browser gets current values on the next 25ms flush, not history. NOACK:
  - removes a Redis round-trip per poll,
  - eliminates the orphan-PEL leak the old code risked on unclean restart (it
    never `XAUTOCLAIM`ed),
  - is **upstream of the back-pressure pull-flow (§5) and does not touch it.**
- **Group lifecycle is destroy-in-start, nothing-on-stop** (`downsample.go`
  `Start()`: `XGROUP DESTROY` → `CREATE MKSTREAM($)` → `SETID $`). This was a
  deliberate choice over the original "SETID on start + DESTROY on clean stop"
  pairing: `OrgReader.Stop()` runs *outside* the hub lock, so on an org flap
  (last browser leaves, new one joins) a stopping reader's `DESTROY` could race
  and clobber the group a freshly-starting reader just created — a permanent
  `NOGROUP` error loop from a transient flap. Putting the whole lifecycle in
  `Start()` gives the group a single writer and removes the race. The three
  calls are layered insurance: DESTROY cleans the orphan in the happy path,
  CREATE covers DESTROY no-oping (circuit open / BUSYGROUP), SETID `$`
  unconditionally guarantees "start live" even if CREATE was a no-op.
  - **Accepted tradeoff:** a group is only cleaned when its org *reconnects*
    (destroy-on-start). Orgs that connect once and never return — and groups
    left under an unstable instance id — leak until the clustered-mode reaper
    (`STRATEGY.md` §3) mops them up. Acceptable: group state is tiny and the
    PEL is empty under NOACK.
- **`GATEWAY_INSTANCE_ID` — CRITICAL, must be set off-Fly** (`gateway_config.go`
  `resolveInstanceID`: env → `FLY_MACHINE_ID` → hostname). The group name
  derives from it, which makes the id load-bearing on two axes:
  - **Distinct per node = correctness.** Two nodes resolving to the *same* id
    share one group → work-sharing partition, i.e. the exact bug this section
    removes, silently back.
  - **Stable across restarts = hygiene.** An id that changes per restart
    (container hostname on recreate) orphans a group each time.
  On Fly both are free via `FLY_MACHINE_ID`. Off-Fly (docker-compose,
  self-host) the operator **must** set `GATEWAY_INSTANCE_ID` explicitly
  (single-box: any fixed string; active-passive: one fixed string per node).
  Prod (`auth=api`) logs a loud `WARN` when it falls back to hostname.

**Why it's back-pressure-safe:** NOACK doesn't change delivery. The reader still
gets every entry via `>`; unread entries wait in the stream bounded by
`MAXLEN ~100K`; a slow reader skips trimmed history (correct for *live*). Durable
consumers (`ch-loader`, `alert-service`) keep their **own acked work-sharing
groups** — correct for once-each processing, untouched. (`data_api` is not a
Redis consumer — it reads via the browser WS as `data_api_auth`.) Adding live
groups doesn't change `MAXLEN` trimming (by length, independent of group count),
so ch-loader's data-loss boundary is unchanged.

**Monitoring note:** if you alert on `XPENDING` for dashboard lag today, NOACK
removes that signal — switch to group last-delivered-id lag.

**Payoff:** active-passive now runs as `standalone` and is genuinely safe. If the
switch ever dual-actives during failover, both nodes read the full stream into
their own groups and fan out correctly to their own browsers — no split, no
`dashboard-01` collision. The dual-active window smears nothing.

---

## 5. Back-pressure invariants — DO NOT BREAK

Full detail lives in `ARCHITECTURE.md`. Summary of what the rewrite must preserve.
Three coalescing/drop layers:

1. **Reader buffer** (`downsample.go:29,242`): per-key cap
   `maxBufferedPerKey = 1024`, **drop-oldest eviction** (newest points win). A
   runaway metric can't grow unbounded between flushes.
2. **Flush coalescing** (25ms tick): poll and flush are decoupled through a
   mutex-guarded buffer, so a slow flush never blocks the Redis read.
3. **Per-browser pull-flow** (`hub.go:398-417`, `browser.go:30-44`) — the crown
   jewel. Telemetry uses a **size-1 `batchCh` + `pendingBatch` latest-wins +
   `ready`-gated delivery** (`browser.go:266`). The gateway calls `setBatch` (a
   non-blocking store) and only hands a browser its next batch when it signals
   `{type:"ready"}`. A slow browser **never blocks the OrgReader and never builds
   a backlog** — it gets the latest state when it catches up. Hidden tabs throttle
   (`throttleUntil`, 10s) but keep `pendingBatch` warm so there's no gap on
   un-throttle. Non-telemetry (commands/video/events/heartbeats) uses
   non-blocking `sendCh` with **drop-on-full + dropped-metric counters**.

**The §4 change is upstream of all three layers. It must stay that way.**

---

## 6. Scaling ladder (cloud) — moved to `STRATEGY.md`

Self-serve is permanent Stage 1. The cloud ladder (replica → Sentinel →
active-active → multi-region cells) is deferred work; the stages, the
active-active mechanism, and the cell architecture live in `STRATEGY.md`
§1–§4. What never changes across stages: one Go binary, same Dockerfile, same
device/browser WS protocols, Redis Streams as the only durable bus, consumer
groups for durable consumers.

---

## 7. Two hosting models

| | Cloud product | Self-serve |
|---|---|---|
| Gateway | horizontal, active-active + location-map | single instance, **vertical only** |
| `CLUSTER_MODE` | `clustered` | `standalone` |
| Tenancy | many orgs | single org |
| Redis | Sentinel HA → shard by org | single node (or customer-managed) |
| ClickHouse / PG | self-hosted or managed | bundled or customer-managed |
| App | stateless web tier, N replicas | 1 replica |
| Ceiling | per-org broadcast limit (Stage 5) | one machine's worth of devices |

**Self-serve = permanent Stage 1, `standalone`, single-org, docker-compose.**
Most customers run the single-box topology; active-passive is the *ceiling* of
self-serve complexity, only for customers whose SLA needs node redundancy (two
standalone nodes + a switch + shared Redis, optionally a Redis replica + Sentinel).

**Datastores: bundle-default-but-swappable.** Compose ships Redis + ClickHouse +
Postgres; each is a connection URL the customer can override. `down -v` data loss
is handled with named volumes/bind mounts + docs.

**Boot-time validation check** (fail loud, don't degrade silently): on startup
assert Redis eviction policy (`noeviction`/persistent — streams + group state must
not be evicted), Redis/PG versions, and any required extensions. This converts
BYO-datastore misconfiguration from mystery tickets into a clear deploy-time error.

**Portability is config, not code.** `.internal` Fly DNS → compose service names
(`PLEXUS_GATEWAY_URL`, `PLEXUS_CLICKHOUSE_URL`, `PLEXUS_API_URL` already exist).
`FLY_MACHINE_ID` already falls back to hostname.

---

## 8. App portability seam

"The app" (Next.js, `plexus/frontend`) is the UI, control plane, data API, and the
gateway's auth authority. It is **stateless**, so it needs **no mode flag** — cloud
runs N replicas, self-serve runs 1. Its only work is removing Supabase-specific
coupling. Four couplings, in increasing difficulty:

| Coupling | Where (frontend) | Self-serve target |
|---|---|---|
| **Data access** (PostgREST builder, service role, **RLS already bypassed**) | `lib/db/queries/shared.ts` `createClient`/`createOrgQueries` + all `.from().select().eq()` sites | plain `DATABASE_URL` pg client. **No RLS to port** — every query already takes `orgId` (Phase 3 of the existing on-prem migration). Pure PostgREST→SQL translation, broad but mechanical. |
| **Realtime** (`postgres_changes`) | `context/realtime-invalidation-provider.tsx` (8 tables → SWR cache invalidation), `components/alerts/alert-notifier.tsx` (alerts INSERT → toast), a dev-onboarding site | pg **`LISTEN/NOTIFY` + a small app SSE endpoint** behind a provider interface (Supabase impl for cloud, pg impl for self-serve). Browser hook unchanged; only transport swaps. **Keep this off the gateway** — don't route app-DB changes through it. |
| **Object storage** | 5 routes + `lib/storage/dashboard-icons.ts` (icons, source-context uploads, recordings video) | S3-compatible (MinIO) or local FS behind a storage abstraction. |
| **RPC** | `lib/db/server.ts` → `upsert_device_schemas` | plain pg function call; ship the function in migrations. |

**Auth is not coupled** — no Supabase Auth (authjs/Clerk; on `minimize_clerk`).
Telemetry realtime is already gateway-native (`hooks/use-plexus-realtime-shared.ts`
wraps `useGatewayConnection`), not Supabase.

**Prior art (no separate plan doc — it lives in code + SQL comments).** A
distributed, phased de-Clerk / de-Supabase effort has already pre-paid much of
this seam:

- org identity mirrored to a local `org_members` table explicitly "for local dev /
  on-prem without Clerk" (`lib/db/migrations/supabase/00052_org_members.sql`);
- service-role + **RLS bypassed**, org isolation moved to the app layer
  (`lib/db/queries/shared.ts` — "Phase 3 of the on-prem migration");
- auth moved off Clerk to **Auth.js** (`lib/auth/authjs.ts`, `00056_authjs.sql`,
  `00059_org_invites.sql`), with `scripts/migrate-*.ts` seeding users/orgs/billing
  from Clerk;
- a billing capability already exists for "bring-your-own ClickHouse / on-prem"
  (`lib/billing/capabilities.ts`).

Net: the data-access swap (row 1) is mostly pre-paid — isolation is already
app-layer and auth is already off Supabase. The genuinely net-new self-serve work
is **realtime, object storage, and the pg query-builder translation**.

---

## 9. Deferred levers — moved to `STRATEGY.md`

Per-viewer subscription filters, device WS `permessage-deflate`, the
MetricAnnouncer restructure, browser-side affinity, and high-rate live
decimation are recorded in `STRATEGY.md` §6 with their invariants and wire
sketches so they aren't rediscovered here.

---

## 10. Rollout (each step independently shippable, rollback-safe)

Ordered to priorities: self-serve #1, hardened/scalable cloud #2, HA urgent
throughout. The through-line: **the device SDK never needs to change** —
cluster awareness lives only in the gateways.

1. **§4 — ✅ DONE (Phase 0).** Per-instance group + NOACK + destroy-in-start
   lifecycle + `GATEWAY_INSTANCE_ID` (with prod hostname-fallback warning).
   Keystone for everything below; validated the hot path with zero user impact.
   Remaining follow-on: README deploy doc must document `GATEWAY_INSTANCE_ID` as
   required off-Fly (folds into the self-serve deploy docs, step 2).
2. **Self-serve (priority #1, the main thread).** `standalone` mode + datastore
   bundle/swappable + boot-time validation (§7) + the app de-Supabasing (§8) +
   docker-compose artifact. Ships the licensed product. Self-serve = single-box
   `standalone`; active-passive is available for self-hosters needing node HA (free
   from §4).
3. **Later: cloud HA + horizontal scale — deferred to `STRATEGY.md`.** The
   active-active design has known gaps (video relay, device presence,
   `command_result` return path, plus prerequisites like async XADD) that must
   close before any N≥2 deploy. Mechanics, gap list, and required staging
   tests: `STRATEGY.md` §2–§3.

Doc consolidation (former `scaling-guide.md` / `multi-machine-plan.md` /
`FUTURE_TODO.md`) is done — current work lives here, deferred work in
`STRATEGY.md`.

**Confirmed — no existing-user impact (verified 2026-06-12):** device API keys
survive the Clerk→Auth.js migration (no re-keying); the device SDK's local buffer
makes reconnect/failover gaps lossless; commands tolerate <500 ms latency. These
are the assumptions the SDK-free HA design rests on.
