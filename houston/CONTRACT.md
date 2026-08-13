# alert-service ↔ Next.js Contract

This document is the authoritative wire contract between `plexus-alert-service`
and the Next.js control plane. **If something here disagrees with the Go
source, the Go source wins** — please open a PR to fix this doc.

Read this if you're:
- implementing the Next.js side of any of the endpoints below
- adding or changing an alert rule field
- debugging a 4xx/5xx between the two services

For what the alert service *does* internally (state machine, consumer lifecycle,
bootstrap fallback), see `ARCHITECTURE.md`.

## Overview

Five endpoints cross the boundary:

| Direction | Method & path | Served by | Purpose |
|---|---|---|---|
| alert-service → Next.js | `GET /api/internal/alerts/rules/all` | Next.js | Full rule bootstrap at alert-service startup |
| Next.js → alert-service | `POST /internal/rules/{orgID}` | alert-service | Push an org's rules after a mutation |
| alert-service → Next.js | `POST /api/internal/alerts/transitions` | Next.js | Deliver alert state changes (open/closed) |
| Next.js → alert-service | `GET /stats` | alert-service | Live stats for an in-flight (open/recovering) alert |
| alert-service → Next.js | `GET /api/internal/alerts/active` | Next.js | Active-alert list for the reconcile loop (§5) |

(The alert service also serves `GET /livez` and `GET /readyz` health probes,
with `GET /health` as a backward-compatible alias of `/readyz` — those are
operational, not part of the data contract.)

Supabase is the source of truth for rules. The alert service holds an in-memory
RuleStore, hydrated at boot via the bootstrap endpoint, kept fresh by the push
endpoint, and persisted to a local JSON cache as a last-resort fallback.

## Auth

Every request on every endpoint uses a **shared secret** in the
`x-internal-secret` HTTP header, compared in constant time on the receiver.
The secret is the `PLEXUS_INTERNAL_SECRET` env var on both sides and MUST be
identical.

- Missing or empty header → `401 Unauthorized`.
- Wrong value → `401 Unauthorized`.
- No other auth layer — no Clerk session, no JWT. These are server-to-server
  calls on the internal network.

There is no user identity. The alert service has no user. Endpoints that serve
this contract MUST use a service-role (RLS-bypassing) Supabase client —
using a user-scoped client will silently return empty under RLS.

## 1. Rule bootstrap — `GET /api/internal/alerts/rules/all`

Called by alert-service **once at startup** to hydrate every org's rules at
once. Hot-path updates happen via the push endpoint below; this is only for
cold start.

- **Server**: Next.js
- **Client**: alert-service (`rules.go`, `FetchAllRulesFromAPI`)
- **Request**:
  ```http
  GET /api/internal/alerts/rules/all HTTP/1.1
  x-internal-secret: {secret}
  accept: application/json
  ```
- **Success response**: `200 OK`
  ```json
  {
    "orgs": {
      "org_acme": {
        "rules": [AlertRule, ...]
      },
      "org_globex": {
        "rules": [AlertRule, ...]
      }
    }
  }
  ```
- **Empty is legal**: `{"orgs": {}}` is valid and means "no rules anywhere".
  The alert service will start with zero consumers.
- **Response body size cap**: 16 MB. Larger responses are truncated and
  decoded as a JSON error. If you expect to exceed this, talk to us first —
  we'll either raise the cap or paginate.
- **Timeout**: 10 s per attempt.

### Retry behavior (what the caller does on failure)

The alert service retries 5 times with backoff `1s, 2s, 4s, 8s, 16s` — total
budget ~30 s plus request latency — inside a 90 s overall deadline. If every
attempt fails, it falls back to the on-disk cache; if that's also missing,
the process exits non-zero rather than running empty (we'd rather crash-loop
than silently under-alert). **Practical implication**: Next.js can be briefly
unavailable during an alert-service restart without consequence. Sustained
unavailability is a problem only for brand-new alert-service deployments with
no warm cache.

### Error responses

| Status | Meaning | Caller action |
|---|---|---|
| `200` | Success (possibly empty orgs) | Proceed |
| `401` | Bad/missing secret | Retried like any other failure (see below) |
| `4xx` | Unexpected | Retry (same schedule as 5xx) |
| `5xx` | Next.js problem | Retry |

There is no non-retryable branch: `fetchRulesWithRetry` (`rules.go`) treats
every failure — including `401` — uniformly and retries on the same
`1s, 2s, 4s, 8s, 16s` schedule before falling back to the cache. A wrong
secret therefore burns the full ~30 s retry budget rather than failing fast.

## 2. Rule push — `POST /internal/rules/{orgID}`

Called by Next.js **after every mutation** that creates, updates, or deletes an
alert rule for an org. The payload is the **entire** rule set for that org —
the alert service does a wholesale swap, no deltas.

- **Server**: alert-service (route registration in `main.go`, handler `RuleStore.ServeHTTP` in `rules.go`)
- **Client**: Next.js (you're writing this helper — see "Suggested helper"
  below)
- **Request**:
  ```http
  POST /internal/rules/{orgID} HTTP/1.1
  content-type: application/json
  x-internal-secret: {secret}
  ```
  Body:
  ```json
  {
    "rules": [AlertRule, ...]
  }
  ```
- **Empty is legal**: `{"rules": []}` clears all rules for that org. When
  this happens, the alert service stops the org's consumer goroutine. The
  next push with rules will start it again.
- **Body size cap**: 4 MB. Larger bodies return `413 Request Entity Too Large`.
- **Success**: `204 No Content`. No response body.

### Effect

On success, the alert service:
1. Atomically replaces the org's rule set in memory.
2. Writes the full in-memory snapshot to the on-disk cache (best-effort; a
   cache write failure is logged but does not fail the request).
3. Reconciles the consumer manager: starts a goroutine for this org if there
   wasn't one, or stops it if the new rule set is empty.
4. Closes out orphaned alert instances: any in-memory alert whose rule is
   absent from the new set is removed, and if it was open/recovering a
   synthetic `closed` transition is emitted (§3) so the frontend's active
   alert row doesn't stay open forever. Deleting a rule therefore closes
   its open alert.

### Idempotency

Fully idempotent. Pushing the same payload twice has no additional effect.
Safe to retry on any 5xx or network error.

### Validation errors (400)

Every rule in the payload is validated before the swap. If any rule fails,
the entire request is rejected — no partial apply. Response body is plain
text of the form:

```
invalid rule at index 2: operator must be 'and' or 'or'
```

The validation rules are enumerated in the `AlertRule` schema below. All of
them return `400`.

### Error responses

| Status | Meaning | Caller action |
|---|---|---|
| `204` | Success | Done |
| `400` | Invalid rule or malformed JSON | Fix payload, do not retry |
| `401` | Bad/missing secret | Fix secret, do not retry |
| `413` | Body > 4 MB | Split or rethink, do not retry |
| `5xx` | alert-service problem | Retry with backoff |

### Suggested Next.js helper

Place at `frontend/lib/alerts/push-rules-to-alert-service.ts`. Call it from
every route that mutates alert rules, after the Supabase write commits.
Never throw — Supabase is the source of truth, and the alert service
self-heals on its next restart (via the bootstrap endpoint). Log and move on:

```ts
const res = await fetch(`${process.env.PLEXUS_ALERT_SERVICE_URL}/internal/rules/${orgId}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-internal-secret": process.env.PLEXUS_INTERNAL_SECRET!,
  },
  body: JSON.stringify({ rules }),
  signal: AbortSignal.timeout(5000),
});
if (!res.ok) {
  console.error(`[push-rules] ${res.status} for org ${orgId}`);
  // do not throw — log-and-continue
}
```

`PLEXUS_ALERT_SERVICE_URL` is a Fly `.internal` DNS name (e.g.
`http://plexus-alert-service.internal:8081`); the service is not publicly
exposed.

## 3. Transition delivery — `POST /api/internal/alerts/transitions`

Called by alert-service whenever one or more alert instances change state.
This is where Next.js persists alert history, fires user-facing notifications,
triggers webhooks, etc.

- **Server**: Next.js
- **Client**: alert-service (`notifier.go`, `TransitionNotifier.flush`)
- **Request**:
  ```http
  POST /api/internal/alerts/transitions HTTP/1.1
  content-type: application/json
  x-internal-secret: {secret}
  ```
  Body:
  ```json
  {
    "transitions": [Transition, ...]
  }
  ```
- **Success**: any `2xx`. Body ignored (up to 10 KB, then discarded).

### Batching and cadence

- Transitions are batched in memory and flushed on the **earlier** of:
  - every `ALERTD_NOTIFY_INTERVAL` (default **1 second**), or
  - when the batch reaches `BatchSize` (default **50 transitions**).
- Typical batch is 1–10 transitions. A quiet org may see batches of size 1
  once per second. A storm can push 50 in a single POST.
- Each flush is a **single** POST, not one per transition.

### Retry behavior

On connection error or non-2xx, the alert service retries 3 times with
backoff `1s, 2s, 4s` (total ~7 s) before giving up and logging a
failure. Failed batches are **dropped** — they are not persisted to the
local cache and will not be retried on restart. Rationale: retrying stale
transitions on the other side of a restart is worse than silence, because
the alert state machine has already advanced.

**Practical implication for the receiver**: you must accept duplicates. Two
reasons:
1. If Next.js returns non-2xx after processing the side-effects but before
   writing the response (hung proxy, etc.), the alert service retries and
   you'll see the same batch twice.
2. When the alert service restarts, at-least-once processing from Redis can
   re-deliver points that caused an already-emitted transition, producing a
   second transition with the same `(rule_id, source_id, state, timestamp)`.

**Deduplication (as implemented)**: the receiver does **not** dedupe on a
`(org_id, source_id, rule_id, state, timestamp)` tuple. Instead it enforces
**one active alert per `(org_id, rule_id, source_id)`** via the partial
unique index in "Open-close matching" below (`WHERE is_alert_active=TRUE`):
a duplicate `open` for a pair that is already active trips the unique
constraint (23505) and is skipped, and a `close` for a pair with no active
row is a no-op. Neither `state` nor `timestamp` participates in the key.
One consequence worth knowing: a duplicate `open` redelivered *after* its
alert has already closed is not caught — it opens a fresh active row. The
alert-service's own state machine (one open per `(rule, source)`) is what
keeps that off the wire in normal operation.

### Back-pressure and health

- The in-flight queue depth is surfaced by `/readyz` on the alert service.
- If queue depth exceeds 10,000 or the last successful flush was >5 minutes
  ago while the queue is non-empty, `/readyz` returns `503` and external
  monitoring should page. Nothing on the Next.js side needs to care about
  this directly — but **sustained 5xx responses from Next.js are the most
  likely cause of it**.
- **Respond fast or bear the cost**: the alert service uses a 5 s HTTP
  client timeout by default. Slow Next.js responses count as failures and
  burn retries. Do the minimum work synchronously (auth + persist) and push
  webhooks / notifications onto a queue.

### Error responses

| Status | Meaning | Caller action |
|---|---|---|
| `2xx` | Success | Done (batch discarded from queue) |
| `4xx` | Malformed / auth | Counts as a retry attempt; after exhaustion, batch is dropped and logged |
| `5xx` | Next.js problem | Retries up to 3 times, then drops |
| connection error | Network / DNS | Retries up to 3 times, then drops |

## 4. Live alert stats — `GET /stats`

Called by Next.js to fetch the current breach profile of an **in-flight**
alert (open or recovering). Meaningful for threshold/outlier rules only —
compound rules don't accumulate stats.

- **Server**: alert-service (route in `main.go`; instance lookup
  `AlertStateManager.GetInstance` in `state.go`)
- **Auth**: same `x-internal-secret` header as everything else, compared in
  constant time. Missing/wrong → `401`.
- **Request**:
  ```http
  GET /stats?rule={ruleID}&source={sourceSlug} HTTP/1.1
  x-internal-secret: {secret}
  ```
  Query params (both required, else `400`):
  | Param | Meaning |
  |---|---|
  | `rule` | `AlertRule.id` (UUID) |
  | `source` | Source **slug** (org-scoped, same as everywhere in this contract) |
- **Success**: `200 OK` with a `LiveStats` body:
  ```json
  {
    "state": "breaching",
    "opened_at": 1744732800,
    "trigger_value": 92.1,
    "peak_value": 97.4,
    "peak_z_score": 4.2,
    "retrigger_count": 12,
    "data_point_count": 40,
    "current_dist": { "mean": 72.4, "stddev": 5.1, "count": 842 },
    "hysteresis_progress": 0.4
  }
  ```
  | Field | Type | Notes |
  |---|---|---|
  | `state` | enum | `"breaching"` (instance OPEN) or `"recovering"` (CLOSING, hysteresis running). |
  | `opened_at` | int | Unix seconds the alert opened. |
  | `trigger_value` | float | Value at first breach, frozen at open. |
  | `peak_value` | float | Most extreme value seen (direction-aware). |
  | `peak_z_score` | float \| omitted | Highest abs z-score seen. Outlier rules only. |
  | `retrigger_count` | int | Triggered evaluations after the initial open. |
  | `data_point_count` | int | Evaluations processed since open (incl. the open). |
  | `current_dist` | `DistSnapshot` | Distribution as of the latest evaluation. |
  | `hysteresis_progress` | float \| omitted | 0.0–1.0. Present only while `"recovering"`. |
- **`404 Not Found`**: no instance for `(rule, source)`, or the instance is
  in cooldown — there's nothing in flight. Treat 404 as "no live stats",
  not an error.

There is no history here — this endpoint reads the in-memory state machine
of one instance. Once the alert closes, the definitive stats arrive on the
`closed` transition (`stats` field, §3).

## 5. Active-alert reconcile — `GET /api/internal/alerts/active`

Alert instances live only in alert-service memory, so a restart forgets
every open alert: the frontend's `alerts` row stays `is_alert_active=true`
forever (no instance → no `closed` transition), and the unique active-alert
index then rejects the next `open` for that `(rule, source)` — silent
permanent under-alerting. A `closed` batch dropped after retry exhaustion
(§3) wedges a row the same way.

The reconcile loop (`reconcile.go`, started from `main.go` when
`PLEXUS_API_URL` is set) repairs both: every 5 minutes (first run 5 minutes
after boot, so post-restart evaluations can re-adopt still-firing alerts
via the duplicate-open skip) it fetches this endpoint and emits a synthetic
`closed` transition with `reason="reconciled"` for every row that has no
live (OPEN/CLOSING) instance. Conditions that are genuinely still firing
re-open on their next evaluation.

- **Server**: Next.js
- **Client**: alert-service (`reconcile.go`, `FetchActiveAlertsFromAPI`)
- **Request**:
  ```http
  GET /api/internal/alerts/active HTTP/1.1
  x-internal-secret: {secret}
  accept: application/json
  ```
- **Success response**: `200 OK`
  ```json
  {
    "alerts": [
      {
        "org_id": "org_acme",
        "rule_id": "uuid",
        "source_id": "drone-17",
        "metric": "battery",
        "severity": "warning"
      }
    ]
  }
  ```
  `source_id` is the slug, as everywhere in this contract. The list covers
  only threshold/outlier/compound rules that are still enabled — offline
  and poll-path (event/limit) alerts have their own close paths in the
  frontend loops, and disabled/deleted rules are closed by the frontend's
  orphan sweep.
- **Failure**: any non-200 is logged and retried at the next tick — the
  loop is a repair mechanism, not a hot path.

## Schemas

Canonical definitions live in Go. These are the JSON shapes you'll see on the
wire. All fields using `snake_case`.

### `AlertRule`

```json
{
  "id": "uuid",
  "org_id": "org_acme",
  "source_id": "drone-17",
  "type": "threshold",
  "metric": "battery",
  "conditions": {
    "min": 10,
    "max": 90,
    "z_score": 3.0,
    "min_samples": 30
  },
  "operator": "and",
  "rules": [SubRule, ...],
  "hysteresis_seconds": 30,
  "cooldown_seconds": 60,
  "severity": "warning"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Rule UUID. Used as the key server-side. |
| `org_id` | string | yes | Matches the URL path segment on push and the top-level key on bootstrap. |
| `source_id` | string | yes | **Source slug, not UUID. Scoped to `org_id`, not globally unique.** Supabase enforces `UNIQUE (org_id, slug)` on `sources` — two different orgs can both have `drone-17`. Every identifier in this contract is implicitly org-scoped; `(org_id, source_id)` is the real natural key. Resolve via your `sources.slug` column before serializing. |
| `type` | enum | yes | One of `"threshold"`, `"outlier"`, `"compound"`. |
| `metric` | string | conditional | Required for `threshold` and `outlier`. Empty/omitted for `compound` (metrics live on sub-rules). |
| `conditions` | object | conditional | Required for `threshold` and `outlier`. Omitted for `compound`. See `RuleConditions` below. |
| `operator` | enum | conditional | Required for `compound`. One of `"and"`, `"or"`. |
| `rules` | array | conditional | Required for `compound`. 1–20 `SubRule` entries. Field name is `rules` on the wire, not `sub_rules`. |
| `hysteresis_seconds` | int | no | Default `0` → falls back to the hardcoded default of 30 s (`AlertDefaults` in `config.go`; not env-tunable — same in dev and prod). Must be ≥ 0. |
| `cooldown_seconds` | int | no | Default `0` → falls back to the hardcoded default of 60 s (`AlertDefaults` in `config.go`; not env-tunable — same in dev and prod). Must be ≥ 0. |
| `severity` | string | yes | Free-form (e.g. `"info"`, `"warning"`, `"critical"`). Carried through unchanged to transitions. |

### `SubRule`

Only used inside compound rules. Has its own type, metric, and conditions
but inherits lifecycle config (`hysteresis_seconds`, `cooldown_seconds`,
`severity`) from the parent `AlertRule`.

```json
{
  "type": "threshold",
  "metric": "altitude",
  "conditions": {
    "max": 400
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | enum | yes | `"threshold"` or `"outlier"`. **Compound sub-rules cannot themselves be compound.** |
| `metric` | string | yes | Must reference a metric the same source emits. |
| `conditions` | object | yes | Same shape as on `AlertRule`. |

### `RuleConditions`

All fields optional — the semantic is "if present, it's a bound". `null` and
missing mean the same thing (no bound).

```json
{
  "min": 10,
  "max": 90,
  "z_score": 3.0,
  "min_samples": 30
}
```

| Field | Type | Used by | Meaning |
|---|---|---|---|
| `min` | float \| null | threshold | Alert fires if value < min. |
| `max` | float \| null | threshold | Alert fires if value > max. |
| `z_score` | float \| null | outlier | Abs z-score threshold. Must be > 0. Defaults to 3.0 if omitted. |
| `min_samples` | int \| null | outlier | Skip evaluation until the distribution has this many samples. Must be ≥ 1. Defaults to the hardcoded default of 30 (`AlertDefaults` in `config.go`; not env-tunable — same in dev and prod). |

**Omit, don't zero.** The Go side uses `*float64` — `0` is a real bound, not
"unset". Serialize missing fields as absent (or `null`), not as `0`.

### Per-type validation summary

| Rule type | Requires | Disallows |
|---|---|---|
| `threshold` | `metric`, at least one of `conditions.min`/`conditions.max` | `rules`, `operator` |
| `outlier` | `metric`; `conditions.z_score > 0` if set; `conditions.min_samples ≥ 1` if set | `rules`, `operator` |
| `compound` | `operator ∈ {and, or}`; `1 ≤ len(rules) ≤ 20`; each sub-rule has `metric` + valid `type` | `metric`, `conditions` |

Validation is in `validateRule` in `rules.go` — go there when this table
drifts.

### `Transition`

Emitted by alert-service on every state change (open or closed).

```json
{
  "rule_id": "uuid",
  "org_id": "org_acme",
  "source_id": "drone-17",
  "metric": "battery",
  "state": "open",
  "value": 7.2,
  "threshold": 10,
  "z_score": null,
  "severity": "warning",
  "distribution": {
    "mean": 72.4,
    "stddev": 5.1,
    "count": 842
  },
  "timestamp": 1744732800
}
```

| Field | Type | Notes |
|---|---|---|
| `rule_id` | string | The `AlertRule.id` that triggered this transition. |
| `org_id` | string | |
| `source_id` | string | Slug, not UUID. |
| `metric` | string | For compound rules, this is the metric that *caused* the evaluation — the most recently changed sub-rule metric. |
| `state` | enum | `"open"` or `"closed"`. There is no `"closing"` or `"cooldown"` — those are internal states that do not emit. |
| `value` | float | Latest value that triggered/cleared the condition. |
| `threshold` | float \| omitted | Set for threshold rules: the bound that was violated. Omitted on close and for non-threshold rules. |
| `z_score` | float \| omitted | Set for outlier rules: the computed abs z-score. Omitted otherwise. |
| `severity` | string | Copied from the rule unchanged. |
| `distribution` | object | Snapshot of the Welford state at the moment of transition: see `DistSnapshot` below. |
| `timestamp` | int | **Unix seconds.** For `open`, it's when the alert opened. For `closed`, when it closed. |
| `reason` | enum \| omitted | Synthetic closes only: `"rule_deleted"` (rule vanished from a push while its alert was open) or `"reconciled"` (reconcile loop found an active row with no live instance, §5). Absent on organic transitions. |

### `DistSnapshot`

```json
{
  "mean": 72.4,
  "stddev": 5.1,
  "count": 842
}
```

| Field | Type | Notes |
|---|---|---|
| `mean` | float | Exponentially weighted mean at the moment of transition. |
| `stddev` | float | Exponentially weighted standard deviation. |
| `count` | int | Total samples seen by this (source, metric) — used for min_samples gating only, not for the statistics. |

## State-machine quick reference

Understanding which transitions actually hit the wire:

```
IDLE ──trigger──▶ OPEN ──clear──▶ CLOSING ──hysteresis elapsed──▶ COOLDOWN ──▶ IDLE
                   │                  │                      (emits "closed")
                   │                  └─re-trigger─▶ OPEN
                   │
                   └─emits "open" transition
```

- `"open"` emits on `IDLE → OPEN`.
- `"closed"` emits on `CLOSING → COOLDOWN` (after `hysteresis_seconds` of sustained recovery).
- No wire events for `CLOSING` flapping or `COOLDOWN` expiry.
- While in `COOLDOWN`, re-triggers are ignored until `cooldown_seconds` elapse. A still-triggering evaluation at cooldown expiry immediately re-opens and emits a fresh `"open"`.

This means: for any given `(rule_id, source_id)`, wire events alternate
strictly `open, closed, open, closed, ...`. Two `open` in a row, or two
`closed` in a row, indicates a duplicate delivery — see the dedupe note
in §3.

## Environment variables

Both sides need:

| Var | Set on | Value |
|---|---|---|
| `PLEXUS_INTERNAL_SECRET` | both | Shared secret. Non-empty, non-trivial. |
| `PLEXUS_API_URL` | alert-service | Next.js base URL (e.g. `https://app.plexus.internal`). No trailing slash. |
| `PLEXUS_ALERT_SERVICE_URL` | Next.js | alert-service base URL (e.g. `http://plexus-alert-service.internal:8081`). No trailing slash. |

## Supabase schema (authoritative)

This section describes the Supabase schema that backs the Next.js side of
this contract. It is **advisory from alert-service's point of view** — the
alert service never touches Supabase directly, and doesn't care how Next.js
stores rules as long as the wire shapes in §§1–3 are honored. But because
the frontend team is implementing these endpoints fresh, "what table do I
read and write against?" is the first real question, and it's worth
answering once here rather than having every engineer rediscover it.

### What already exists (do not change)

The Supabase schema today has three alert-related tables that continue to
serve distinct purposes and should be left alone:

| Table | Purpose | Consumer |
|---|---|---|
| `source_limits` | Flat `{min, max, severity}` per `(source, metric)`. (Formerly pushed to the gateway to drive an `alert: 0|1` field in the browser fanout — that gateway feature was removed in gateway commit 370b669.) | UI / alerting config |
| `alerts` | Persisted alert instances with status (`open`/`acknowledged`/`resolved`), RCA, telemetry snapshots, resolution notes, product fields. | UI, user workflows |
| `alert_events` (Supabase) | Activity timeline on a persisted alert (created, acknowledged, resolved, ...). | UI |

**Naming footgun — `alert_events`**:

- `public.alert_events` (Supabase, Postgres) — alert activity timeline,
  written by Next.js workflows. This is the only live `alert_events` table.
- `plexus.alert_events` / `plexus.alert_events_dist` (ClickHouse) — the
  per-transition sink alert-service used to write. **Removed — not
  currently built**: the CHWriter/`clickhouse.go` sink was deleted in
  commit 3bf7eb4 and never rebuilt (the dead `ALERTD_CH_ENABLED` key has
  since been dropped from `fly.toml` as well).

### What's new: `alert_rules`

The frontend needs a new `alert_rules` table to hold the richer alert
definitions consumed by alert-service. It should sit alongside — not
replace — `source_limits`, because the two feed different consumers with
different schemas and different latency expectations.

**Recommended DDL** (adapt to your migration tooling and enum conventions):

```sql
-- alert-rule categories. Mirrors AlertRule.type on the wire.
CREATE TYPE alert_rule_type AS ENUM ('threshold', 'outlier', 'compound');

-- compound-rule operators. Null for non-compound rules.
CREATE TYPE alert_rule_operator AS ENUM ('and', 'or');

CREATE TABLE alert_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant scope. Matches sources.org_id and the URL path segment on
    -- POST /internal/rules/{orgID}.
    org_id              TEXT NOT NULL,

    -- FK to sources.id (UUID), not slug. The wire format carries slug;
    -- resolve via a JOIN when serializing. Matches the existing pattern
    -- in frontend/lib/alerts/push-rules-to-gateway.ts.
    source_id           UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,

    -- Rule classification.
    type                alert_rule_type NOT NULL,

    -- Target metric. Required for threshold/outlier, NULL for compound
    -- (compound rules carry metrics on their sub_rules entries).
    metric              TEXT,

    -- Per-type evaluation parameters. Schema-free on purpose so we can
    -- add rule parameters without migrations; application-level
    -- validation in the Next.js API route mirrors validateRule (rules.go).
    --
    -- threshold: { "min": number?, "max": number? }
    -- outlier:   { "z_score": number?, "min_samples": int? }
    -- compound:  {} (all state lives in sub_rules below)
    conditions          JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Compound-rule operator. NULL for non-compound.
    operator            alert_rule_operator,

    -- Compound-rule sub-rules. NULL or empty for non-compound. Shape:
    --   [{ "type": "threshold"|"outlier", "metric": "...", "conditions": {...} }, ...]
    -- 1–20 entries. Sub-rule types cannot themselves be compound.
    sub_rules           JSONB,

    -- Lifecycle config. NULL = inherit alert-service defaults
    -- (hysteresis 30s, cooldown 60s at time of writing; see
    -- alert-service/config.go:AlertDefaults).
    hysteresis_seconds  INTEGER CHECK (hysteresis_seconds >= 0),
    cooldown_seconds    INTEGER CHECK (cooldown_seconds   >= 0),

    -- Severity label, carried through to transitions and on into the
    -- alerts rows. Free-form to match the Go side.
    severity            TEXT NOT NULL DEFAULT 'warning',

    -- Soft delete / disable without losing the row.
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Schema-level guardrail: compound XOR (threshold | outlier). The
    -- application layer does the richer check.
    CONSTRAINT alert_rules_type_shape CHECK (
        (type = 'compound'   AND metric IS NULL      AND operator IS NOT NULL AND sub_rules IS NOT NULL)
        OR
        (type IN ('threshold','outlier') AND metric IS NOT NULL AND operator IS NULL      AND sub_rules IS NULL)
    )
);

-- Bootstrap query hits this hard: GET /api/internal/alerts/rules/all.
-- Filter by enabled=true at the query, not in the index, so toggling
-- a rule doesn't churn the index.
CREATE INDEX idx_alert_rules_org          ON alert_rules(org_id) WHERE enabled;
CREATE INDEX idx_alert_rules_org_source   ON alert_rules(org_id, source_id) WHERE enabled;

-- Keep updated_at fresh on every mutation.
CREATE TRIGGER trg_alert_rules_updated_at
BEFORE UPDATE ON alert_rules
FOR EACH ROW EXECUTE FUNCTION update_alerts_updated_at();  -- reuse existing trigger fn

-- RLS. Service-role bypasses; user-scoped queries see only their org.
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY alert_rules_org_read
ON alert_rules FOR SELECT
USING (org_id = current_setting('request.jwt.claims', true)::json->>'org_id');

CREATE POLICY alert_rules_org_write
ON alert_rules FOR ALL
USING  (org_id = current_setting('request.jwt.claims', true)::json->>'org_id')
WITH CHECK (org_id = current_setting('request.jwt.claims', true)::json->>'org_id');
```

### Field mapping — `alert_rules` row → wire `AlertRule`

The two shapes are deliberately close but not identical. The mapping:

| `alert_rules` column | Wire field | Notes |
|---|---|---|
| `id` | `id` | Straight copy. |
| `org_id` | `org_id` | Straight copy. |
| `source_id` (UUID) | `source_id` (slug) | **Translate.** JOIN `sources.slug` where `sources.id = alert_rules.source_id` during serialization. |
| `type` | `type` | Enum value as string. |
| `metric` | `metric` | Omit when NULL (compound rules). |
| `conditions` | `conditions` | JSONB → JSON object. Omit when `{}`. |
| `operator` | `operator` | Enum value as string. Omit when NULL. |
| `sub_rules` | `rules` | **Rename.** Wire field is `rules`, not `sub_rules`. |
| `hysteresis_seconds` | `hysteresis_seconds` | Omit (or send 0) when NULL → alert-service falls back to defaults. |
| `cooldown_seconds` | `cooldown_seconds` | Same as above. |
| `severity` | `severity` | Straight copy. |
| `enabled` | *(not on wire)* | Filter `WHERE enabled` before serializing; disabled rules just aren't sent. |

### Handling transitions — where do they go?

The transitions POST (`POST /api/internal/alerts/transitions`, §3 above)
should write into the **existing `alerts` table**, not a new one. The
existing table's columns line up well:

| `Transition` wire field | `alerts` column | Notes |
|---|---|---|
| `rule_id` | *(none)* | No current column. Add `rule_id UUID REFERENCES alert_rules(id)` in the same migration as `alert_rules`. |
| `org_id` | `org_id` | |
| `source_id` (slug) | `source_id` (UUID) | **Translate back.** Resolve slug → UUID via `sources` before insert. |
| `metric` | `metric` | |
| `state`=`open` | `is_alert_active`=true, `triggered_at`=timestamp | Insert new row. The condition axis is `is_alert_active`, not `status`. |
| `state`=`closed` | `is_alert_active`=false, `closed_at`=timestamp (+ optional `alert_stats`), and — unless a human already resolved — `status`='resolved', `resolved_at`=timestamp | Update the active row for the same `(rule_id, source_id)`. A cleared condition IS a resolved alert; `resolved_by` stays NULL to mark it a machine close, and an earlier human resolve (`status='resolved'`) is never overwritten. |
| `value` | `value` | |
| `threshold` | `threshold` | |
| `z_score` | *(none)* | Optional: add a `z_score NUMERIC` column, or stash in `context_snapshot` JSON. |
| `severity` | `severity` | |
| `distribution` | `context_snapshot` (JSONB) | Embed the full `DistSnapshot` here; it's context, not a first-class field. |
| `timestamp` | `triggered_at` / `closed_at` | Per state, above. |

Plus: record an `alert_events` (Supabase) activity-timeline row for each
transition — `event_type='triggered'` on open, `event_type='resolved'` on
close — so the UI's alert history view picks up the automation without a
second write path. Synthetic closes (`reason` set, see the `Transition`
schema) log why they closed instead of fabricating a clearing value.

### Open-close matching

To close the right `alerts` row when a `closed` transition arrives, Next.js
needs an active row for the same `(org_id, rule_id, source_id)` — matched on
`is_alert_active=true`, **not** `status`. The composite partial index that
enforces this:

```sql
CREATE UNIQUE INDEX idx_alerts_one_open_per_rule_source
ON alerts(org_id, rule_id, source_id)
WHERE is_alert_active = TRUE AND rule_id IS NOT NULL;
```

This enforces "at most one active alert per `(rule, source)` at a time",
which matches the alert-service state machine's guarantee. If a `closed`
arrives with no matching active row (e.g. after a DB restore or a dropped
`open` batch), treat it as a no-op and log — don't invent a resolved row
out of thin air.

### Migration strategy for existing `source_limits` rows

You probably want to backfill every existing `source_limits` row as an
`alert_rules` row of `type='threshold'` so that users who configured
gateway-side limits automatically get alert-service alerts too.

```sql
INSERT INTO alert_rules (org_id, source_id, type, metric, conditions, severity)
SELECT
    sl.org_id,
    sl.source_id,
    'threshold'::alert_rule_type,
    sl.metric,
    jsonb_strip_nulls(jsonb_build_object('min', sl.min, 'max', sl.max)),
    sl.severity::text
FROM source_limits sl
WHERE sl.min IS NOT NULL OR sl.max IS NOT NULL;
```

**Decide before running this**: do you want the backfilled rules to fire
real alerts immediately, or come in `enabled=FALSE` for a review pass
first? The latter is safer — a legacy `source_limits` row set to a
too-tight threshold could flood the notifier on its first evaluation.

### What the Next.js endpoints look like against this schema

- `GET /api/internal/alerts/rules/all` → `SELECT ... FROM alert_rules JOIN
  sources ON ... WHERE alert_rules.enabled`, grouped by `org_id`, shaped
  into the `{orgs: {<id>: {rules: [...]}}}` envelope per §1. Use the
  service-role client so RLS doesn't silently scope it to the caller.
- `POST /internal/alerts/rules/{ruleId}` (or whatever the product-facing
  route is) does the Supabase mutation, then calls
  `pushRulesToAlertService(orgId)` — that helper runs the same SELECT
  scoped to one org, builds the body, and POSTs to alert-service per §2.
- `POST /api/internal/alerts/transitions` reads the body per §3, does the
  open/close matching above, writes to `alerts` and `alert_events`,
  returns 204. Respond fast — the alert-service client timeout is 5s.

## Changelog

- *2026-08-13* — Alert close-out overhaul. A `closed` transition now also
  sets `status='resolved'` + `resolved_at` (machine close, `resolved_by`
  NULL; a prior human resolve is never overwritten) and logs its timeline
  row as `event_type='resolved'`. Added the fifth boundary endpoint
  `GET /api/internal/alerts/active` and the reconcile loop (§5) that
  synthetically closes DB-active alerts stranded by restarts or dropped
  `closed` batches. Added the optional `reason` field to `Transition`
  (`rule_deleted` | `reconciled`). Bootstrap (`rules/all`) now filters to
  threshold/outlier/compound like the push path — offline rules no longer
  ship to the alert-service at boot.
- *2026-07-27* — Documented the fourth boundary endpoint `GET /stats`
  (LiveStats) and the `GET /health` alias of `/readyz`. Corrected the
  bootstrap 401 row: all failures are retried uniformly on the
  `1/2/4/8/16s` schedule (there is no fail-fast 401 branch). Documented
  rule-deletion behavior: a push that removes a rule synthetically closes
  its open alert. Replaced stale `file:line` references with
  `file + symbol` references.
- *2026-04-15* — Initial version. Extracted from Go source at `rules.go`,
  `notifier.go`, `state.go`, `distribution.go`. Added Supabase schema
  section with recommended `alert_rules` table.
