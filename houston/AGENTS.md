# AGENTS.md — houston

**Alert engine** (Go) → Fly `plexus-alert-service` (internal-only, no public
hostname). Evaluates device threshold/outlier rules against live telemetry by
XREADGROUP-ing the Redis stream (consumer group `alerts`), keeps per-rule FSM
state (IDLE→OPEN→CLOSING→CLOSED→COOLDOWN), and reports transitions to the
frontend. It does NOT handle connection/event/offline monitors — those run in
the frontend's poll loops.

**Do-not-break contracts:**
- **Redis v:2 envelope** — parsed in `redis.go`; the gateway writes it, the
  ch-loader parses it independently. Format changes touch all three.
- **Frontend wire spec** — `CONTRACT.md` is the authoritative doc for the four
  endpoints crossing the frontend↔houston boundary (rules push via
  `/internal/rules/*` with `x-internal-secret`, transition reporting back).
  Frontend side: `frontend/lib/alerts/push-rules-to-alert-service.ts`.
- **Circuit breaker semantics** — only connectivity failures may open the
  shared breaker; Redis *reply* errors (e.g. NOGROUP after a restart) must
  not (`redis_test.go` documents the incident that rule comes from).

Tests are hermetic (`go test -race ./...` — no Redis/ClickHouse needed); CI is
`.github/workflows/houston-ci.yml`. Deep dives: `README.md` (run/deploy),
`ARCHITECTURE.md`, `CONTRACT.md`, `DEPLOY.md`. Workspace map:
`../ARCHITECTURE.md`; canonical hosts/terms: `../GLOSSARY.md`.
