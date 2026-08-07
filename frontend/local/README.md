# Local dev — one-click Plexus suite

Runs the full Plexus stack on your machine: the **frontend natively** (`npm run dev`, hot reload) and **everything else in Docker**, built from the sibling service repos. One command.

```bash
cd frontend/local
make dev
```

That generates config → builds + starts the Docker backend → starts Postgres + runs migrations → launches the frontend. Dashboard: <http://localhost:3000> (Ctrl-C stops the frontend only; the backend keeps running).

**Requires:** Docker, and the sibling repos checked out next to `frontend/` at the workspace root — `gateway`, `houston` (alert-service), `api` (data-api), `clickhouse`. `make dev` fails early listing any that are missing. The `recorder` service additionally needs `plexus-private/video-recorder` cloned to `../../video-recorder` and is behind its own compose profile (`--profile recorder`).

## Commands

| Command | What it does |
|---|---|
| `make dev` | Full suite: backend + Postgres/migrations + frontend (foreground) |
| `EXTRAS=1 make dev` | Also start the ancillary `data-api` |
| `make backend` | Build + start the Docker backend only (detached) |
| `make db` | Start the frontend's Postgres + apply migrations |
| `make status` | Show what's running |
| `make logs` | Tail backend logs |
| `make down` | Stop everything (backend + Postgres), **keep data** — fast restart |
| `make clean` | Stop everything **and wipe all volumes** (full reset) |
| `make nuke` | `clean` + remove the built `plexus-dev/*` images (cold state) |

## What runs where

Frontend runs on the host; the backend runs in Docker and is reached over published `localhost` ports. Backend containers reach the host frontend via `host.docker.internal:3000`.

| Service | Where | Port |
|---|---|---|
| frontend | host (`npm run dev`) | 3000 |
| Postgres (pgvector) | Docker (frontend's own compose) | 5432 |
| gateway | Docker | 8080 |
| alert-service | Docker | 8081 |
| ch-loader | Docker | 8082 |
| ClickHouse | Docker | 8123 |
| MinIO | Docker | 9000 / 9001 |
| data-api *(extras)* | Docker | 8000 |
| recorder *(profile `recorder`)* | Docker | — |

`data-api` is **off by default** (compose `extras` profile) — turn it on with `EXTRAS=1`. `recorder` sits behind its own `recorder` profile and needs the `video-recorder` repo cloned to the workspace root first.

## Smoke test (headless)

The frontend accepts the dev key `plx_dev_internal_telemetry_key` under `NODE_ENV=development`, so you can stream without minting one:

```bash
curl -X POST http://localhost:8080/ingest \
  -H "x-api-key: plx_dev_internal_telemetry_key" -H "Content-Type: application/json" \
  -d '{"source_id":"smoke","points":[{"class":"metric","metric":"volts","value":12.4,"timestamp":'$(date +%s000)'}]}'
```

## Gotchas

- **New sources don't persist immediately.** ch-loader has an opt-in `RecordingStore` filter — a brand-new `source_id` is consumed but *dropped* until the loader enables it (~15s after first sighting), then everything persists. Send a warm-up point, wait, then stream for real. Not a bug.
- **Config is generated, not hand-edited.** `dev-setup.sh` writes `local/.env` (backend secrets, created once) and `frontend/.env.development.local` (points the frontend at the local Docker backend). The latter overrides your `.env.local` — **delete it to revert** to whatever `.env.local` targets.
- **Build-from-source.** Images are built from `../../<repo>`, so you need the sibling repos cloned. First build compiles 4 images (5 with the `recorder` profile; ~a few minutes); after that they're cached.
- **ClickHouse is the heavy one.** On a first boot it applies the full schema (~30–60s) before healthy. If you're tight on resources, `make down` frees RAM, `make clean` frees disk.
- **Full teardown when done** — this is a heavy stack for a laptop. `make down` to pause, `make clean` to reset, `make nuke` for a cold state.
