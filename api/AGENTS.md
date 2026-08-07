# AGENTS.md — api

**Public/SDK read API** (FastAPI) → `api.plexus.company` (Fly app `plexus-data-api`).
Query telemetry/logs/fleet, send commands, proxy live WS. Reads ClickHouse as
`telemetry_writer`; auth `x-api-key` → Supabase `api_keys`. The product UI does **not**
use this — it queries ClickHouse directly. Routes: `app/api/v1/*.py`.

**This repo IS the API source of truth.** Never hand-write endpoint docs elsewhere.
`api/openapi.json` is the generated spec — regenerate it after any route/schema change
with `uv run python scripts/dump_openapi.py` and commit it alongside the code change
(the deprecated `/v1/devices` alias is deliberately excluded from the spec).
Routing is settled: `/v1/sources/*` is canonical (`app/api/v1/sources.py`);
`/v1/devices/{path}` is a deprecated catch-all alias that **308**-redirects to
`/v1/sources/...` (`app/main.py` — 308 preserves method and body across the redirect,
unlike a 301). WebSocket streams have **no** `/v1/devices` alias — use `/v1/sources/...`
directly. Matches `../GLOSSARY.md`.

Known debt: the WS auth + gateway-proxy blocks are triplicated across
`metrics.py` / `logs.py` / `video.py` — left as-is (no test coverage); consolidate
only with tests in hand.

Workspace map: `../ARCHITECTURE.md`. Run/deploy: `README.md` / `pyproject.toml`.
