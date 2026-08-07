# Architecture

Internals of plexus-alert-service. Read this if you're about to change the
service or debug something non-obvious. For the wire contract with Next.js
see [CONTRACT.md](./CONTRACT.md); for ops and Fly deploy see
[DEPLOY.md](./DEPLOY.md); for the system-wide picture (gateway, three
data paths) see `plexus/gateway/ARCHITECTURE.md`.

## Pipeline in one picture

```
  ┌──────────────────────┐ XREADGROUP  ┌──────────────────────────────┐
  │ Redis Stream         │────────────▶│ OrgConsumer (one per org)    │
  │ telemetry.stream:{o} │             │   stream.go                  │
  │ consumer group       │             │                              │
  │ "alerts"             │             │  1. parse v:2 envelope       │
  └──────────────────────┘             │  2. per-point:                │
                                       │     a. Welford update         │
                                       │        (distribution.go)      │
                                       │     b. find matching rules    │
                                       │        (rules.go)             │
                                       │     c. evaluate               │
                                       │        (engine.go)            │
                                       │     d. feed state machine     │
                                       │        (state.go)             │
                                       │  3. XACK on handled ids       │
                                       └──────────────┬───────────────┘
                                                      │ Transition{}
                                                      ▼
                                       ┌──────────────────────────────┐
                                       │ AlertStateManager            │
                                       │   state.go                   │
                                       │  - per-(rule, source) FSM    │
                                       │  - emits transitions to N    │
                                       │    TransitionSink entries    │
                                       └──────────────┬───────────────┘
                                                      │
                                                      ▼
                                              ┌──────────────┐
                                              │ Notifier     │
                                              │ notifier.go  │
                                              │ POST → Next  │
                                              └──────────────┘
```

(A second sink — CHWriter in `clickhouse.go`, INSERT into ClickHouse
`plexus.alert_events` — was removed in commit 3bf7eb4 and never rebuilt.)

## Consumer lifecycle (rule-driven)

Per-org consumers are started and stopped by the `RuleStore` firing an
`onChange` callback into the `ConsumerManager`:

| Trigger | Effect |
|---|---|
| Bootstrap loads N orgs | `ConsumerManager.ReconcileAll` starts a goroutine for each |
| Push `POST /internal/rules/{org}` with rules | `Reconcile(org)` — start consumer if none, leave running otherwise |
| Push `POST /internal/rules/{org}` with `[]` | `Reconcile(org)` — stop the consumer, delete state |

**Invariant**: a consumer exists ⟺ the org has at least one rule. Idle orgs
cost nothing — no goroutine, no Redis connection, no memory. This is
deliberate: with thousands of inactive orgs, you don't want the cost of
idle consumers.

Each `OrgConsumer` runs two goroutines:

1. **`pollLoop`** — `XREADGROUP` against `telemetry.stream:{org}` with
   consumer group `alerts` and the configured consumer name. Messages are
   processed in-order within a batch; each message is either evaluated
   (and acked) or treated as poison (and acked to stop redelivery) or
   left in the PEL for retry.
2. **`autoClaimLoop`** — every 30 s, runs `XAUTOCLAIM` with `min-idle=60s`
   against the same group to reclaim messages a crashed/evicted consumer
   left pending. Reclaimed messages go through the exact same processing
   path as fresh ones.

### What counts as poison vs. retry

The `processMessage` (`stream.go`) return value decides:

- **Parseable, non-metric** (heartbeat, event, empty points) → ack. Retrying
  a heartbeat doesn't produce alerts.
- **Unparseable JSON** → ack. Redelivering will just parse-fail again.
- **Panic / XAck failure mid-batch** → left in the PEL. There is **no
  in-process recover** — a panic kills the whole process, and the pending
  entries are recovered **after the process restarts**, via the
  `autoClaimLoop`'s `XAUTOCLAIM` sweep (min-idle 60 s). The same sweep
  covers an XAck failure: `XREADGROUP` with `>` never redelivers a
  consumer's own PEL entries. The state machine is idempotent enough that
  a duplicate evaluation is at worst a re-fire of an already-open alert.

## Rule store and bootstrap

`RuleStore` (`rules.go`) is the single source of truth for in-memory rules.
It's keyed by org and thread-safe. All mutations go through `ReplaceAll`
(bootstrap) or `ReplaceOrg` (push), which:

1. Swap the map atomically under `mu`.
2. Update `lastUpdated` for `/readyz` staleness checks.
3. Snapshot the full store to disk (`ALERTD_RULES_CACHE_PATH`, best-effort).
4. Call `onChange(orgID)` → `ConsumerManager.Reconcile`.

### Bootstrap fallback chain

At startup (the bootstrap block in `main.go`, `main()`):

1. If `PLEXUS_API_URL` is set, try `GET /api/internal/alerts/rules/all` with
   retries `1s, 2s, 4s, 8s, 16s` inside a 90 s budget.
2. On success: `ReplaceAll(snapshot)` and mark `bootstrap="api"`.
3. On failure: `LoadRulesCache(path)`. If it returns a non-nil map,
   `ReplaceAll(cached)` and mark `bootstrap="cache"`.
4. On cache failure too: `os.Exit(1)`. Running with an empty rule set would
   silently under-alert, which is worse than crash-looping.
5. Dev-mode exception: if `PLEXUS_API_URL` is empty, start with an empty
   rule set and mark `bootstrap="api"`. This only affects local iteration.

The `bootstrap` state is surfaced on `/readyz` — any value other than
`"none"` is healthy.

**Implication for operators**: the on-disk cache is load-bearing. In prod,
`ALERTD_RULES_CACHE_PATH` must point at a persistent volume mount —
otherwise a machine replace combined with a Next.js outage takes the
service down hard.

## Distribution tracking (the `dist_*` fields)

`distribution.go` implements exponentially weighted Welford's algorithm.
Each `(source, metric)` pair gets a `WelfordState` (~40 bytes) holding
`Count, Mean, M2`. Updates are O(1):

```
diff  = value - mean
mean += alpha * diff
M2    = (1 - alpha) * (M2 + alpha * diff * diff)
```

With `alpha = 0.01` (default), a single sample's influence decays to
negligible after ~500 subsequent samples — so "recent" distribution, not
all-time.

### Why snapshot it onto every transition

The `DistSnapshot{Mean, StdDev, Count}` embedded in every `Transition`
exists for two reasons:

1. **Outlier evaluation already uses it.** `EvalOutlier` (`engine.go`)
   computes `(value - mean) / stddev` and triggers when the absolute
   z-score exceeds the threshold.
2. **Context for downstream consumers.** Next.js gets to
   answer "how anomalous was this alert at the moment it fired?" without
   needing to reconstruct the distribution or query raw telemetry. The
   snapshot is *frozen* as-of the transition. (It formerly also landed in
   ClickHouse `plexus.alert_events`; that sink was removed in 3bf7eb4.)

### Important caveats

- **In-memory only.** Not persisted. On restart, distributions rebuild from
  the replayed stream; the first ~500 points per metric are the warm-up
  period, during which outlier rules are effectively disabled by
  `min_samples` gating.
- **Per-instance.** Running two alert-service instances against the same
  stream gives each its own view of the distribution. They'll converge for
  the same input, but during warm-up or after a restart they can disagree
  briefly. This is fine for evaluation (each transition is emitted once
  per instance per state change, and the receiver does **not** dedupe on a
  `state`/`timestamp` tuple — it enforces one active alert per
  `(org_id, rule_id, source_id)` via a partial unique index
  `WHERE is_alert_active=TRUE`, so a duplicate `open` for an already-active
  pair is skipped — see CONTRACT.md §3).
  It does mean the embedded `dist_*` snapshot reflects "which instance's
  view of recent history", not a canonical answer.
- **Compound rules reuse the per-metric distributions.** For each sub-rule,
  `EvalCompound` pulls the distribution via `GetSourceMetrics` on the same
  tracker — there is no "distribution of the compound expression," just
  distributions of its constituent metrics.

## State machine

`AlertStateManager` (`state.go`) holds per-`(rule_id, source_id)` instances,
each a tiny FSM:

```
IDLE ──trigger──▶ OPEN ──clear──▶ CLOSING ──hysteresis elapsed──▶ COOLDOWN ──▶ IDLE
                    │                  │                       (emits "closed")
                    │                  └─re-trigger─▶ OPEN
                    │
                    └─emit "open"
```

(There is no stored CLOSED state — the "closed" wire event fires on the
`CLOSING → COOLDOWN` edge, all under one lock, so a distinct CLOSED state
would never be observable.)

Key properties:

- **Hysteresis is close-side only.** Alerts open on the first triggering
  evaluation; closing requires `hysteresis_seconds` of sustained recovery.
  This prevents flap on noisy metrics that dip briefly below a bound but
  otherwise stay broken.
- **Cooldown is re-fire-only.** After a clean close, a further
  `cooldown_seconds` must elapse before the same `(rule, source)` pair
  can open again. Within cooldown, evaluations are ignored.
- **Cooldown expiry with active trigger** → inline re-open. The same
  `ProcessEvaluation` that expires cooldown also opens a new alert if the
  condition is still true, emitting a fresh `open` transition.
- **Only `open` and `closed` emit.** `CLOSING` and `COOLDOWN` are internal.
  For any given `(rule_id, source_id)`, wire events strictly alternate
  `open, closed, open, closed, ...` — see the dedupe rationale in
  CONTRACT.md §3.

Defaults come from `AlertDefaults` (`config.go`) and are overridable
per-rule: `hysteresis_seconds=30`, `cooldown_seconds=60`, `min_samples=30`.

## Sinks

`TransitionSink` is a one-method interface (`Enqueue(Transition)`). One
implementation:

### Notifier (`notifier.go`) — POST to Next.js

- Batches transitions in memory, flushes on `FlushInterval` (default 1s)
  or when the batch reaches `BatchSize` (default 50).
- Retries each flush `MaxRetries+1` times with backoff `1s, 2s, 4s`.
- On exhausted retries, **drops the batch** and records a failure on the
  health channel. Rationale: retrying stale transitions on the other side
  of a failure window is worse than silence — the state machine has
  already advanced, and Next.js retrying an already-processed batch risks
  double-fire on the user side. CONTRACT.md §3 makes the receiver
  responsible for dedupe.
- Exposes `Health()` → `(lastSuccess, lastFailure, queueDepth)` for `/readyz`.

### CHWriter — Removed, not currently built

The second sink (`clickhouse.go`, batched INSERT to `plexus.alert_events`,
gated by `ALERTD_CH_ENABLED` / `PLEXUS_CLICKHOUSE_DSN`) was **removed in
commit 3bf7eb4 and never rebuilt**. There is no ClickHouse code in this
repo; the dead `ALERTD_CH_ENABLED` key has since been removed from
`fly.toml` too. Supabase (via the notifier) is the sole and authoritative
transition store.

## Health model

`/readyz` is a composite over every subsystem that could silently fail.
It returns 503 with a `reason` field as soon as any check fails; external
uptime monitoring should page on 503. The specific thresholds live in the
`readyMax*` constants in `main.go` and are worth tuning from real-world
data:

| Check | Healthy when |
|---|---|
| Redis ping | < `RedisConfig.PingTimeout` (default 500ms) |
| Bootstrap state | `"api"` or `"cache"`, not `"none"` |
| Rules snapshot age | < 15 min (if bootstrapped) |
| Notifier last success | < 5 min *OR* queue is empty |
| Notifier queue depth | < 10,000 |

(ClickHouse sink checks were removed with the sink in 3bf7eb4.)

`/livez` is deliberately cheap (HTTP 200 with a JSON body). Fly uses it for
restart decisions; we don't want a sink backlog to trigger a restart loop
because the underlying problem (Next.js down, CH down) isn't fixed by
restarting.

## Shutdown ordering

SIGTERM triggers graceful shutdown in this order (the shutdown goroutine
in `main.go`, `main()`):

1. `consumerMgr.StopAll()` — stop all per-org consumers. Stops new messages
   from entering the pipeline.
2. `notifier.Stop()` — drain any queued transitions with a final flush.
3. `srv.Shutdown()` — close HTTP/metrics servers.

The 10-second shutdown budget (`context.WithTimeout`) is a soft deadline.
If a sink can't drain in time, we drop rather than hang — losing a few
unflushed transitions is better than a hung shutdown that Fly kills hard.

## Failure-mode cheatsheet

| Symptom | Likely cause |
|---|---|
| `/readyz` 503 with `reason: rules_stale` | Next.js push endpoint broken, or nothing mutating rules for >15 min and a rules cache bug — sanity-check `/internal/rules/{org}` reachability |
| `/readyz` 503 with `reason: notifier_stuck` | Next.js `/api/internal/alerts/transitions` returning 5xx or slow — batches are retrying and failing |
| `/readyz` 503 with `reason: bootstrap` | Both Next.js and cache bootstrap failed; service came up empty. Check logs for the retry chain output. |
| Process exits immediately with `no rules cache available, refusing to start empty` | Next.js unreachable AND no volume mount / path wrong — first-boot chicken-and-egg |
| Alerts fire twice in quick succession | Either duplicate delivery (expected, dedupe in Next.js) or cooldown expired with active trigger (expected, by design) — check `cooldown_seconds` on the rule |
| Alerts don't fire despite obvious bad values | Outlier rule still in warm-up (`Count < min_samples`) OR state stuck in COOLDOWN OR consumer not running because org has no rules in the store — check `/metrics` for `consumers_active` |
