# Plexus self-host bundle

The entire Plexus platform on your own hardware with one command:

```
curl -fsSL https://raw.githubusercontent.com/plexus-oss/plexus/main/selfhost/install.sh | bash
```

The installer asks four questions (install dir, hostname, optional Anthropic
key for the Terminal copilot, optional Resend key for sign-in emails),
generates every secret locally, clones this repo, and starts the stack —
preferring prebuilt `ghcr.io/plexus-oss/plexus/*` images (pinned via
`PLEXUS_VERSION`), building from source only when images aren't available.
Nothing phones home — including license validation, which is fully offline
by design. `./selfhost/install.sh upgrade` pulls the next version;
`./selfhost/install.sh doctor` shows stack health.

## What you get

| Service | Container | Port |
| --- | --- | --- |
| App (dashboards, alerts, settings) | `frontend` | 3000 |
| Telemetry ingest (WS/HTTP) | `gateway` | 8080 |
| Read API | `api` | 8000 |
| Alert engine | `houston` | — |
| ClickHouse (+ Keeper, hot/cold tiers) | `clickhouse`, `ch-keeper` | — |
| Stream → ClickHouse loader | `ch-loader` | — |
| Valkey (streams) | `valkey` | — |
| Postgres (control plane) | `postgres` | — |
| MinIO (cold tier + uploads) | `minio` | — |

Free for a single team with no caps: ingest, storage, dashboards,
instruments, alerts, Grafana migration. Enterprise features (SSO, RBAC,
audit logs, multi-tenancy, air-gapped releases) unlock with a license key —
set `PLEXUS_LICENSE` in `.env`. Details: `../docs/licensing.md`.

## Notes

- **Sign-in without Resend:** with no `RESEND_API_KEY`, the 6-digit sign-in
  code is printed to `docker compose logs frontend`. Fine for a first run;
  set a key for real email delivery.
- **Terminal AI copilot:** bring your own `ANTHROPIC_API_KEY` (you pay
  Anthropic directly); without it the Terminal stays hidden and everything
  else works.
- **Secrets** live only in `gateway/selfhost/.env` (mode 600). Delete it and
  re-run the installer to regenerate — note this invalidates the ClickHouse
  passwords baked into existing volumes.
- **Boot order:** houston and ch-loader restart until the frontend answers on
  first boot — that's normal for the first minute.
- **Air-gapped installs:** clone the repos and copy them + base images across
  the boundary; the stack makes no outbound calls except the optional
  Anthropic/Resend integrations you configure.
