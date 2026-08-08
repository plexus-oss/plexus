# Plexus Data API

![License: Elastic 2.0](https://img.shields.io/badge/license-Elastic%202.0-blue)

FastAPI read API for telemetry, logs, fleet health, commands, and live WS streams.
Deployed as Fly app `plexus-data-api` → `api.plexus.company`.

## Run locally

    uv sync
    cp .env.example .env.local   # fill in DATABASE_URL, ClickHouse, Redis, gateway
    uv run uvicorn app.main:app --reload

## Regenerate the OpenAPI spec

    uv run python scripts/dump_openapi.py   # rewrites openapi.json — commit it

## Deploy

    fly deploy   # uses Dockerfile + fly.toml

Smoke test against prod: `PLEXUS_API_KEY=plx_... uv run python scripts/test_api.py`

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
