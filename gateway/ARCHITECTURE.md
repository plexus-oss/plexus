# Plexus Gateway — Architecture

This is the deep-dive companion to [README.md](./README.md). The README
covers what the gateway is and how to run it; this doc covers how it
actually works internally — protocols, auth flow, security model, and
the per-fanout details. Read this when you're about to *change* the
gateway, debug something weird, or audit the trust model.

## Three data paths

Three distinct paths move data through the gateway. Keeping them separate in
your head is the single most useful thing for reasoning about this service.

**1. Telemetry up** — devices → Redis Stream → N independent consumers.
The gateway is *itself* one of those consumers (the per-instance
`dashboard:<instanceID>` group lives inside the gateway binary); the alert
service and ch-loader are separate
processes that read Redis directly with their own consumer groups.

```
                          ┌─ same host ──────────────────────────────┐
                          │                                          │
  ┌─────────┐ /ws/device  │  ┌──────────────┐ XADD  ┌─────────────┐  │
  │ Devices │────────────▶│─▶│   Gateway    │──────▶│    Redis    │  │
  └─────────┘  v:2 batch  │  │              │       │             │  │
                          │  │   device.go  │       │ telemetry.  │  │
  ┌─────────┐ POST/ingest │  │   ingest.go  │       │ stream:{org}│  │
  │HTTP devs│────────────▶│─▶│              │       │             │  │
  └─────────┘  v:2 batch  │  │              │       │             │  │
                          │  │ downsample.go│◀─XREAD│             │  │
  ┌─────────┐ /ws/browser │  │ dashboard:id │ group │             │  │
  │ Browsers│◀────────────│──│              │       │             │  │
  └─────────┘  25ms flush │  │              │       │             │  │
               per metric │  └──────────────┘       └──┬───────┬──┘  │
                          │                            │       │     │
                          └────────────────────────────┼───────┼─────┘
                                                       │       │
                                          XREADGROUP   │       │  XREADGROUP
                                          "alerts"     │       │  "ch-loader"
                                                       ▼       ▼
                                              ┌──────────────┐  ┌──────────────┐
                                              │Alert Service │  │ Python loader│
                                              │  (Go, built) │  │ → ClickHouse │
                   POST transitions ◀─────────│  plexus/     │  └──────────────┘
                   to Next.js                 │  alert-service│
                                              └──────────────┘
```

Two things to notice in this picture:

- **The gateway both writes and reads Redis.** `device.go` and `ingest.go`
  do the XADD on ingress (WS and HTTP respectively); `downsample.go` does
  the XREADGROUP for the per-instance `dashboard:<instanceID>` group and
  fans out to browsers. Same
  process, two roles. The "dashboard consumer" is not a separate service.
  The gateway does *not* do any alert evaluation — it is pure data movement.
- **External consumers connect to Redis directly.** The alert service
  and the ch-loader each open their own Redis connection and call
  `XREADGROUP` against `telemetry.stream:{org}` with their own group name.
  They do *not* go through the gateway. This is what makes them
  independently scalable and independently replayable.

Each consumer group has its own cursor and its own backpressure. A slow
ch-loader does not slow the dashboard; a restarted FastAPI picks up where it
left off; a freshly-deployed gateway re-reads from `$` for its dashboard
group.

**2. Commands down** — browser → gateway → target device, never touches Redis:

```
  ┌─────────┐  /ws/browser   ┌────────────────────────┐  ws  ┌─────────┐
  │Browsers │───────────────▶│        Gateway         │─────▶│ Devices │
  └─────────┘  {type:        │  browser.go            │      └─────────┘
                start_stream,│    ├─ validate         │
                source_id,…} │    ├─ rebuild from     │
                             │    │   allowlist       │
                             │    └─ hub.SendToDevice │
                             │         (in-mem map)   │
                             └────────────────────────┘
```

Low-volume, point-to-point, latency-critical — no fan-out benefit, so it stays
off Redis. Cross-instance command routing is future work.

**3. Video** — device → gateway → subscribed browsers, in-memory relay only:

```
  ┌─────────┐  video_frame   ┌──────────┐  relay  ┌─────────┐
  │ Devices │───────────────▶│  Gateway │────────▶│Browsers │
  └─────────┘   (base64)     │ (in-mem) │         └─────────┘
                             └──────────┘
```

No Redis, no persistence. Frames are dropped if no browser is subscribed.

## Why Streams + consumer groups (not pub/sub)

- **One write, many readers.** Device does one XADD. Each consumer group
  independently reads the same entries with its own cursor. No fan-out
  middleman, no duplication.
- **Backpressure is per-consumer.** If `ch-loader` falls behind, dashboard
  is unaffected — they track separate last-delivered IDs.
- **Replayable.** New consumers join and read from `0`, `$`, or any entry ID.
  Pub/sub messages are gone the instant they're sent.
- **Per-org isolation.** Stream key is `telemetry.stream:{org}`, so a noisy
  org can't starve another org's browsers or loader.

## The v:2 envelope

One XADD carries a batch of points for a single source:

```json
{
  "v": 2,
  "trace_id": "uuid",
  "org_id": "acme",
  "source_id": "drone-17",
  "ingested_at": 1733788800123,
  "points": [
    {"class": "metric", "metric": "battery", "value": 87.2, "timestamp": 1733788800100},
    {"class": "metric", "metric": "altitude", "value": 412.5, "timestamp": 1733788800100}
  ]
}
```

Heartbeats and device errors ride the same stream as separate entries
(`type: "heartbeat"`, or a v:2 envelope with `class: "event"` +
`metric: "device.error"`). Consumers dispatch on `type` / `class`.

## Commands down — full walkthrough

The browser path is bidirectional. **Telemetry-up** goes through Redis;
**commands-down** do not. When a browser sends a command:

1. Browser WS (`/ws/browser`) → gateway's `browser.go` validates and
   **rebuilds** the command from an allowlist of fields (never forwards raw
   browser JSON) — `handleDeviceCommand` in `browser.go`.
2. Gateway looks up the target device in the in-memory hub and writes the
   sanitized command straight to that device's WebSocket.
3. Device ACKs / starts streaming / opens a camera / etc.

Command types currently relayed: `start_stream`, `stop_stream`,
`start_camera`, `stop_camera`, `start_can`, `stop_can`, `start_mavlink`,
`stop_mavlink`, `mavlink_command`, `configure`, `configure_camera`. See
`deviceCommandTypes` in `browser.go` for the authoritative list.

This path is deliberately off-Redis: commands are low-volume, latency-critical,
addressed to a single specific device, and don't benefit from fan-out. If the
target device isn't connected to this gateway instance, the command is
dropped (multi-instance command routing is future work).

## Auth

Both WebSocket endpoints **require auth as the first message**. Until that
message lands, the connection is in a short-timed handshake window and
can't send telemetry or receive commands. The gateway itself never stores
keys or sessions — it delegates to the Next.js app (`PLEXUS_API_URL`) and
caches results in memory.

**Two modes**, set via `GATEWAY_MODE` / `--auth`:

| Mode | When | What it does |
|---|---|---|
| `dev` | Local | Skips external verification entirely. All connections land in `DefaultOrg` (flag-only: `--org`, default `"default"` — there is no `GATEWAY_ORG` env var). Browsers get `user_id: "dev-user"`. Useful for local dev with any scratch WebSocket client. |
| `api` (prod) | Fly / staging | Calls Next.js to verify every *new* (uncached) key or session. `PLEXUS_API_URL` and `GATEWAY_ALLOWED_ORIGINS` are required — startup fails otherwise. |

**Device handshake** — `handleDeviceAuth` in `device.go`:

1. Device opens `ws://{gateway}/ws/device`. The gateway starts a 10s auth
   timeout (`DeviceAuthTimeout`).
2. Device sends its first frame:
   ```json
   {"type": "device_auth", "api_key": "plx_...", "source_id": "drone-17",
    "sensors": [...], "cameras": [...], "platform": "linux-arm64"}
   ```
3. Gateway calls `AuthClient.VerifyAPIKey(apiKey)` which either returns a
   cached `{org_id, user_id?}` or does `GET {API_URL}/api/auth/verify-key`
   with header `x-api-key: {apiKey}`. Any non-200 → error + close.
4. Gateway stores `orgID` on the `DeviceConn` and all subsequent telemetry
   for this connection is routed to `telemetry.stream:{org_id}`. The device
   can't override org — the stream key comes from the auth result, not
   from anything the device sends.
5. Gateway replies `{"type": "authenticated", "source_id": "drone-17"}`.
   The device starts streaming.

Telemetry isn't re-verified. One auth check per connection, good until
the device reconnects. Reconnect happens naturally on any network blip,
so a revoked key takes effect on the device's next reconnect (worst case
a few seconds), with positive cache accounting for up to 60s extra delay.

**Browser handshake** — `handleBrowserAuth` in `browser.go`:

1. Browser opens `ws://{gateway}/ws/browser`. Gateway first applies an
   **Origin-header check** via `GATEWAY_ALLOWED_ORIGINS` (glob patterns,
   e.g. `*.plexus.company`, `localhost:*`). Wrong origin → connection
   refused before any message. This gate is prod-only — dev mode allows
   all origins via `["*"]`.
2. Browser sends first frame:
   ```json
   {"type": "browser_auth", "token": "<next-auth session token>"}
   ```
3. Gateway calls `AuthClient.VerifySession(token)` → either a cached
   `{org_id, user_id}` or `GET {API_URL}/api/auth/verify-session` with
   header `Authorization: Bearer {token}`.
4. Gateway stores `orgID` + `userID` on the `BrowserConn`. The browser
   is now pinned to that org: its telemetry feed comes from
   `telemetry.stream:{org_id}` only, and its outbound commands pass through
   `hub.SendToDevice(conn.orgID, sourceID, payload)` — so a session for
   org A **cannot** address a device in org B even if it guesses the
   source ID.

**Why the Origin check is not applied to devices.** Native device clients
don't send an `Origin` header at all; the real gate for them is the API
key. The Origin check exists to stop a malicious webpage from opening a
browser WebSocket against the gateway from a user's logged-in browser.

**Cache behavior** (`auth.go`, `AuthConfig` in `gateway_config.go`):

- Positive entries: **60s TTL**. A device streaming at 50Hz would otherwise
  hit the Next.js verify endpoint tens of times per second per connection;
  this keeps it at ~1 call per minute per unique key.
- Negative entries: **10s TTL** (shorter on purpose). If an operator
  rotates a key they want the gateway to pick it up quickly — but they
  also don't want a brute-force attempt to hit Next.js on every guess.
- Cache is **per-process, in-memory**. Each gateway instance keeps its own.
  No Redis, no cross-instance invalidation.
- HTTP call timeout: 5s (`HTTPTimeout`). Max response size capped
  (`MaxResponseBytes`) to keep a hostile Next.js from blowing memory.

**Failure modes to know about:**

- Next.js unreachable in `api` mode → `VerifyAPIKey` returns an error, the
  device gets `{"type":"error","message":"Invalid API key"}` and is
  disconnected. There is currently no stale-cache fallback for
  reachability outages — if Next.js is down, new connections fail. Existing
  connections keep working because they aren't re-verified.
- Auth timeout (10s) without sending `device_auth` / `browser_auth` → the
  handshake read times out and the connection is closed. Protects against
  idle squatters.
- Sending anything other than the auth message first → error frame + close.

### External consumer auth (Redis-direct path)

The two auth flows above only cover connections that *terminate at the
gateway* — devices and browsers. The other consumers (`alert-service`,
`ch-loader`) talk to Redis directly and never see the gateway, so neither
flow applies to them.

For those, **the trust boundary is the internal network**:

- The gateway connects to Redis with no credentials. `RedisConfig` in
  `gateway_config.go` has no `Password`/`Username`/`TLS` field — it's
  `Addr` + `PoolSize` and that's it (`redis.go:63`).
- ch-loader does the same: `redis.from_url(args.redis_url)` against a
  plaintext URL with no auth.
- Redis itself runs without `requirepass` or ACLs.

This is intentional and assumes the deployment model: gateway, Redis,
the alert service, and ch-loader all live on a private network (Fly `.internal`,
VPC, etc.) and Redis is never reachable from outside it. Within that
network, "can open a TCP socket to `:6379`" is the only check. Consumer
group names (`dashboard:<instanceID>`, the alert service's group,
`ch-loader`) are *naming convention*, not authorization — any consumer
that reaches Redis can join any group on any org's stream.

Operational implication: the private-network boundary is load-bearing.
Do not bind Redis to `0.0.0.0`, do not poke firewall holes for it, do
not run a tunnel that exposes it to a public interface. If the trust
model ever softens (e.g. shared cluster, bring-your-own-Redis), add
`requirepass` — it's a small change but currently unimplemented.

## Known security limitations

These are gaps we know about and have chosen not to fix yet. They're
documented here so future readers don't rediscover them and so the
decision to defer is explicit.

**Within-org source-ID impersonation.** The API key authenticates the
*org*, not the *device*. A device sends both `api_key` and `source_id` in
its `device_auth` frame; the gateway verifies the key (which fixes the
org) but trusts whatever `source_id` the device claims. The implication:
anyone holding *any* valid API key for org X can connect and claim any
`source_id` in org X — including one already in use.

Blast radius if an org API key leaks:

- The attacker's fake telemetry appears in every org-X dashboard tagged
  as the victim device. There is no cryptographic binding between a key
  and a source to distinguish real from fake.
- `Hub.RegisterDevice` (`hub.go`) takes over the `(org, source_id)` slot:
  commands from browsers targeting the victim device now route to the
  attacker (the displaced connection is closed, so the takeover at least
  shows up in logs).

Why it's deferred: in practice API keys are per-device today (we
provision one key per agent install), so the only attacker who can
impersonate `source_id=X` is someone who already has X's key — at which
point they can also just *be* X. The gap becomes dangerous the moment
we issue org-scoped keys for multi-device installs, or if a key leak
ever happens.

Mitigation status:

1. **Shipped** — `Hub.UnregisterDevice` does conditional eviction: it only
   `delete`s the map entry if the stored conn pointer is still the one
   doing the unregistering (`hub.go`), so a superseded connection's exit
   can't evict its replacement.
2. **Shipped** — `Hub.RegisterDevice` closes the displaced conn on
   collision (`hub.go`), so a takeover terminates the prior read loop and
   is visible rather than silent.
3. **Still planned (the real fix)**: `/api/auth/verify-key` returns the
   source_id the key is bound to, and `handleDeviceAuth` rejects
   mismatches. This makes impersonation impossible at auth time. Requires
   a Next.js change and a DB column; not urgent until multi-device keys
   land.

Until then: rotate any leaked org key immediately. The 60s positive
auth cache means rotations take up to a minute to propagate to
existing gateway instances.

**No per-IP / global connection cap.** A single host can open as many
WebSocket connections as its FDs allow. Each idle connection sits in
the 10s auth handshake window before being closed if no `device_auth`
arrives. For prod this is fine because Fly's edge limits connection
rate upstream; for a self-hosted gateway, add a reverse proxy with
connection limits in front.

**No byte-rate ceiling.** The token bucket (`ratelimit.go`) and per-source
limiter (`source_limit.go`) cap *message count*, not bytes. With
`MaxMessageSize=1MB` and `TelemetryPerSec=500` (burst 2000), a single device
has a ~500 MB/s ceiling per second before anything rate-limits it. The envelope
byte validation added to `validate.go` (`MaxValueBytes=4096` per event
point) caps per-point size, which bounds the realistic damage, but
there's no explicit bytes-per-second ceiling. Add if this ever matters.

## Send in / receive out — per fanout

All three consumer groups read the same `telemetry.stream:{org}` using
XREADGROUP. What changes is how each one processes the entries.

### `dashboard:<instanceID>` — live browser fan-out (built, in-process)

The group name is **per-instance** — `dashboard:<instanceID>` with the id from
`GATEWAY_INSTANCE_ID` / `FLY_MACHINE_ID` (hostname fallback) — not a shared
`dashboard` / `dashboard-01`. A shared group would work-share the stream across
nodes; per-instance groups give each gateway node the full feed
(`gateway_config.go:333`).

| | |
|---|---|
| **Reads** | v:2 envelopes + `type:"heartbeat"` entries |
| **Where** | Inside the gateway, one `OrgReader` per active org (`downsample.go`) |
| **Processing** | Rehydrate each envelope point into flat v:1 wire format; appends each point into a per-`(source, metric)` buffer in arrival order, bounded by `maxBufferedPerKey`=1024 with oldest-wins eviction; fixed-tick flush (default 25ms). Heartbeats bypass the buffer and forward immediately. (Alert annotation was removed from this path — see [Alert annotation](#alert-annotation).) |
| **Emits** | JSON arrays of points over browser WebSocket (`/ws/browser`); plus `heartbeat` and `source_status` messages |
| **Status** | Built — runs inside this binary |

The flush batches every buffered point per `(source, metric)` (arrival order,
bounded by `maxBufferedPerKey`=1024, oldest-wins) into one frame — a fast device's
bursts reach the browser intact, but as a single batched message per flush cycle
rather than a packet per sample. Clients typically key by `source:metric` and keep
the latest for a live view (see
[Frontend integration](#frontend-integration-browser-ws-contract)). Idle orgs cost
effectively nothing because the flush early-returns on an empty buffer.

Flush interval and poll block live in `DownsampleConfig` — edit
`devDefaults()` in `gateway_config.go` to change them.

### `alerts` — alert lifecycle management (built, out-of-process)

| | |
|---|---|
| **Reads** | Same v:2 envelopes (metric-class points only; heartbeats and events skipped) |
| **Where** | Standalone Go service (`plexus/alert-service`), same Fly region as gateway |
| **Processing** | XREADGROUP → update per-(source, metric) exponentially weighted distributions (Welford's algorithm) → evaluate rules (threshold, outlier/z-score, compound cross-metric) → drive per-(rule, source) state machine (open → closing → closed → cooldown) with hysteresis on close. POSTs state transitions to Next.js. |
| **Emits** | `POST /api/internal/alerts/transitions` to Next.js (which handles Supabase writes, webhooks, RCA). (A ClickHouse `plexus.alert_events` sink existed but was removed from the alert service in commit 3bf7eb4 — not currently built.) |
| **Status** | Built — runs as `plexus-alert-service` on Fly |

The alert service is completely independent from the gateway. It reads
Redis directly with its own consumer group (`alerts`), maintains its own
rules (bootstrapped from Next.js, pushed on create/delete), and owns the
full alert lifecycle. The gateway does not evaluate rules or annotate
points — it is pure data movement.

Consumer lifecycle is driven by rules: an org gets a stream consumer when
its first rule is pushed, and the consumer stops when the last rule is
deleted. No consumers run for orgs without rules.

Rule types supported:
- **threshold** (v1): min/max bounds on a single metric
- **outlier** (v1): z-score from exponentially weighted distribution
- **compound** (v2): AND/OR over multiple threshold/outlier sub-rules for the same device

### `ch-loader` — durable storage (built, out-of-process)

| | |
|---|---|
| **Reads** | Same v:2 envelopes |
| **Where** | External Python service (separate repo) |
| **Processing** | Consults a Supabase-fed per-source recording filter (`RecordingStore`), routes each point by `class` to the matching table, batch-inserts every 1–5s, XACKs on confirmed insert. No downsampling and no Redis device-config cache. |
| **Emits** | Rows in ClickHouse via the Distributed wrappers: `telemetry_dist`, `events_dist`, `video_sessions_dist` (range aggregation is served by the 1min/1hr rollup materialized views, not the loader) |
| **Status** | Built, runs as its own process |

Loader runs as its own process — it talks to Redis directly, not to the
gateway. If it crashes or falls behind, its pending entries stay in the
stream until it ACKs them; dashboard and alert-service are unaffected.

## Wire protocols

### Device protocol

1. Connect to `ws://{gateway}/ws/device`
2. Send `device_auth`: `{"type": "device_auth", "api_key": "plx_...", "source_id": "...", "sensors": [...], "cameras": [...]}`
3. Receive `authenticated`: `{"type": "authenticated", "source_id": "..."}`
4. Send telemetry (v:2 envelope): `{"type": "telemetry", "v": 2, "trace_id": "...", "source_id": "...", "points": [...], "ingested_at": N}`
5. Send heartbeats: `{"type": "heartbeat", "source_id": "...", "uptime_s": N}`
6. Send video frames: `{"type": "video_frame", "v": 1, "source_id": "...", "camera_id": "...", "frame": "base64...", "width": N, "height": N, "timestamp": N}`
7. Receive commands-down from browsers: `start_stream`, `stop_stream`, `start_camera`, `stop_camera`, `configure`, etc.

### Browser protocol

See [Frontend integration](#frontend-integration-browser-ws-contract) for the full
browser contract (handshake, the `ready` pull model, alert annotation, video).
Summary:

1. Connect to `ws://{gateway}/ws/browser`
2. Authenticate with the first frame — one of three modes
   (`handleBrowserAuth` in `browser.go`):
   - `browser_auth`: `{"type": "browser_auth", "token": "..."}` — dashboard
     session (ws-token via `/api/auth/verify-session`). Full telemetry +
     video, may send device commands.
   - `share_auth`: `{"type": "share_auth", "token": "..."}` — shared-dashboard
     link token (via `/api/auth/verify-share`). Anonymous read-only viewer:
     telemetry + video, device commands are rejected with an error frame.
   - `data_api_auth`: `{"type": "data_api_auth", "api_key": "plx_..."}` — API
     key (via `/api/auth/verify-key`). No org-wide telemetry flushes; use
     `subscribe` (below) to receive filtered metric/log streams.
3. Receive `init`: `{"type": "init", "online_sources": [...]}`
4. Receive telemetry batches: `[{point}, {point}, ...]` (JSON array, one entry per (source, metric) per flush)
5. Receive heartbeats: `{"type": "heartbeat", "source_id": "...", "status": "running"}`
6. Receive device status: `{"type": "source_status", "source_id": "...", "status": "online|offline"}`
7. Send commands: `{"type": "start_stream", "source_id": "...", "metrics": [...], "interval_ms": 100}`
8. Optionally send `subscribe` frames to narrow what you receive:
   - `{"type": "subscribe", "stream": "metrics", "source_id": "...", "metrics": ["a", "b"]}` —
     per-device metric stream for `data_api_auth` connections (empty
     `metrics` = all metrics for that device).
   - `{"type": "subscribe", "stream": "logs", "source_id": "..."}` — filter
     event frames to one device (empty `source_id` clears the filter).
   - `{"type": "subscribe", "cameras": ["cam0"], "max_fps": 15}` — replace the
     camera subscription set for video relay (no `stream` field; empty
     `cameras` = all cameras, `max_fps` 0 = unlimited).

## Redis keys

| Key | Type | Description |
|---|---|---|
| `telemetry.stream:{org}` | Stream | Telemetry + heartbeats + device errors. MAXLEN ~100K. Consumer groups: `dashboard:<instanceID>` (gateway, per-instance), the alert service's group (houston), `ch-loader` (Python loader). |
| `video_sessions.stream` | Stream | Browser video session records for connection-level metering (one entry per disconnect + periodic sweep). |

The gateway reads/writes no other Redis keys — there is no per-device or
per-org config in Redis (ch-loader's per-source recording filter reads from
Supabase via its `RecordingStore`, not Redis).

## Code map

| File | Role |
|---|---|
| `main.go` | Entry point, routes, graceful shutdown |
| `gateway_config.go` | Config struct, flags, env var overrides, dev/prod defaults |
| `hub.go` | Connection registry, org reader lifecycle, status |
| `device.go` | Device WebSocket: auth, telemetry → XADD, heartbeat, video relay |
| `ingest.go` | HTTP `POST /ingest`: auth, validate, class inference, v:2 envelope → XADD (mirrors device.go for HTTP clients) |
| `browser.go` | Browser WebSocket: auth, command relay to devices |
| `downsample.go` | `dashboard:<instanceID>` consumer group: per-org XREADGROUP + last-value buffer + fixed-tick flush to browsers |
| `metric_announcer.go` | First-sight (org, source, metric) announcer: POSTs to `/api/sources/register` so live-only sources appear in the UI |
| `redis.go` | Redis client wrapper: XADD, XREADGROUP, consumer-group management, circuit breaker |
| `auth.go` | API key + session verification with 60s cache |
| `validate.go` | Message validation: `ValidatePoints` / `ValidatePoint` shared between WS and HTTP paths |
| `ratelimit.go` | Token bucket rate limiter |
| `source_limit.go` | Per-source telemetry rate safety cap (abuse protection) |

## Frontend integration (browser WS contract)
How a Next.js app connects to the Plexus gateway for live telemetry and
device control. Browsers talk to the gateway directly over WebSocket — the
stream never hits Vercel. Auth is a Plexus ws-token sent as the first frame:
the app mints one via `POST /api/auth/ws-token` (HS256 over `AUTH_SECRET`,
issuer `plexus-ws`, 5-min TTL) and the gateway resolves it back to
`{org_id, user_id}` via `GET /api/auth/verify-session`.

- Prod URL: `wss://gateway.plexus.company/ws/browser`
- Dev URL: `ws://localhost:8080/ws/browser`

### Setup

```bash
# .env.local
NEXT_PUBLIC_GATEWAY_HOST=gateway.plexus.company
```

Your browser origin must be in the gateway's `GATEWAY_ALLOWED_ORIGINS`
allowlist. Production already covers `app.plexus.company,*.plexus.company`.
Local dev should run the gateway with `GATEWAY_MODE=dev` and
`GATEWAY_ALLOWED_ORIGINS=*`, which also skips token verification and accepts
any string as the token.

### The handshake

1. Open the socket.
2. On `onopen`, send `{type: "browser_auth", token}`.
3. Gateway responds with `{type: "init", online_sources: [...]}`.
4. From then on, you receive typed frames — one per message.

If `browser_auth` isn't the first frame within ~10s, or the token is invalid,
the gateway sends `{type: "error", message}` and closes.

Mint a fresh ws-token every time you reconnect — they expire in 5 minutes,
don't cache them across reconnects.

```ts
// POST /api/auth/ws-token mints a short-lived signed token for the session.
const { token } = await fetch("/api/auth/ws-token", { method: "POST" }).then((r) => r.json());
```

### Incoming frames

Every frame has a top-level `type`. Dispatch with a single switch.

| `type`          | Meaning                  | Payload                                                      |
| --------------- | ------------------------ | ------------------------------------------------------------ |
| `init`          | After auth, once         | `online_sources: [{source_id, platform, sensors, cameras: [{camera_id, video_type}]}]` |
| `source_status` | Device online/offline    | `source_id, status, platform?, sensors?, cameras?: [{camera_id, video_type}]`          |
| `heartbeat`     | ~Every 5s per device     | `source_id, uptime_s, status`                                |
| `telemetry`     | Metric batch (hot path)  | `points: [{source_id, metric, value, timestamp, ...}]`       |
| `event`         | Single event, flat shape | `source_id, metric, value, timestamp, class: "event"`        |
| `error`         | Problem with your frame  | `message`                                                    |
| `pong`          | Reply to your `ping`     | —                                                            |

After receiving `init` and after each `telemetry` frame, send `{type: "ready"}`
to signal the gateway you are ready for the next batch. The gateway uses a pull
model for telemetry — it only delivers the next flush when you signal readiness.
Non-telemetry frames (`source_status`, `heartbeat`, `event`) arrive independently
and do not require a `ready` signal.

Notes on `telemetry`:

- The gateway buffers per `(source_id, metric)` and flushes on a tick: a frame
  batches every buffered point per key in arrival order (bounded, oldest-wins).
  **Multiple points for a `source:metric` can appear in one frame** — key by
  `source:metric` and keep the latest for a live view, or read them all for
  high-rate rendering. For full history, query ClickHouse instead.
- A single frame can span multiple sources — read `source_id` off each point,
  not from the envelope.
- `value` is polymorphic (number, string, bool, object, array).
- `timestamp` is ms since epoch.
- Points do **not** carry an `alert` field — gateway-side alert annotation
  was removed (see [Alert annotation](#alert-annotation) below).
- You receive every metric for the org. Filter client-side; per-viewer
  subscription pushdown is planned (see `PLAN.md` §9).

### Outgoing frames

`browser_auth` is required first. Everything else is optional.

```ts
ws.send(JSON.stringify({ type: "ping" }));           // keepalive → pong
ws.send(JSON.stringify({
  type: "start_stream",                              // device command
  source_id: "drone-014",
  metrics: ["battery.pct", "gps.lat"],
  interval_ms: 100,
  store: true,
}));
```

Device commands are an allowlist. Unknown types are silently dropped. If the
target device isn't connected, the gateway replies
`{type: "error", message: "device not connected"}`.

| Command            | Extra fields                                          |
| ------------------ | ----------------------------------------------------- |
| `start_stream`     | `metrics`, `interval_ms`, `store`                     |
| `stop_stream`      | `stream_id`                                           |
| `start_camera`     | `camera_id`, `frame_rate`, `resolution`, `quality`    |
| `stop_camera`      | `camera_id`                                           |
| `start_can`        | `channel`, `dbc_path`, `interval_ms`                  |
| `stop_can`         | `channel`, `dbc_path`, `interval_ms`                  |
| `start_mavlink`    | `connection_string`, `interval_ms`                    |
| `stop_mavlink`     | `connection_string`, `interval_ms`                    |
| `configure`        | `sensor`, `config`                                    |
| `configure_camera` | `camera_id`, `config`                                 |

All commands require `source_id`.

### Minimal hook

```ts
// hooks/useGateway.ts
"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Mints a short-lived gateway handshake token for the current session.
async function getGatewayToken(): Promise<string | null> {
  const res = await fetch("/api/auth/ws-token", { method: "POST" });
  if (!res.ok) return null;
  const body = (await res.json()) as { token?: unknown };
  return typeof body.token === "string" ? body.token : null;
}

export function useGateway() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [sources, setSources] = useState(new Map<string, any>());
  const [points, setPoints] = useState(new Map<string, any>());

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;

    async function connect() {
      if (cancelled) return;
      const token = await getGatewayToken();
      if (!token) return;

      const host = process.env.NEXT_PUBLIC_GATEWAY_HOST!;
      const scheme = host.startsWith("localhost") ? "ws" : "wss";
      const ws = new WebSocket(`${scheme}://${host}/ws/browser`);
      wsRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({ type: "browser_auth", token }));

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case "init":
            attempt = 0;
            setConnected(true);
            setSources((prev) => {
              const next = new Map(prev);
              for (const s of msg.online_sources ?? []) {
                next.set(s.source_id, { ...s, status: "online" });
              }
              return next;
            });
            break;
          case "source_status":
            setSources((prev) => new Map(prev).set(msg.source_id, msg));
            break;
          case "telemetry":
            setPoints((prev) => {
              const next = new Map(prev);
              for (const p of msg.points ?? []) {
                next.set(`${p.source_id}:${p.metric}`, p);
              }
              return next;
            });
            break;
          case "error":
            console.error("gateway:", msg.message);
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (cancelled) return;
        setTimeout(connect, Math.min(1000 * 2 ** attempt++, 30_000));
      };
    }

    connect();
    const ping = setInterval(() => send({ type: "ping" }), 25_000);

    return () => {
      cancelled = true;
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, [send]);

  return { connected, sources, points, send };
}
```

### Alert annotation

**Removed.** The gateway no longer stamps `alert: 0|1` on metric points, and
the rule-push endpoints (`POST /internal/rules/{orgID}`,
`GET /api/internal/rules/all`) plus the in-memory rule store were deleted from
the gateway in commit 370b669 (Apr 10 2026). Alert evaluation lives entirely
in the external alert service (houston), which reads Redis with its own
consumer group. Browser telemetry points do not carry an `alert` field —
alert state reaches the UI through the alerting pipeline, not this stream.

### Gotchas

- **Reconnect with a fresh token.** ws-tokens expire in 5 minutes — always
  mint a new one via `POST /api/auth/ws-token` before each reconnect, never
  cache across reconnects.
- **First frame is `browser_auth`.** Don't `await` anything slow before it.
- **`telemetry` is a batch.** Loop `msg.points` and key by
  `source_id:metric`.
- **Origin rejections are silent.** A socket that opens then immediately
  closes with no message usually means your origin isn't in the allowlist.
- **503 on connect** = gateway can't reach Redis. Back off and retry.
- **Send `ready` after every `telemetry` frame.** Without it the gateway
  stops delivering batches — the pull model requires an explicit signal.

### Video streaming

The gateway relays video frames from devices to subscribed browsers over the
same WebSocket connection. Video is **not persisted to Redis** — it's a live
relay only.

#### Subscribe to cameras

Before receiving video frames, subscribe to the cameras you want to watch:

```ts
ws.send(JSON.stringify({
  type: "subscribe",
  cameras: ["front-door", "backyard"],  // camera IDs to receive
  max_fps: 15,                         // optional: cap frames/sec
}));
```

- **`cameras`**: Array of camera IDs. Empty array = receive all cameras (backwards compatible).
- **`max_fps`**: Optional frame rate cap. If the device streams at 30fps and you
  request 15fps, you receive every 2nd frame. Use this to reduce bandwidth
  on slower connections.

#### Receive video frames

Video frames arrive with type `video_frame`:

```json
{
  "type": "video_frame",
  "camera_id": "front-door",
  "frame": "base64-encoded-jpeg...",
  "width": 640,
  "height": 480,
  "timestamp": 1733788800100
}
```

- **`frame`**: Base64-encoded JPEG image. Decode with `atob()` in browser,
  then create an `Image` or render to `<canvas>`.
- **`camera_id`**: Which camera sent this frame. Use to route to the
  correct UI element if displaying multiple streams.
- **`timestamp`**: ms since epoch (server time, not device time).

#### Rendering video

```ts
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "video_frame") {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById("video-canvas");
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${msg.frame}`;
  }
};
```

#### Thermal cameras

Thermal cameras send the same `video_frame` message format with additional fields.
The `video_type` of each camera is available in `online_sources` and `source_status`
**before the first frame arrives**, so you can set up the correct renderer in advance.

##### Additional fields on thermal `video_frame`

| Field           | Type             | Description |
| --------------- | ---------------- | ----------- |
| `video_type`    | `"thermal"`      | Present on every frame; use for late-join fallback |
| `sensor_width`  | number           | Native sensor resolution (may differ from `width` for small I2C sensors) |
| `sensor_height` | number           | Native sensor resolution |
| `temp_min`      | number           | Minimum temperature in frame (°C) |
| `temp_max`      | number           | Maximum temperature in frame (°C) |
| `temps`         | number[] \| undefined | Flat float32 array of temperatures in °C, length `sensor_width × sensor_height`. Present only for small sensors (≤ 4096 pixels, e.g. MLX90640 32×24). |

The `frame` field is a colorized JPEG (inferno colormap) — render it on a `<canvas>` exactly
like a normal video frame. Determine which renderer to use from the camera's `video_type`,
known from `online_sources`/`source_status` before the first frame; fall back to the
per-frame field for late joins:

```ts
const videoType = cameraTypes.get(msg.camera_id) ?? msg.video_type ?? "normal";
```

Rendering specifics (temperature scale bar, pixel-level `temps` hover queries, upscale
coordinate mapping) live with the renderer in the app repo — see
`hooks/realtime/thermal-rendering.md`.

#### Update subscriptions

Send a new `subscribe` message to change cameras or fps. The gateway replaces
the entire subscription (not a delta):

```ts
// Switch to different cameras
ws.send(JSON.stringify({
  type: "subscribe",
  cameras: ["garage"],
  max_fps: 10,
}));
```

#### Frame rate limiting

The gateway handles rate limiting server-side:

| Device fps | Requested fps | Frames sent |
|------------|---------------|------------|
| 30         | 0 (no limit) | 30/sec    |
| 30         | 15            | 15/sec     |
| 30         | 10            | 10/sec     |
| 9          | 15            | 9/sec      |

If you request a higher fps than the device sends, you receive all frames
(no up-sampling).

#### Connection handling

- **Hidden tabs** are automatically throttled. The gateway skips sending
  frames to throttled connections to save CPU/network. Set
  `throttleUntil = 0` via `set_throttle` to opt out.
- **Buffer overflow**: If your browser can't keep up, frames are dropped
  silently. Lower `max_fps` or reduce the number of subscribed cameras.

