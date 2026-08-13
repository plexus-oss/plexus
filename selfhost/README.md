# Plexus self-host bundle

The entire Plexus platform on your own hardware with one command:

```
curl -fsSL https://plexus.company/install.sh | bash
```

The installer asks five questions (install dir, hostname, optional Anthropic
key for the Terminal copilot, optional Resend key for sign-in emails, and
whether to enable S3 tiered storage — default no, which skips MinIO and keeps
everything on local disk), generates every secret locally, clones this repo,
and starts the stack —
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
| ClickHouse (+ Keeper) | `clickhouse`, `ch-keeper` | — |
| Stream → ClickHouse loader | `ch-loader` | — |
| Valkey (streams) | `valkey` | — |
| Postgres (control plane) | `postgres` | — |
| MinIO (cold tier + uploads; only with S3 tiering) | `minio` | — |

Free for a single team with no caps: ingest, storage, dashboards,
instruments, alerts, Grafana migration. Enterprise features (SSO, RBAC,
audit logs, multi-tenancy, air-gapped releases) unlock with a license key —
set `PLEXUS_LICENSE` in `.env`. Details: `../docs/licensing.md`.

## Notes

- **Retention: your data is kept forever.** The cloud schema's TTL DELETE
  clauses (which manage shared-storage cost) are stripped at first boot —
  self-hosted telemetry, rollups, and events never expire. Bound disk
  yourself if you want to: `ALTER TABLE plexus.<table> MODIFY TTL
  timestamp + INTERVAL 2 YEAR DELETE`. Like the storage policy, this is
  baked in at first boot; installs created before this change keep their
  old TTLs unless you `MODIFY TTL` them away (`ALTER TABLE plexus.<table>
  REMOVE TTL` per table, or recreate the `ch_data` volume).
- **S3 tiered storage (off by default):** answering "n" runs everything on
  local disk — no MinIO container and `storage_policy = 'default'`.
  Answering "y" adds MinIO and the hot→cold rollover (7-day hot tier
  moving to S3), plus S3-backed icon/context uploads. The choice is
  written to `.env` as `PLEXUS_S3_TIERING`; a `.env` from before this
  option (no var at all) keeps running MinIO as it always did. The
  ClickHouse storage policy is baked into the tables at first boot, so
  flipping the var later only affects a fresh `ch_data` volume.
- **Local-model labeling (Ollama):** set `OLLAMA_URL=http://host.docker.internal:11434`
  (and optionally `OLLAMA_MODEL`, default `llama3.2` — `llama3.1:8b` recommended) in
  `.env` to enable the Label action on chart panels against a model on your own
  machine. With `OLLAMA_URL` set, labeling never contacts any cloud API — a local
  model failure is an error, not a fallback. Without it, labeling uses the
  `ANTHROPIC_API_KEY` if configured, or the button stays hidden.
- **Sign-in without Resend:** with no `RESEND_API_KEY`, the 6-digit sign-in
  code is printed to `docker compose logs frontend`. Fine for a first run;
  set a key for real email delivery.
- **Terminal AI copilot:** bring your own `ANTHROPIC_API_KEY` (you pay
  Anthropic directly); without it the Terminal stays hidden and everything
  else works.
- **Secrets** live only in `selfhost/.env` (mode 600). Delete it and
  re-run the installer to regenerate — note this invalidates the ClickHouse
  passwords baked into existing volumes.
- **Boot order:** houston and ch-loader restart until the frontend answers on
  first boot — that's normal for the first minute.
- **Air-gapped installs:** every `v*` GitHub release attaches
  `plexus-airgap-<tag>.tar.zst` — a self-contained bundle with all container
  images (`docker load`-able), the tagged source, and an `AIRGAP.md` with the
  offline install steps. The stack makes no outbound calls except the
  optional Anthropic/Resend integrations you configure.
