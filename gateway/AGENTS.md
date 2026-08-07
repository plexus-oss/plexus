# AGENTS.md — gateway

**Real-time ingress/egress plane** (Go) → `gateway.plexus.company` (Fly `plexus-gateway`,
Redis sidecar Fly `plexus-gateway-redis`). Terminates device WS (`/ws/device`) and browser
WS (`/ws/browser`), accepts HTTP ingest (`POST /ingest`), fans telemetry out via Redis
Streams. Pure data movement — no alert evaluation (that's houston), no storage (that's
clickhouse).

**Do-not-break contracts:**
- **Ingest wire** — device WS frames + `POST /ingest` bodies validated in `validate.go`;
  SDKs (plexus-python/-c/-typescript) all speak this.
- **Redis v:2 envelope** — one XADD per batch into `telemetry.stream:{org}`; external
  consumers (houston alert service, ch-loader) XREADGROUP it directly. The gateway's own
  fan-out group is per-instance `dashboard:<instanceID>` (`gateway_config.go`).
- **Frontend auth callbacks** — `GET {PLEXUS_API_URL}/api/auth/verify-key`,
  `/api/auth/verify-session`, `/api/auth/verify-share` (`auth.go`); changing the frontend
  routes or response shapes breaks all connection auth.
- **`POST /internal/command`** — server-to-server typed-command relay, `x-internal-secret`
  auth (`main.go:85`).

Deep dives: `README.md` (run/deploy) + `ARCHITECTURE.md` (protocols, auth, security model).
Workspace map: `../ARCHITECTURE.md`; canonical hosts/terms: `../GLOSSARY.md`; verified
component graph: `../graph/`.
