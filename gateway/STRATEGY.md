# Plexus Gateway — Scaling Strategy

Deferred design. **Nothing in this doc is being shipped now** — `PLAN.md` covers
current work (the broadcast-group correction + self-serve). This doc records the
forward designs, known gaps, and decisions so they aren't rediscovered or
re-litigated later.

**Direction (decided 2026-06-12):**

1. Ship the single-server wins first (`PLAN.md` §4 + self-serve `standalone`) —
   they are correct in every topology below.
2. SDK evolution only as optional **server-driven hints** (§5) — gateway
   correctness never depends on SDK version.
3. Accept that scaling is coming; record the design here, defer the build until
   it demonstrably hurts.

---

## 1. Scaling ladder (cloud)

Stages are incremental — move to the next only when the current one demonstrably
hurts. (Cost tables live in `README.md` if useful operationally.)

| Stage | Topology | MTTR | When |
|---|---|---|---|
| 1 | gateway + redis (one Fly Machine each) | ~1 min | first customers, no SLA |
| 2 | + redis replica, manual failover | ~5 min | a few customers, want a backup |
| 3 | + Sentinel HA | ~30 s | real uptime SLA |
| 4 | + multiple gateways, active-active (location-map) | ~30 s | HA + scale, single region |
| 5 | + multi-region cells, org homing (§4 below) | varies | global, large scale |

What never changes across stages: one Go binary, same Dockerfile, same device/
browser WS protocols, Redis Streams as the only durable bus, consumer groups for
durable consumers. Self-serve is permanent Stage 1.

---

## 2. Clustered (active-active) mechanics — design as drafted

Gated behind `CLUSTER_MODE=clustered`; all of it additive, off in `standalone`.
The defining property: **connections land anywhere, the gateways cooperate, and
devices never need to change.** Fly's load balancer spreads device and browser
connections across nodes with no affinity.

- **Telemetry-up needs no routing** — `XADD` writes to the shared
  `telemetry.stream:{org}` from any node.
- **Fan-out needs no routing** — per-instance broadcast groups (`PLAN.md` §4)
  let every node read the full stream for any org it has a viewer for.
- **Commands-down need device *location*, not org affinity** — solved by a map,
  not by pinning.

Redis keys:

| Key | Type | TTL | Written by | Read by |
|---|---|---|---|---|
| `gateway:machine:{machineID}` | string `"1"` | 30s (refresh 10s) | machine registrar | command router (target liveness), reaper |
| `gateway:device:{org}:{source}` | JSON blob (see gap #2) | 120s (refresh, see gap #5) | hub on device register | command routing, online discovery |

`machineID` = `FLY_MACHINE_ID` (→ hostname locally) — the same identity as
`GATEWAY_INSTANCE_ID`.

**Commands-down.** A browser sends a command to its node (X). X looks up
`gateway:device:{org}:{source}` → node Y. If Y == X, deliver locally; else
forward over the internal network (`{Y}.vm.<gateway-app>.internal/internal/command`)
and Y delivers to the device's socket. The X→Y hop must stay within the
**<500 ms command-latency budget** (confirmed acceptable) — on Fly's internal
network the forward is sub-millisecond.

**Failure modes** (self-healing): a node dies → its `gateway:machine` key expires
≤30s and its device-location keys ≤120s; affected devices reconnect to a survivor
(SDK backoff) and re-register. A command aimed at a just-dead node fails fast on
the liveness check. Redis down → commands fail fast, telemetry-up keeps flowing
(devices buffer to SQLite).

**Cost: read amplification.** With no affinity, an org's viewers can spread across
N nodes, and each reads that org's full stream (N× Redis read + decompress). Cheap
at moderate scale; the fix is browser-side affinity (§6) or cells (§4).

---

## 3. Known gaps — must close before any N≥2 active-active deploy

The drafted design covers telemetry-up, fan-out, and the command *request* hop.
These paths ride the in-process hub today and silently break cross-node — a
two-node deploy would look healthy in telemetry while these fail for any browser
on a different node than the device:

1. **Video relay.** `hub.RelayVideoFrame` is in-memory: device's node → that
   node's browsers only. A browser on X watching a camera on a device attached
   to Y gets nothing. Frames are large and continuous, so they can't ride the
   command-forwarding hop as-is. Options: reverse-forward frames over the
   internal network on camera-subscribe, or apply browser affinity (route the
   viewer to the device's node) for video specifically.
2. **Device presence.** `init.online_sources` (`hub.GetOnlineSources`) and
   `source_status` online/offline broadcasts are local-node only. Fix: publish
   `source_status` through the org stream (low-volume; every node already reads
   it under §4 groups), and enrich the `gateway:device` value to a small JSON
   blob `{machine, platform, sensors, cameras}` so any node can answer `init`.
3. **`command_result` return path.** The device's node broadcasts results to its
   local browsers; the requesting browser on another node never hears back. Fix:
   through the org stream, or reverse-forward along the command path.
4. **Internal endpoint auth.** ✅ **Done.** Fly's private network is org-wide, not
   app-scoped. `/internal/command` now requires `PLEXUS_INTERNAL_SECRET`:
   `gateway_config.go` `Validate` fail-closes in prod (the gateway refuses to boot
   without the secret when auth=api) and the handler enforces the `x-internal-secret`
   header.
5. **Location-map refresh coupling.** Don't refresh on SDK heartbeats — that
   couples liveness to device behavior we don't control (a telemetry-only device
   would expire at 120s while connected). Refresh from the gateway's own 30s
   ping ticker (`device.go` write loop), and make refresh conditional — only
   extend TTL if the value still names your own machine — so a half-dead stale
   connection can't overwrite a newer registration on another node.
6. **Synchronous XADD throughput.** `handleTelemetry` writes one blocking XADD
   per message inside the device read loop. At ~200 ms RTT to a remote Redis, a
   device caps at ~5 telemetry messages/sec. An async batched/pipelined writer
   is a **prerequisite** for any gateway not co-located with its Redis (Stage 5,
   or any cross-region topology).
7. **Dashboard-group reaper.** Phase 0's per-instance `dashboard:{instanceID}`
   groups are cleaned destroy-in-start — i.e. only when an org *reconnects*.
   Groups for orgs that connect once and never return, and groups left by a
   crashed/replaced instance (no clean restart with the same id), accumulate.
   A registry-driven reaper — `XGROUP DESTROY` for `dashboard:*` groups whose
   `{instanceID}` is no longer in `gateway:machine:*` — mops these up. It lives
   in clustered mode (it needs the machine registry) and is the same mechanism
   that handles the accepted Phase 0 orphan tradeoff. Cheap to defer: group
   state is tiny and the PEL is empty under NOACK, so accumulation is a slow,
   non-urgent leak.

**Staging tests:** the 2-gateways-against-one-Redis CI/staging exercise must
cover command forwarding **and** video, presence, and `command_result` — none of
these have a single-node analog.

---

## 4. Cell architecture (the Stage-5 shape)

Couple gateway + Redis **at the org level, not the machine level**: every org has
exactly one **home cell** (a region with gateways + Redis co-located), and its
stream lives there, whole. This preserves the one-stream-per-org invariant that
the broadcast-group design, the back-pressure model, and the durable consumers
all stand on.

- **Inside a cell** everything is the current architecture, unchanged.
- **Self-serve is already a cell.** A customer's single box is one cell of the
  cloud topology — the two hosting models become the same unit, repeated.
- **Ingest:** anycast lands an org's devices in/near their home region; writes
  are local. A traveling device that lands on a foreign gateway writes
  cross-region to the org's home Redis (async batched — gap #6 above).
- **Egress:** route browsers to the org's home cell via the app (Fly
  `fly-replay` / replay-cookie — browsers only, never devices). The remaining
  long-haul hop is the browser's own WS, which tolerates latency. Until
  browser-pinning exists, a remote gateway reading the home Redis cross-region
  works unchanged — it just adds RTT to dashboard freshness.
- **Commands:** the device-location map lives in the org's home Redis; any
  gateway resolves org → home → device location → forward.
- **Durable consumers:** one ch-loader / alert-service set per cell, reading
  local Redis for orgs homed there. ClickHouse / Postgres / app stay central
  (loader batches amortize cross-region RTT).
- **Control plane:** the org → home-region map is approximately a Postgres
  column, plus the existing app/auth which is already central.
- **Failure posture:** a cell's Redis dying degrades that cell's orgs only;
  devices buffer to SQLite as today.

**Honest residue:** someone has to assign homes (mostly automatic — where the
fleet is; possibly "region of first device connect"), org migration between
regions becomes a real occasional operation, and a single org with devices on
three continents still picks one home — physics gets the last word.

---

## 5. SDK evolution: server-driven hints

The plan's invariant is "devices never *need* to change." The way to add SDK
intelligence without breaking it:

- The gateway may send optional hint messages (e.g. `{"type": "hint", ...}` —
  reconnect-here, backoff-this-much). Old SDKs ignore unknown message types;
  new SDKs may act on them.
- **Rule: gateway correctness never depends on SDK version.** Hints can only
  improve behavior, never be required.
- **Anti-goal: no client-side gateway discovery** (regional endpoint lists,
  latency probing). Fly anycast already routes every device to the nearest
  healthy region and fails over to the next-closest when one dies — server-side,
  free, and with zero logic shipped to field-installed devices.

---

## 6. Deferred levers

Not now; documented so they aren't rediscovered.

- **Per-viewer subscription filter** — the biggest remaining egress lever (post
  pull-model ~8.7 TB → ~900 GB). Invariants to preserve when built: (1) no
  persistent per-viewer state — filter lives on `BrowserConn`, dies with the
  connection; (2) full replacement over deltas — client sends the complete set on
  every change; (3) no subscription = broadcast everything.

  Wire protocol + sketch:
  ```json
  { "type": "set_subscription", "keys": [["drone-01","battery"],["drone-01","rpm"]], "sources": ["drone-02"] }
  { "type": "clear_subscription" }
  ```
  `keys` = exact (source, metric) pairs; `sources` = wildcard for all of a
  source's metrics; a point passes if it matches either. Gateway: `subFilter` on
  `BrowserConn` via `atomic.Pointer` (lock-free read from the flush loop);
  `flush()` passes structured `(source_id, metric, raw)` tuples; `hub` filters per
  connection and caches one marshal for the common nil-filter case. Frontend: a
  reference-counted subscription manager + `useSubscribeKeys`/`useSubscribeSource`
  hooks (mount retains, unmount releases), re-sending the full set on every
  reconnect; migrate charts one at a time (nil-filter = broadcast, so un-migrated
  charts keep working).
- **Device WS `permessage-deflate`** (`CompressionContextTakeover`) — ~60–70%
  device→gateway wire reduction; one-line change in `device.go`.
- **MetricAnnouncer O(n) scan** — restructure the known-set to nested
  `org → source → metric` maps when device count grows (1000+ devices × 50+
  metrics).
- **Browser-side affinity (read-amplification fix).** In active-active,
  connections land anywhere, so an org's viewers can spread across N nodes and
  each node reads that org's stream — N× Redis read + decompress. When that cost
  measurably matters, add *gentle* co-location: the app (which we ship) calls
  `/assign` to prefer the node already reading the org. **Browsers only — never
  devices.** This is where the old `/assign` + Fly `replay_cache` cookie
  mechanism lives (browsers can't set WS-upgrade headers, so route by cookie).
  An optimization, not a requirement — and in the cell architecture (§4) it
  becomes regional rather than per-machine.
- **High-rate live decimation (escape hatch — not yet needed).** The dashboard
  flush forwards *every* buffered point per `(source, metric)` (see
  `ARCHITECTURE.md`), which is correct for monitoring: it preserves transients.
  Realistic sample rates make its wire cost small (~≤1 point/window below 40 Hz;
  ~50/window at the 2 kHz `MaxHzPerSource` ceiling), which is why per-window
  sample count isn't an egress lever today. **If** a sustained high-rate metric
  ever makes live egress hurt, the fix is **per-window decimation that preserves
  extremes + events** — send last + min + max per flush
  window — **not** last-value-wins. Pure last-value-wins is cheaper but aliases
  out transients and can drop the exact point that crossed a threshold, hiding an
  active alert in the live view; it trades monitoring correctness for simplicity.
  Reach for this only when measurement shows high-rate metrics dominating egress.
