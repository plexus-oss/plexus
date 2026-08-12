# Plexus — Architecture

How the services in this monorepo fit together. Each service also carries its
own deeper docs (`gateway/ARCHITECTURE.md`, `houston/ARCHITECTURE.md`,
`houston/CONTRACT.md`, per-service `README.md` / `AGENTS.md`) — this file is
the map, they are the territory. If this file contradicts code, the code wins.

## The services

| Dir | What it is | Stack | Runtime deps |
| --- | --- | --- | --- |
| `frontend/` | Product app + control plane: dashboards, sources, monitors, alerts UI, auth, API keys, billing, licensing | Next.js (App Router) | Postgres (pgvector), ClickHouse (reads), Redis |
| `gateway/` | Telemetry ingest (`POST /ingest`) + live WebSocket fan-out + device command relay | Go | Redis (streams) |
| `clickhouse/` | ClickHouse server packaging (`server/`) + the stream→table loader (`loader/`) | CH + Python | Redis, ClickHouse, MinIO/S3 |
| `api/` | Public/SDK read API (`/v1/...`) + the MCP server (`/mcp`) | FastAPI (Python) | Postgres, ClickHouse, Redis |
| `houston/` | Alert engine for device thresholds/outliers, evaluated off the live stream | Go | Redis, ClickHouse |
| `selfhost/` | The whole stack as one docker-compose bundle + installer | compose | consumes the ghcr images |

## Data flow

```
SDK / device / agent
        │  POST /ingest  (x-api-key: plx_…)
        ▼
    gateway ──── XADD v:2 envelope ────►  Redis stream  telemetry.stream:<org>
        │                                   │            │            │
        │ consumer group:                   │ ch-loader  │ alerts     │ dashboard:<instance>
        │ live WS fan-out ◄─────────────────┘            │            │
        ▼                                                ▼            ▼
    browsers / share links                            houston      gateway live views
                                                         │
                              ClickHouse  ◄── loader batches (raw + 1min/1hr rollup MVs)
                                   ▲
                     frontend + api read paths (raw vs rollup chosen by time range)
```

- **One stream, three consumer groups** per org: `dashboard:<instanceID>`
  (gateway live fan-out), `ch-loader` (persistence), `alerts` (houston).
- **Reads** go to ClickHouse from both the frontend and the api; the rollup
  schema (`telemetry_1min` / `telemetry_1hr`) is the contract between writers
  and readers.
- **Commands** flow the other way: frontend/api → gateway `/internal/command`
  → device WS, allowlisted command types only.

## Cross-service contracts (the do-not-break list)

These boundaries are enforced by convention, not by shared code — change both
sides in the same commit:

- **Auth callbacks**: gateway verifies keys/sessions/share tokens by calling
  frontend `/api/auth/verify-key`, `/verify-session`, `/verify-share`
  (`gateway/auth.go` ↔ `frontend/app/api/auth/*`).
- **Server-to-server mesh**: `x-internal-secret` header
  (`PLEXUS_INTERNAL_SECRET`) guards frontend `/api/internal/*`, gateway
  `/internal/command`, loader `/recording`, houston `/internal/rules/*`.
- **The `v:2` envelope**: written by `gateway/redis.go`, parsed independently
  by `houston/redis.go` and `clickhouse/loader/loader.py` — three
  implementations of one format.
- **Alert rules push**: frontend → houston, spec in `houston/CONTRACT.md`,
  frontend side in `frontend/lib/alerts/push-rules-to-alert-service.ts`.
- **Panel types**: `frontend/lib/panels/registry.ts` is the source of truth;
  `api/app/mcp/tools/dashboards.py` carries a hand-synced copy.
- **API surface**: `api/openapi.json` is generated
  (`api/scripts/dump_openapi.py`) — regenerate, never hand-edit. `/mcp` is
  deliberately absent from it.

## Deployment shapes

- **Plexus Cloud**: each service deploys independently to Fly from its own
  directory (`docs/shipping.md`). The frontend auto-deploys on green `main`
  CI; everything else is `fly deploy` by hand.
- **Self-host**: version tags (`v*`) trigger `release-images`, which publishes
  all five images to ghcr and a signed air-gapped bundle;
  `selfhost/docker-compose.yml` runs the identical stack (plus Postgres,
  Redis/valkey, ClickHouse + keeper, MinIO) with `BILLING_ENABLED=false`.
- **Local dev**: `frontend/local/` (`make dev`) — frontend on the host with
  HMR, everything else in Docker built from this repo's service dirs.

## Hostnames (Cloud)

See `GLOSSARY.md` for the full table and terms.
