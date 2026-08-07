# Deploy

Operational guide for plexus-alert-service on Fly. Read this before running
the service in any shared environment. For architecture see
[ARCHITECTURE.md](./ARCHITECTURE.md); for the wire contract see
[CONTRACT.md](./CONTRACT.md).

## Prerequisites

Before the first deploy can succeed, every item in this list must be true.
They're not checked automatically — the service will come up and then
fail (either at bootstrap, at first evaluation, or on the first transition
flush) depending on which one is missing.

- [ ] ~~ClickHouse schema applied~~ — **no longer needed.** The ClickHouse
      sink (`clickhouse.go`, `plexus.alert_events`) was removed in commit
      3bf7eb4 and never rebuilt; the service does not touch ClickHouse.
- [ ] **Supabase schema applied.** The `alert_rules` table exists with the
      shape documented in CONTRACT.md §"Supabase schema (authoritative)".
      Frontend migration must be merged and run.
- [ ] **Next.js endpoints deployed**: `GET /api/internal/alerts/rules/all`
      and `POST /api/internal/alerts/transitions`. Both gated on
      `x-internal-secret`.
- [ ] **Next.js rule-push helper wired.** Every route that mutates alert
      rules calls `pushRulesToAlertService(orgId)` after the Supabase
      write commits. See CONTRACT.md §2 for the helper template.
- [ ] **Shared secret set** in both services' environments, and it's the
      same value.
- [ ] **Fly volume created** for the on-disk rule cache (see below).
- [ ] **Redis reachable** from the alert-service machine on Fly's private
      `.internal` network.

## Fly app setup

### One-time

```bash
# From plexus/alert-service — app name is in fly.toml
flyctl apps create plexus-alert-service

# Persistent volume for the rules cache. 1 GB is enormous overkill but
# Fly's smallest option; the cache is ~4 MB even at thousands of rules.
flyctl volumes create alert_cache --region iad --size 1
```

### Secrets

Secrets are NOT in `fly.toml` on purpose — they live in `.env.deploy`
(which is gitignored) and get applied via the helper script:

```bash
cp .env.deploy.example .env.deploy
# edit .env.deploy with the real values
./deploy.sh secrets
```

See `.env.deploy.example` for the full list and documentation of each
variable. `REDIS_URL`, `PLEXUS_API_URL`, and `PLEXUS_INTERNAL_SECRET`
are required for `ALERTD_MODE=prod` — startup fails fast in `Validate()`
if any are missing. (`PLEXUS_CLICKHOUSE_DSN` was removed with the
ClickHouse sink in 3bf7eb4 and is no longer read; the dead
`ALERTD_CH_ENABLED` key has been removed from `fly.toml` as well.)

Verify they landed: `flyctl secrets list -a plexus-alert-service`. Values
are write-only; you can see names and digests but not values.

### fly.toml — what's configured and why

The committed `fly.toml` already has everything needed for a prod deploy.
Worth knowing about the non-obvious pieces:

- **`[[mounts]]` on `/var/cache/alert-service`** backs the on-disk rules
  cache. `ALERTD_RULES_CACHE_PATH` in `[env]` points the RuleStore at a
  file inside the mount, so the fail-safe bootstrap fallback survives
  machine replaces. The volume must exist before the first deploy —
  `./deploy.sh init` creates it, or manually: `fly volumes create
  alert_cache --region iad --size 1 -a plexus-alert-service`.

- **Consumer name is NOT set in `fly.toml`.** Fly doesn't interpolate
  `${...}` expressions in `[env]` values — they're literal strings. So
  a naive `ALERTD_CONSUMER_NAME = 'alerts-${FLY_MACHINE_ID}'` would set
  the consumer name to the literal string `"alerts-${FLY_MACHINE_ID}"`,
  and all machines would collide on the same Redis consumer name. To
  avoid this, `config.go:prodDefaults` auto-templates the name from
  `FLY_MACHINE_ID` at startup when `ALERTD_CONSUMER_NAME` is unset, so
  every Fly machine gets a unique name (`alerts-<machineid>`) without
  needing `fly.toml` to know anything. Override by setting
  `ALERTD_CONSUMER_NAME` explicitly if you need a specific value.

- **`ALERTD_ADDR` / `ALERTD_METRICS_ADDR`** are both read from env in
  `prodDefaults()` — setting them in `fly.toml` takes effect. Flags
  still override env at `LoadConfig` time.

## Deploy

For a first-time setup (creates the app, creates the volume, applies
secrets, and does the first deploy):

```bash
./deploy.sh init
```

For subsequent updates:

```bash
./deploy.sh deploy
```

Under the hood these wrap `flyctl` commands — see `deploy.sh` for the
full list (`secrets`, `status`, `logs`, `health`, `rollback`, `build`).
Everything is idempotent, so re-running `init` is safe if something
fails halfway through.

If you'd rather run flyctl directly:

```bash
flyctl deploy -a plexus-alert-service
```

First deploy should boot successfully if every prerequisite above is true.
Watch the logs for:

```
bootstrap state: api      (✅ rules hydrated from Next.js)
consumers active: N       (N = orgs with rules)
listening on :8081
```

If you see `bootstrap state: cache`, Next.js was unreachable at boot but
the on-disk fallback saved us — sanity-check `PLEXUS_API_URL` reachability
before the next deploy, because a second failure point would have taken
the service down.

If you see the service exiting with `no rules cache available, refusing to
start empty`, the volume isn't mounted or the path is wrong. Check
`flyctl ssh console -C 'ls -la /var/cache/alert-service'`.

## Verifying a deploy

The service is internal-only — there is no public hostname, and the two
listening ports (8081, 9091) are exposed only over Fly's `.internal` DNS.
`./deploy.sh health` SSHs into a running machine and curls `/readyz`
locally:

```bash
./deploy.sh health
# { "status": "ready", "checks": { ... } }
```

From another Fly app in the same org you can also hit the internal DNS
directly:

```bash
# Cheap liveness
curl http://plexus-alert-service.internal:8081/livez
# {"status":"ok"}

# Deep readiness
curl http://plexus-alert-service.internal:8081/readyz

# Prometheus scrape
curl http://plexus-alert-service.internal:9091/metrics | head
```

`/readyz` returning 503 with a `reason` field tells you exactly which
subsystem is unhealthy. See ARCHITECTURE.md §"Failure-mode cheatsheet" for
how to interpret each reason.

## Monitoring

Point your Prometheus scrape at `:9091/metrics`. A ready-to-import rules
file lives at **[`prometheus-rules.yml`](./prometheus-rules.yml)** in this
repo — drop it into your Prometheus `rule_files:` config. It covers the
four cases that should page someone:

| Rule | Metric | Page at |
|---|---|---|
| `AlertServiceDown` | `up{job="plexus-alert-service"} == 0` | 2 min |
| `AlertServiceNoConsumers` | `alertd_consumers_active == 0` | 10 min |
| `AlertNotifierFailing` | `rate(alertd_notifications_failed_total[5m]) > 0` | 10 min |
| `AlertEvaluationStalled` | `rate(alertd_evaluations_total[5m]) == 0 AND alertd_consumers_active > 0` | 15 min |

(`AlertCHWritesFailing` / `alertd_ch_writes_failed_total` referred to the
ClickHouse sink, removed in 3bf7eb4 — the metric no longer exists.)

**Gap worth knowing about**: today's metrics don't publish notifier queue
depth or rules-snapshot staleness as Prometheus
gauges — those states are only on `/readyz`. The rules above catch the
"failures are happening" case via the `_failed_total` counters, but won't
catch "queue is growing because Next.js is just slow enough to build a
backlog without outright failing". If you want full coverage, either
pair the metrics with a blackbox exporter probe on `/readyz` or extend
`metrics.go` to publish the health gauges. Not blocking for first deploy.

`/readyz` itself is also suitable as a public-facing uptime check
(Pingdom etc.) as long as the check runs from inside the private network
or via a proxy. Don't expose 8081 publicly.

## Scaling

**Vertical** — the default VM (512 MB, 1 shared CPU) is sized for low-
volume orgs. Per-org goroutine memory is dominated by the distribution
tracker (~40 bytes × metrics × sources) and is effectively free. If CPU
saturates it's almost always the Welford update loop on one very-high-rate
org; bump to dedicated-cpu-1x first, then horizontal.

**Horizontal** — to run >1 instance, you must:

1. Template `ALERTD_CONSUMER_NAME` per-machine (see fly.toml block above).
   Redis consumer groups distribute messages across uniquely-named
   consumers; sharing a name means sharing the PEL, which defeats the
   parallelism.
2. Know that the embedded `dist_*` snapshots on transitions will be
   per-instance — each machine has its own view of recent history. See
   ARCHITECTURE.md §"Distribution tracking" for the implications.
3. Nothing on the Next.js side changes — the receiver's one-active-alert-
   per-`(org_id, rule_id, source_id)` unique index (see CONTRACT.md) already
   absorbs the occasional near-duplicate that results from two instances
   briefly agreeing about the same transition.

## Rollback

```bash
flyctl releases list
flyctl deploy --image registry.fly.io/plexus-alert-service:v<previous>
```

Rollbacks are safe: the service's only durable external state is the
on-disk rules cache (forward-compatible JSON — older binaries ignore
unknown fields). No DB migrations are owned by this service. (The
ClickHouse `plexus.alert_events` sink was removed in 3bf7eb4.)

**The one thing rollback does NOT fix**: if you roll back the alert-service
*without* also rolling back the Next.js side, and the contract changed
between versions, you can end up with:

- Next.js pushing rules the older alert-service can't validate → rules
  push returns 400, the org's rules become stale.
- Older alert-service emitting transitions the newer Next.js doesn't
  recognize → transitions are accepted but misrouted.

CONTRACT.md is the source of truth for the boundary. Bump a contract
version header there and gate breaking changes explicitly if you end up
wanting to evolve the schema without coordinated deploys.

## Common ops tasks

**Forcing a rules refresh** — restart the service. Bootstrap re-runs
against Next.js on every boot. Not graceful, but reliable; there's no
runtime refresh API today.

**Clearing a stuck alert** — delete the rule in Next.js and push again,
then recreate the rule. The state machine removes the instance when the
rule disappears from the store; re-adding starts fresh. Do not edit
`rules-cache.json` by hand to work around a stuck state — it's
overwritten on the next push.

**Draining before redeploy** — Fly sends SIGTERM with a 10-second grace.
The service drains sinks in order (consumers → notifier → HTTP) within
that window. Losing a few in-flight transitions during a
deploy is fine; Supabase is the authoritative alert history and the state
machine is idempotent.
