# plexus-alert-service

![License: Elastic 2.0](https://img.shields.io/badge/license-Elastic%202.0-blue)

Standalone Go service that turns the plexus gateway's telemetry stream into
alert lifecycle events. One of three independent consumers of
`telemetry.stream:{org}` on Redis, alongside the gateway's in-process
per-instance `dashboard:<instanceID>` consumer and the Python ch-loader.

```
Devices → Gateway → Redis Stream → alert-service (XREADGROUP "alerts")
                                         │
                                         └─▶ POST /api/internal/alerts/transitions  → Next.js
```

> A second sink (batched INSERT into ClickHouse `plexus.alert_events`,
> `clickhouse.go`/CHWriter) was **removed in commit 3bf7eb4 and never
> rebuilt**. The dead `ALERTD_CH_ENABLED` key has since been removed from
> `fly.toml` as well.

The gateway does zero rule evaluation. All alerting logic lives in this
service — it reads Redis directly with its own consumer group, maintains
its own rule store, runs the state machine, and pushes transitions out.

## What it does

- **Consumes** metric points from Redis Streams (per-org consumer goroutines
  started on-demand for any org with at least one rule).
- **Maintains** a per-`(source, metric)` running distribution using
  exponentially weighted Welford's algorithm, used for outlier detection
  and embedded on the wire as context for each alert.
- **Evaluates** three rule types: `threshold` (min/max), `outlier`
  (z-score), `compound` (AND/OR over sub-rules on the same device).
- **Drives** a per-`(rule, source)` state machine with close-side
  hysteresis and cooldown to prevent flap.
- **Delivers** state transitions to Next.js (which persists to Supabase and
  fires webhooks/notifications). (The ClickHouse analytics sink was removed
  — see note above.)

## Quick start — local dev

```bash
cp .env.example .env
# edit .env — set PLEXUS_API_URL if you want to exercise the bootstrap path
go run .
```

The service listens on `:8081` (HTTP) and `:9091` (Prometheus metrics). In
dev mode, rules bootstrap is best-effort: if Next.js is unreachable the
service starts with an empty rule set rather than crashing. In prod mode
(`ALERTD_MODE=prod`), bootstrap is required — it retries for 90 s, falls
back to the on-disk cache, and exits non-zero if neither yields rules.

Run the test suite:

```bash
go test ./...
```

## Documentation

Start with these, in order, depending on why you're here:

- **[CONTRACT.md](./CONTRACT.md)** — Wire contract with Next.js. Read this
  if you're implementing the Next.js side, adding a rule field, or
  debugging a 4xx/5xx between the services. **Authoritative** for the
  boundary.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Internals: consumer lifecycle,
  state machine, bootstrap fallback, sinks, `/readyz` semantics. Read this
  before changing the service.
- **[DEPLOY.md](./DEPLOY.md)** — Fly config, secrets, volumes, rollback.
  Read this before operating the service in prod.

For the system-wide picture (gateway, three data paths, the full plexus
telemetry architecture), see `plexus/gateway/ARCHITECTURE.md` — this doc
does not duplicate it.

## Environment variables

See `.env.example` for a starting set with defaults. It is not exhaustive —
some prod-only inputs (`REDIS_POOL_SIZE`, the `PLEXUS_SELF_*` dogfood
trio, `ALERTD_METRICS_ADDR`, `ALERTD_NOTIFY_INTERVAL`) are read by
`config.go` but not all listed there; `config.go` is the source of truth.

| Var | Required | Notes |
|---|---|---|
| `ALERTD_MODE` | no | `dev` (default) or `prod`. Prod requires every field marked ★ below. |
| `ALERTD_ADDR` | no | HTTP listen address. Default `:8081`. Read from env in prod mode (`prodDefaults` in `config.go`); flag override still wins. |
| `REDIS_URL` ★ | prod | `host:port`, no auth — assumes private-network Redis per the gateway trust model. |
| `PLEXUS_API_URL` ★ | prod | Next.js base URL, no trailing slash. |
| `PLEXUS_INTERNAL_SECRET` ★ | prod | Shared secret matching Next.js side. |
| `PLEXUS_CLICKHOUSE_DSN` | — | **Removed** with the ClickHouse sink (commit 3bf7eb4). Not read by any code. |
| `ALERTD_CH_ENABLED` | — | **Removed** with the ClickHouse sink. Not read by any code; no longer set in `fly.toml` either. |
| `ALERTD_CONSUMER_GROUP` | no | Redis consumer group name. Default `alerts`. |
| `ALERTD_CONSUMER_NAME` | no | Consumer instance name within the group. **Must be unique per machine** when running >1 instance. |
| `ALERTD_DISTRIBUTION_ALPHA` | no | Welford decay factor `(0,1)`. Default `0.01` (~500 points to fade a sample). |
| `ALERTD_RULES_CACHE_PATH` | no | Path for on-disk rule snapshot fallback. Mount this onto a persistent volume in prod. |
| `LOG_LEVEL` | no | `debug`/`info`/`warn`/`error`. Default `info`. |

## Health

- `GET /livez` — cheap liveness. Process is up, HTTP server serves. Used by
  Fly for restart decisions.
- `GET /readyz` — deep readiness. Aggregates Redis reachability, rules
  snapshot age, notifier sink health, bootstrap
  state, and queue depths. Returns 503 with a reason field if any check
  fails. Point external uptime monitoring at this, not `/livez`.
- `GET /health` — backward-compatible alias of `/readyz` for older probes.
- `GET /stats?rule={id}&source={slug}` — live stats for an in-flight
  (open/recovering) alert; `x-internal-secret` auth; 404 when nothing is in
  flight. See CONTRACT.md §4.
- `GET /metrics` on `:9091` — Prometheus. Evaluations, alerts fired/closed,
  notification batches sent/failed, rules active, alerts open, active
  consumers.

## Where things live

| File | Role |
|---|---|
| `main.go` | Entry point, HTTP routes, graceful shutdown |
| `config.go` | Config struct, dev/prod defaults, env + flag overrides |
| `redis.go` | Redis client wrapper + circuit breaker + health probe |
| `stream.go` | `ConsumerManager` + `OrgConsumer` — XREADGROUP + XAutoClaim |
| `rules.go` | `RuleStore` + bootstrap (GET) + push (POST) |
| `distribution.go` | Exponentially weighted Welford's algorithm |
| `engine.go` | Stateless rule evaluation (threshold, outlier, compound) |
| `state.go` | Per-(rule, source) state machine with hysteresis + cooldown |
| `notifier.go` | Batched POST to Next.js — implements `TransitionSink` |
| `metrics.go` | Prometheus counters |

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
