# Plexus Gateway

![License: Elastic 2.0](https://img.shields.io/badge/license-Elastic%202.0-blue)

Go server that terminates device + browser connections, accepts HTTP
telemetry, and fans data out via Redis Streams. Replaces PartyKit.

## TL;DR

- One binary, one box. Gateway and Redis run on the same host so XADD is
  localhost and sub-ms.
- Devices speak WebSocket to `/ws/device` or HTTP to `POST /ingest`. Both
  paths produce **one XADD** (not one-per-point) into
  `telemetry.stream:{org}` using the **v:2 envelope**.
- Multiple consumer groups read that same stream independently:
  `dashboard:<instanceID>` (built, in-process — per-instance group, see
  `gateway_config.go`), the alert service's group (external, houston),
  `ch-loader` (built, external Python service → ClickHouse).
- Browsers speak WebSocket to `/ws/browser` for live data (fanned out of the
  per-instance `dashboard:<instanceID>` group) and for **commands-down** to
  devices — commands are relayed straight device-side and never touch Redis.
- **Alert annotation: removed.** The gateway used to stamp `alert: 0|1` on
  metric points from in-memory threshold rules pushed by Next.js. That
  feature (and the `POST /internal/rules/{orgID}` / `GET
  /api/internal/rules/all` rule plumbing) was deleted from the gateway in
  commit 370b669 (Apr 10 2026) and now lives in the external alert service
  (houston). The gateway is pure data movement.
- Video frames are relayed in-memory device → browser. No Redis, no persistence.

## Architecture at a glance

```
   Devices ──/ws/device──▶  ┌─ Gateway + Redis ─┐  ──/ws/browser──▶ Browsers
   HTTP ────POST /ingest──▶ │   (same host)     │
                            └─────────┬─────────┘
                                      │ XREADGROUP per group
                                      ▼
                            alert service (houston) · ch-loader
                            (external consumers, separate processes)

   Services ──POST /internal/command──▶ Gateway (x-internal-secret command relay)
```

The gateway both writes Redis (device + HTTP ingress, XADD) and reads it
back (per-instance `dashboard:<instanceID>` consumer group, fan-out to
browsers) — same process. External consumers (alert service, `ch-loader`)
connect to Redis directly with their own consumer groups; they don't go
through the gateway.

For the full picture — three-path diagrams (telemetry up, commands down,
video), the v:2 envelope, why Streams instead of pub/sub — see
[ARCHITECTURE.md](./ARCHITECTURE.md#three-data-paths).

## Local setup

Prerequisites: Go 1.22+, Docker (for Redis).

### 1. Start Redis

```bash
cp .env.example .env          # gitignored; defaults work for local
docker compose up -d redis    # binds localhost:6379
```

### 2. Run the gateway

```bash
go run .                      # or: go build -o gateway && ./gateway
```

Smoke-test it's up:

```bash
curl -s localhost:8080/health | jq .
# → {"status": "ok", "devices": 0, "browsers": 0, "orgs": [],
#    "device_list": [], "redis": "connected", "uptime_s": ...}
# `orgs` lists org IDs with an active stream reader; `device_list` has one
# {source_id, org, platform} entry per connected device. Returns 503 with
# status "degraded" when the Redis circuit is open.
```

No per-org seeding is required — the org's telemetry stream is created on
first XADD.

### 3. Connect a device

Point any WebSocket client at `ws://localhost:8080/ws/device` and follow
the [device protocol](./ARCHITECTURE.md#device-protocol): send a
`device_auth` frame first, then stream `telemetry` / `heartbeat` frames.
In dev mode the `api_key` is not verified against any external service,
so any string works.

Verify entries are landing in the stream:

```bash
redis-cli XLEN telemetry.stream:default
redis-cli XRANGE telemetry.stream:default - + COUNT 1
```

### 4. Connect a browser

Point any WebSocket client at `ws://localhost:8080/ws/browser` and follow
the [browser protocol](./ARCHITECTURE.md#browser-protocol): send a
`browser_auth` frame, then receive live telemetry batches and optionally
send commands back down.

### 5. (Optional) Run a downstream consumer

The alert service (houston) and `ch-loader` are separate processes (not part
of this repo). They join the stream with their own consumer group name
(`alerts`, `ch-loader`) and read independently:

```bash
redis-cli XGROUP CREATE telemetry.stream:default <group-name> '$' MKSTREAM
```

Check lag across any registered groups at any time:

```bash
redis-cli XINFO GROUPS telemetry.stream:default
# Shows pending count and last-delivered-id per group
```

### 6. (Optional) Prod-mode smoke test

Flip `GATEWAY_MODE=prod` in `.env` and set `PLEXUS_API_URL` +
`GATEWAY_ALLOWED_ORIGINS`. `Validate()` will reject startup otherwise — this
mirrors what happens on Fly.

## Endpoints

| Path | Type | Description |
|---|---|---|
| `GET /ws/device` | WebSocket | Device connections (telemetry ingress) |
| `GET /ws/browser` | WebSocket | Browser connections (dashboard + commands-down) |
| `POST /ingest` | HTTP | HTTP telemetry ingress (same path as WS, for agents/ESP32/SDKs) |
| `POST /internal/command` | HTTP | Server-to-server typed-command relay to a connected device (`x-internal-secret` auth, `main.go:85`) |
| `GET /health` | HTTP | Status JSON: `status`, `devices` (int), `browsers` (int), `orgs` (array of org IDs), `device_list`, `redis`, `uptime_s`; 503 when degraded |

(`POST /internal/rules/{orgID}` and `GET /api/internal/rules/all` were removed
with the alert-annotation feature in commit 370b669 — rules now live in houston.)

## Auth

Both WebSocket endpoints require auth as the first message: devices send
`device_auth` with an API key, browsers send `browser_auth` with a session
token. In `dev` mode (`GATEWAY_MODE=dev`) verification is skipped and
everything lands in `DefaultOrg`. In `api` mode the gateway calls
`PLEXUS_API_URL` to verify each new key/session, with a 60s positive
cache.

External consumers (the alert service, ch-loader) connect to Redis **directly**,
not through the gateway. Their trust boundary is the internal network —
Redis runs without `requirepass` by design.

For the full handshake sequences, cache behavior, failure modes, and the
known security limitations, see
[ARCHITECTURE.md#auth](./ARCHITECTURE.md#auth) and
[ARCHITECTURE.md#known-security-limitations](./ARCHITECTURE.md#known-security-limitations).

## Configuration

All settings via flags or environment variables (precedence:
flags > env vars > mode defaults). Full list in `gateway_config.go`.

The env vars the code actually reads (`gateway_config.go`):

| Env var | Description |
|---|---|
| `GATEWAY_MODE` | `dev` (local defaults) or `prod` (env-var driven; auth mode `api`) |
| `REDIS_URL` | Redis address (prod), e.g. `plexus-gateway-redis.internal:6379` |
| `PLEXUS_API_URL` | Next.js API URL for auth callbacks (required in prod) |
| `PLEXUS_INTERNAL_SECRET` | Shared secret for internal server-to-server calls (`/internal/command`, metric announcer) |
| `GATEWAY_ALLOWED_ORIGINS` | Comma-separated browser-origin allowlist (required in prod) |
| `REDIS_POOL_SIZE` | Redis connection pool size override |
| `GATEWAY_INSTANCE_ID` / `FLY_MACHINE_ID` | Instance id for the per-instance `dashboard:<instanceID>` consumer group (hostname fallback with a warning) |

Flags (mostly for local runs): `--mode`, `--addr`, `--metrics-addr`,
`--redis`, `--auth` (`dev`|`api`), `--api-url`, `--log-level`,
`--redis-pool-size`, `--org` (dev-mode default org). There are no
`GATEWAY_ADDR` / `GATEWAY_REDIS` / `GATEWAY_AUTH` / `GATEWAY_ORG` env vars —
those settings are flag-only.


## Deploying to Fly.io (Stage 1)

First-deploy runbook for a Stage 1 deployment: one gateway machine + one
self-hosted Redis machine, single region. See `PLAN.md` §6 for the
progression to higher stages.

### Quickest path: use `deploy.sh`

A script wraps every command in this runbook. For the full first-deploy:

```bash
cp .env.deploy.example .env.deploy
# edit .env.deploy — set PLEXUS_API_URL, GATEWAY_ALLOWED_ORIGINS, etc.
./deploy.sh init
```

After that, updates are:

```bash
./deploy.sh deploy    # build + ship gateway
./deploy.sh health    # verify /health
./deploy.sh logs      # tail logs
./deploy.sh rollback  # undo a bad deploy
```

The rest of this document explains what the script does, step by step,
for anyone who wants to understand the moving pieces or do it manually.

### Prerequisites

- A Fly.io account with a payment method on file
- The `flyctl` CLI installed and logged in: `fly auth login`
- `docker` installed locally (for the test build step)
- The Plexus Next.js app deployed and reachable at `https://app.plexus.company`
  with the `/api/auth/verify-key` and `/api/auth/verify-session` endpoints live
- The production domain for the browser dashboard (e.g. `app.plexus.company`)

### Cost (Stage 1)

Machine sizes below are what the checked-in `fly.toml`s actually provision.
The dollar figures are stale — the Redis machine is now a `performance-1x`/4 GB
box (the dominant line item), not the shared-cpu box the old ~$8.50/mo total
assumed. Re-price against current Fly rates before quoting.

| Item                                                       | Cost                    |
| ---------------------------------------------------------- | ----------------------- |
| `plexus-gateway` machine (shared-cpu-1x, 512 MB)           | ~$3/mo                  |
| `plexus-gateway-redis` machine (performance-1x, 4 GB)      | re-price (~$60+/mo)     |
| Redis volume (prod AOF volume grown to 20 GB, `fly volumes list`) | re-price          |
| Dedicated IPv4 on the gateway                              | $2.00/mo                |
| Egress under 160 GB/mo                                     | free                    |
| Fly Metrics + hosted Grafana                               | free                    |

### Before you start

```bash
cd plexus/gateway
```

#### Test the Docker build locally

```bash
docker build -t plexus-gateway .
```

If this fails, fix it here — not during `fly deploy`. Common issues:

- Go version mismatch between `Dockerfile` and `go.mod`
- Missing files due to `.dockerignore` being too aggressive
- Dependency resolution in `go mod download`

Once the build succeeds:

```bash
docker image ls plexus-gateway
```

You should see a ~30-40 MB final image.

---

### Step 1: Deploy the Redis sidecar

The Redis sidecar is its own Fly app, reachable only over Fly's private 6PN
network. It has no public port.

```bash
cd redis
```

Create the app without deploying:

```bash
fly launch --no-deploy --copy-config --name plexus-gateway-redis --region iad
```

Create the persistent volume:

```bash
fly volumes create redis_data --region iad --size 3 -a plexus-gateway-redis
```

Deploy:

```bash
fly deploy -a plexus-gateway-redis
```

Verify Redis is reachable internally:

```bash
fly ssh console -a plexus-gateway-redis
# inside the machine:
redis-cli ping    # → PONG
exit
```

You can also verify from another Fly app in the same org:

```bash
# From any fly ssh console session:
nc -zv plexus-gateway-redis.internal 6379   # → succeeded
```

Return to the gateway directory:

```bash
cd ..
```

---

### Step 2: Create the gateway app

```bash
fly launch --no-deploy --copy-config --name plexus-gateway --region iad
```

Provision a dedicated IPv4 address (optional but recommended for stable DNS):

```bash
fly ips allocate-v4 --shared -a plexus-gateway   # free shared IPv4
# OR
fly ips allocate-v4 -a plexus-gateway             # dedicated, $2/mo
```

IPv6 is free and automatic — nothing to do there.

---

### Step 3: Set secrets

These values come from your Next.js app and DNS config, not from `fly.toml`:

```bash
fly secrets set -a plexus-gateway \
  REDIS_URL=plexus-gateway-redis.internal:6379 \
  PLEXUS_API_URL=https://app.plexus.company \
  GATEWAY_ALLOWED_ORIGINS=app.plexus.company,*.plexus.company
```

Verify:

```bash
fly secrets list -a plexus-gateway
```

(Values are redacted; you can only see the digest.)

---

### Step 4: Deploy the gateway

```bash
fly deploy -a plexus-gateway
```

Watch the build and rollout. On first deploy it will pull the base images,
compile the Go binary, and start one machine.

Once the rollout completes, verify:

```bash
# Should print JSON with status: "ok" and redis: "connected"
curl -s https://plexus-gateway.fly.dev/health | jq
```

Tail the logs:

```bash
fly logs -a plexus-gateway
```

You should see:

```
level=INFO msg="starting gateway" addr=:8080 redis=plexus-gateway-redis.internal:6379 auth=api ...
level=INFO msg="redis connected" addr=plexus-gateway-redis.internal:6379
level=INFO msg="metrics listening" addr=:9090
level=INFO msg=listening addr=:8080
```

---

### Step 5: Point DNS and smoke-test

#### DNS

Point a CNAME from your gateway domain (e.g. `gateway.plexus.company`) to
`plexus-gateway.fly.dev`. Or add A/AAAA records for the dedicated IPs if you
used `fly ips allocate-v4`.

#### Smoke test: device connection

From your laptop (or any machine with a valid API key):

```bash
export PLEXUS_API_KEY=plx_yourkey
export PLEXUS_GATEWAY_URL=https://plexus-gateway.fly.dev
export PLEXUS_GATEWAY_WS_URL=wss://plexus-gateway.fly.dev
plexus start --key $PLEXUS_API_KEY
```

You should see the agent connect, authenticate, and begin streaming. On the
gateway side, `fly logs` should show:

```
level=INFO msg="device registered" org=org_abc source=device-001
```

#### Smoke test: browser connection

Open the production frontend at `https://app.plexus.company`. The browser
should open a WebSocket to the gateway and show live telemetry from the
connected device.

#### Smoke test: metrics

```bash
# Fly Metrics should be scraping plexus-gateway:9090/metrics
# View it in the Fly dashboard: https://fly-metrics.net
```

Pick the `plexus-gateway` app and find charts for the gateway's metrics:
`plexus_gateway_devices_connected`, `plexus_gateway_telemetry_messages_total`,
`plexus_gateway_redis_xadd_duration_seconds`, etc.

---

### Updating an existing deployment

For ongoing deploys, the full runbook is:

```bash
cd plexus/gateway
docker build -t plexus-gateway .   # local build smoke test
fly deploy -a plexus-gateway
```

Fly does a rolling deploy by default. The machine restarts, WebSocket
connections reconnect automatically (the agent has exponential backoff, the
frontend hook has a circuit breaker with reconnect).

For config-only changes (flags, env vars, secrets), no code rebuild is needed:

```bash
fly secrets set -a plexus-gateway SOME_VAR=newvalue
```

Fly will restart the machine to pick up the new secret.

---

### Troubleshooting

#### `curl /health` returns 503 with `redis: "degraded (circuit open)"`

The gateway can't reach Redis. Check:

```bash
fly status -a plexus-gateway-redis     # is the redis app running?
fly logs -a plexus-gateway-redis       # are there errors?
fly ssh console -a plexus-gateway
nc -zv plexus-gateway-redis.internal 6379   # can the gateway reach redis?
```

Common causes:

- The Redis app crashed or ran out of memory (check logs)
- The Redis volume filled up (check `df -h` inside the Redis machine)
- The two apps are in different regions (verify with `fly status`)
- Private 6PN networking not set up (this is automatic on Fly, but
  occasionally needs `fly wireguard create` for diagnostics)

#### Device can't connect with "Invalid API key"

- Check that `PLEXUS_API_URL` is correct and reachable from Fly
- Check that the API key exists in Postgres and has `write` scope
- Check that `/api/auth/verify-key` returns 200 for the key
- Check that the Next.js app is deployed and healthy

#### Browser can't connect with "Invalid session"

- Same as above but for `/api/auth/verify-session`
- Check that the browser minted a fresh ws-token (`POST /api/auth/ws-token`,
  HS256/`AUTH_SECRET`, 5-min TTL) and sent it as the `browser_auth` frame
- Check that `GATEWAY_ALLOWED_ORIGINS` includes the dashboard's origin

#### Build fails with "Go version mismatch"

The `Dockerfile` uses `golang:1.26-alpine`. If `go.mod` requires a newer Go
version, bump the Dockerfile to match.

#### Deploy works but metrics don't show up in Fly

Fly Metrics scrapes via the `[[metrics]]` block in `fly.toml`:

```toml
[[metrics]]
  port = 9090
  path = "/metrics"
```

If metrics are missing:

- Verify the metrics server started: `fly logs | grep "metrics listening"`
- Verify port 9090 is exposed in the `Dockerfile`
- Wait a few minutes — first scrape can be delayed after deploy

---

### Rollback

If a deploy goes wrong and the new machine is unhealthy:

```bash
fly releases -a plexus-gateway         # list past releases
fly releases rollback <release-number> -a plexus-gateway
```

Fly keeps the last ~10 releases. Rollback is a single command and takes
seconds.

---

### Monitoring

- **Logs**: `fly logs -a plexus-gateway`
- **Metrics**: https://fly-metrics.net → `plexus-gateway` app
- **Health**: `curl https://plexus-gateway.fly.dev/health | jq`
- **Machine state**: `fly status -a plexus-gateway`

## See also

- [ARCHITECTURE.md](./ARCHITECTURE.md) — current-state reference: protocols, auth, security model, per-fanout details, the frontend WS contract, code map.
- [PLAN.md](./PLAN.md) — forward design: topology/CLUSTER_MODE seam, hosting models, scaling ladder, app portability seam, deferred levers.

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
