# AGENTS.md — frontend

**Product web app + control plane** (Next.js App Router) → `app.plexus.company`.
Owns auth (Auth.js), RBAC, API-key minting, billing (Stripe), dashboards, monitors/
alerts. Two jobs that other components depend on:
1. **Queries ClickHouse directly** as `nextjs_reader` (`/api/telemetry/query`) — the product
   UI's read path (separate from the `api/` public API).
2. **Serves the gateway's auth callbacks** — `/api/auth/{verify-key,verify-session,verify-share}`,
   `/api/internal/sources/recording`. Changing these paths/shapes breaks ingest + live auth.

Metadata store: Postgres via Drizzle/node-postgres (`DATABASE_URL`; the Supabase
client is retired) — `api_keys`, orgs, dashboards, alerts, RBAC.
Billing: three Stripe meters — `plexus_metrics` + `plexus_logs` + `plexus_video_hours`
(`STRIPE_PRICE_ID_METRICS`/`_LOGS`/`_VIDEO_HOURS`, see `lib/stripe.ts`).
Deploy: **Fly `plexus-frontend` is canonical** — the background loops in
`instrumentation.ts` (offline/poll/discovery) need an always-on machine, which
serverless Vercel can't provide. The Vercel project config is vestigial.

**OAuth 2.1 authorization server** (for the MCP connector at
`api.plexus.company/mcp`, e.g. claude.ai custom connectors): metadata at
`/.well-known/oauth-authorization-server`, DCR at `/api/oauth/register`,
consent page `/oauth/authorize` (session-gated; approve = `/api/oauth/authorize`,
admin/editor), token exchange `/api/oauth/token` (PKCE S256, public clients
only). **Access tokens ARE org-scoped `plx_` keys** minted at exchange into
`api_keys` — billing gating and revocation ride the existing machinery.
Tables `oauth_clients` / `oauth_authorization_codes`; queries + PKCE in
`lib/db/queries/oauth.ts`; shared helpers `lib/oauth/http.ts` (these routes
carry their own CORS — the app has no global CORS). The three anonymous
endpoints are in middleware's `PUBLIC_ROUTE_PATTERNS`; forgetting that breaks
them as silent sign-in redirects.

Workspace map: `../ARCHITECTURE.md`; canonical hosts/terms: `../GLOSSARY.md`.

## Testing

Tests use vitest against a real Postgres (`plexus_test` DB, same Docker container
as dev). `npm test` auto-creates the test DB, runs migrations, and truncates
between tests. Requires `docker compose up -d postgres`. Tests run sequentially
(`fileParallelism: false`) — no parallel DB access. `server-only` is stubbed via
vitest alias; `@/` path alias resolved in `vitest.config.ts`.

## ORM notes

- `createOrgQueries(table)` in `lib/db/queries/shared.ts` takes a Drizzle table
  object (not a string name). Still uses `<T, TNew>` type params from
  `lib/db/types.ts` — full Drizzle `$inferSelect` migration is deferred (111
  downstream type errors, needs route-level test coverage first).
- Alert state transitions (`acknowledge`/`resolve`/`reopen`) in
  `app/api/alerts/[id]/route.ts` wrap update + event creation in
  `db.transaction` for session auth. API-key path does not (admin queries
  lack `tx` support).
- `lib/db/types.ts` (2761 lines) and `lib/db/server.ts` (1850 lines) are
  candidates for splitting — deferred, not blocking.
- Every new `pgTable` must chain `.enableRLS()`. The app connects as the table
  owner so RLS never filters app queries, but the DB is Supabase-hosted:
  a `public` table without RLS is readable/writable via PostgREST with the
  anon key (Supabase linter flags it as an EXTERNAL security error).
