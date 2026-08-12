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

**MCP server**: `POST /mcp` is a stateless Streamable HTTP MCP endpoint
(`app/mcp/`, official `mcp` SDK, `json_response=True` — required, the Dockerfile runs
2 uvicorn workers). Auth is `Authorization: Bearer plx_...` validated by
`app/mcp/auth.py` (mirrors `require_auth`: 401/402/dev_mode); the raw key is kept in a
contextvar because the dashboard tools proxy the frontend's `/api/dashboards*` routes
and `send_telemetry` relays to the gateway's `/ingest`, both as the caller. Served at
exactly `/mcp` via `app/mcp/mount.py` (a Starlette Mount would 307 to `/mcp/`); the MCP
session manager runs inside the app lifespan. **Deliberately absent from
`openapi.json`** (mounts are schema-invisible — regenerate and expect zero diff).
Tool modules: `app/mcp/tools/*.py`; the panel-type allowlist in `tools/dashboards.py`
must stay in sync with `frontend/lib/panels/registry.ts`. Tests: `tests/`
(`uv run --extra dev pytest`).

Known debt: the WS auth + gateway-proxy blocks are triplicated across
`metrics.py` / `logs.py` / `video.py` — left as-is (no test coverage); consolidate
only with tests in hand.

Workspace map: `../ARCHITECTURE.md`. Run/deploy: `README.md` / `pyproject.toml`.
