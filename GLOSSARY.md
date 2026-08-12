# Plexus — Glossary & Hostnames

Canonical names and terms, referenced by the per-service `AGENTS.md` files.
If a term here contradicts code, the code wins — then fix this file.

## Hostnames

| Host | What | Backed by |
| --- | --- | --- |
| `plexus.company` | Marketing site | (separate repo) |
| `app.plexus.company` | Product app + control plane | Fly `plexus-frontend`, `frontend/` |
| `gateway.plexus.company` | Telemetry ingest + live WS | Fly `plexus-gateway`, `gateway/` |
| `api.plexus.company` | Public/SDK read API + MCP | Fly `plexus-data-api`, `api/` |
| `docs.plexus.company` | Docs site | (separate repo) |

Internal (Fly private network): `plexus-gateway.internal:8080`,
`plexus-gateway-redis.internal:6379`, `plexus-ch.internal:8123`,
`plexus-ch-loader.internal:8080`, `plexus-alert-service.internal:8081`.

## Terms

- **source** — the canonical noun for anything that emits telemetry (device,
  connection, recording, import — `sources.source_type`). Public API path
  noun: `/v1/sources/{source_id}` (`/v1/devices/*` is a deprecated redirect
  alias). ⚠️ `source_id` is a **slug** in some tables (notably `alert_rules`)
  and a **UUID** elsewhere — bridge via `resolveRef`.
- **connection** — a source backed by an existing datastore the user already
  runs (MySQL/Influx/SSH…); Plexus queries it in place, no migration.
- **device** — legacy noun for an SDK/firmware-backed source; retired as a
  backend primitive, survives in the deprecated API alias.
- **point** — one telemetry sample `{class?, metric, value, timestamp(ms), tags}`.
- **ingest** — `POST gateway /ingest`, header `x-api-key: plx_…`, gzip ok, ≤5 MiB.
- **v:2 envelope** — zstd-compressed JSON batch the gateway XADDs to Redis
  `telemetry.stream:<org_id>`.
- **consumer groups** on `telemetry.stream:<org>` — `dashboard:<instanceID>`
  (gateway live fan-out, per-instance broadcast), `ch-loader` (persistence),
  `alerts` (houston).
- **rollups** — ClickHouse `telemetry_1min` / `telemetry_1hr` aggregating MVs;
  both read paths (frontend + api) select raw vs rollup by time range; the
  rollup schema is the contract.
- **plx_ key** — API key (`plx_` + 32 chars), SHA-256 `key_hash` stored in
  Postgres `api_keys`; minted by frontend `/api/api-keys`; verified by the
  gateway via frontend `/api/auth/verify-key` and by the api via direct SQL.
  Also minted as OAuth access tokens at the MCP token exchange.
- **ws-token** — short-lived HS256 token (frontend `/api/auth/ws-token`) for
  browser WS auth against the gateway; alternatives: `share_auth` (shared
  dashboards), `data_api_auth` (api live-proxy).
- **x-internal-secret** — shared-secret header for the server-to-server mesh
  (`PLEXUS_INTERNAL_SECRET`): frontend `/api/internal/*`, gateway
  `/internal/command`, loader `/recording`, houston `/internal/rules/*`.
- **monitor** — user-facing alert config; stored across `alert_rules`
  (+ `source_limits` double-write for thresholds) and `event_monitors`.
  There is no `monitors` table.
- **alert engines (×3)** — houston (device thresholds/outliers off the Redis
  stream), the frontend poll-loop (connection + event monitors, 30s, DB
  watermarks), and the frontend offline-loop (stream-stopped, 30s).
- **transition** — houston→frontend alert state change
  (FSM IDLE→OPEN→CLOSING→CLOSED→COOLDOWN).
- **verdict** — a human judgement (real / noise) recorded on an alert; feeds
  the per-rule "noise N of M times here" statistics.
- **Terminal** — the ⌘K action copilot at `/terminal` (tool-use loop over the
  same APIs).
- **MCP server** — `POST /mcp` on the api service (Streamable HTTP, Bearer
  `plx_` or OAuth 2.1); deliberately absent from `openapi.json`.
- **entitlements** — offline-verified Ed25519 license keys
  (`PLXL1.<payload>.<sig>`, `frontend/lib/licensing/`); absent key = free
  tier, silently. Self-host additionally sets `BILLING_ENABLED=false`.
