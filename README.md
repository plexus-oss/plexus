# Plexus

![License: Elastic 2.0](https://img.shields.io/badge/license-Elastic%202.0-blue)

Operations frontend for hardware fleets — connect any device or existing
telemetry store, get dashboards, instruments, and alerts that engineers
actually want to look at.

This is the platform monorepo. Every service that makes up Plexus lives here
and is versioned as one unit:

| Dir | Service | Runs as |
| --- | --- | --- |
| `gateway/` | WebSocket/HTTP telemetry ingest | Go binary, port 8080 |
| `clickhouse/` | Storage: ClickHouse packaging + stream loader | ClickHouse + Python loader |
| `frontend/` | The app — dashboards, alerts, settings | Next.js, port 3000 |
| `api/` | Read API for `plx_` keys | FastAPI, port 8000 |
| `houston/` | Alert engine | Go binary |
| `selfhost/` | One-command self-host bundle | docker compose |

The device SDKs are separate repos under Apache-2.0 (code that ships inside
your hardware should have no strings):
[plexus-python](https://github.com/plexus-oss/plexus-python) ·
[plexus-typescript](https://github.com/plexus-oss/plexus-typescript)

## Self-host

```
curl -fsSL https://raw.githubusercontent.com/plexus-oss/plexus/main/selfhost/install.sh | bash
```

Four questions, every secret generated locally, the whole platform up on your
own hardware. No accounts, no caps, no phone-home — license validation
included is fully offline. See [selfhost/README.md](selfhost/README.md).

## License

Source-available under the [Elastic License 2.0](LICENSE) — all code, free
and enterprise features alike, lives in this repo. Enterprise features are
unlocked by an offline license key; a single team never hits a paywall.

| | Free | Enterprise |
|---|---|---|
| Ingest, storage, dashboards, instruments, alerts | ✓ | ✓ |
| Single-team auth | ✓ | ✓ |
| Grafana migration tooling | ✓ | ✓ |
| Self-hosting (no caps, no phone-home) | ✓ | ✓ |
| SSO / SAML / SCIM | | key |
| RBAC + fine-grained permissions | | key |
| Audit logs | | key |
| Multi-tenancy | | key |
| Air-gapped release channel + CVE SLA | | key |
| Support entitlements | | key |

Plain-language details: [docs/licensing.md](docs/licensing.md). Contributions
require a DCO sign-off: [CONTRIBUTING.md](CONTRIBUTING.md).
