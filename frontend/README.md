# Plexus Platform

![License: Elastic 2.0](https://img.shields.io/badge/license-Elastic%202.0-blue)

> HardwareOps

Plexus is a HardwareOps platform built specifically for teams working with physical systems—robotics, medical devices, industrial sensors, and aerospace telemetry. Monitor, analyze, and understand your hardware data in real-time.

## Why Plexus?

**Built for Hardware Teams**: Unlike generic observability tools designed for web apps and microservices, Plexus understands the unique challenges of physical systems—high-frequency sensor data, real-time telemetry, and mission-critical monitoring.

**GPU-Accelerated Visualization**: Built on Plexus UI components, handle millions of data points with smooth 60fps rendering. Visualize high-frequency telemetry without compromising performance.

## Features

- **Real-Time Dashboards** - Monitor your systems with GPU-accelerated charts
- **Flexible Data Sources** - Connect sensors, satellites, robots, medical devices, and more
- **Custom Dashboards** - Build visualizations using Plexus UI components
- **Fleet Management** - Register, configure, and send commands to devices remotely

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Docker (for the local Postgres) and a PostgreSQL **client v17+** (`psql`/`pg_dump`).
  The source (Supabase) is on Postgres 17, and `pg_dump` must be ≥ the source's
  major version. On macOS: `brew install postgresql@17`. The local container is
  pinned to 17 to match.

### Installation

```bash
# Clone the repository
git clone
cd frontend

# Install dependencies
npm install

# Set up environment variables: create .env.local (gitignored) and fill in the
# variables documented under "Environment Variables" and "Local database" below.

# Bring up a fresh local database (Postgres + migrations)
npm run db:up
# Optional: seed it with real data from a source db (see "Local database")
npm run db:seed -- "<source-database-url>"
# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the platform.

### Local database

The app's control-plane data lives in Postgres. For local development we run it
in Docker and seed it from prod (telemetry lives in ClickHouse and video in
Tigris, so this DB is small — a full pull is quick). It's **ephemeral** — there's
no volume, so a full teardown wipes it; that's fine, you can always re-seed.

```bash
npm run db:up                        # start a FRESH Postgres + run migrations (no seed)
npm run db:seed -- <source-url>      # optional: copy <source-url>'s data into the local db
npm run db:down                      # stop Postgres (survives stop/start; gone on full teardown)
```

There's **one** connection var, `DATABASE_URL` — the local database, read by the
app (Next.js loads `.env.local`) and by the scripts (they auto-load `.env.local`
too). Put it there once:

```bash
# in .env.local
DATABASE_URL=postgres://postgres:postgres@localhost:5432/plexus
```

The **seed source is a CLI argument**, not an env var — point it at prod,
staging, wherever:

```bash
npm run db:seed -- "postgresql://user:pass@prod-host:5432/plexus"
# or directly:  ./scripts/db/seed.sh "postgresql://…"
```

`db:up` always gives you a **fresh** database — it never seeds. Seeding is a
separate, optional step: `seed.sh` copies the whole `public` schema + data from
the source into `DATABASE_URL` (it drops + recreates `public`, so re-running it
is also how you reset). So — **want fresh?** `db:up`. **Want data?** `db:up`,
then `db:seed -- <source-url>`.

A fresh `db:up` applies the Drizzle baseline, so you get the full schema (empty
tables). Run `db:seed` when you also want data.

### Database migrations (Drizzle)

The schema is managed with [Drizzle](https://orm.drizzle.team). **`lib/db/schema.ts`
is the source of truth** — a TypeScript model of every table. To change the
schema, edit that file (not raw SQL).

Everyday workflow:

```bash
# 1. edit lib/db/schema.ts (add a column, table, index…)
npm run db:generate                          # diffs schema.ts → writes a new migration
# 2. review the generated .sql, then apply it:
npm run db:migrate -- --env-file=.env.local  # local (explicit target)
```

**`db:migrate` is environment-relative.** It reads `DATABASE_URL` from the
ambient environment and loads **no** env file unless you pass `--env-file` — so
it can never silently hit the wrong database. It prints `[migrate] target:
<host>/<db>` before doing anything.

- **Local:** `npm run db:migrate -- --env-file=.env.local` (or just `db:up`,
  which exports `DATABASE_URL` from `.env.local` and migrates for you).
- **Prod (Fly):** applied automatically on every deploy. The Next `standalone`
  runtime image has no `tsx`/devDeps, so the Dockerfile bundles the migrator into
  a self-contained `migrate-runner.cjs` (esbuild, `db:bundle-migrator`) and ships
  it + the SQL files; `fly.toml`'s `[deploy] release_command = "node
  migrate-runner.cjs"` runs it (ambient `DATABASE_URL` from Fly secrets) before
  the new release takes traffic. No-op when already current.

Migrations are versioned and tracked in the `drizzle.__drizzle_migrations`
table, so each runs once.

> **Gotcha — `db:seed` vs migrations newer than prod.** `db:seed` drops `public`
> and restores a prod snapshot, but the `drizzle.__drizzle_migrations` ledger
> lives in a separate schema the seed doesn't touch. So after a seed, any
> migration created *after* the last prod deploy is absent from `public` yet still
> marked applied — `db:migrate` becomes a no-op and won't add it. Re-apply those
> few by hand, e.g.:
>
> ```bash
> docker exec -i plexus-postgres psql -U postgres -d plexus \
>   < lib/db/migrations/drizzle/0003_realtime_notify.sql
> ```
>
> Once those migrations are deployed to prod, a fresh seed includes them and the
> catch-up is no longer needed.

What's committed (all generated except `schema.ts`, which you hand-edit):

| Path | Role |
|---|---|
| `lib/db/schema.ts` | source of truth — hand-edited |
| `lib/db/relations.ts` | FK relations for the query API |
| `lib/db/migrations/drizzle/*.sql` | ordered migrations (`0000` is the baseline) |
| `lib/db/migrations/drizzle/meta/` | Drizzle's snapshots — generated, committed, **don't edit** |

**The baseline (`0000`)** was introspected once from prod (`db:pull`). **Don't
re-run `db:pull` casually** — it regenerates `schema.ts` from a database and
reintroduces drizzle-kit quirks we hand-fixed (the `tsvector` column, array
defaults, index operator classes). Treat `schema.ts` as hand-maintained now.

**Custom SQL** — functions, triggers, and views Drizzle can't model from
`schema.ts` — go in a hand-written migration:

```bash
npm run db:generate -- --custom --name=device_schema_fn   # empty migration; write raw SQL into it
```

This is how the `upsert_device_schemas` function and the `updated_at` triggers
(not captured by introspection) get re-added.

> The legacy `lib/db/migrations/supabase/*.sql` files are historical reference
> only — they are **not** applied by this workflow.

## Realtime

UI freshness (SWR cache-busting + new-alert toasts) runs on **Postgres
LISTEN/NOTIFY → SSE**, not Supabase Realtime:

- A generic `notify_row_change()` trigger (migration `0003`) fires a tiny NOTIFY
  on the `row_change` channel for inserts/updates/deletes on the watched tables
  (`alerts`, `event_monitors`, `dashboards`, `sources`, `annotations`, `api_keys`,
  `source_limits`, `system_events`). Payload is `{table, op, org_id, id}` only.
- `lib/realtime/notify-listener.ts` holds **one** `LISTEN` connection per server
  process and fans events to in-process subscribers keyed by `org_id` (self-heals
  on drop). `app/api/realtime/stream` is the SSE endpoint — `getAuth`-scoped, so a
  browser only ever receives its own org's events.
- The browser shares **one** `EventSource` via `lib/realtime/use-realtime-events.ts`;
  consumers are `RealtimeInvalidationProvider` and `AlertNotifier`.

(Live device telemetry/video is separate — that streams over the gateway
WebSocket, not this channel.)

## Object storage

Dashboard icons and source-context files live in **Tigris** (S3-compatible),
accessed server-side via `lib/storage/s3.ts` (AWS SDK). Two buckets:
`dashboard-icons` (public-read, served via `publicUrl`) and `source-context`
(private, served via short-lived presigned GET URLs). All uploads/deletes go
through the API routes; clients never hold storage credentials. Existing Supabase
objects were moved over by a one-time backfill during the cutover; that script
(`scripts/storage/`) has since been removed.

## Connecting Data Sources

Plexus supports various data source types:

- **Satellite Telemetry** - TLE data, orbital positions, ground station passes
- **Sensor Networks** - Industrial IoT, environmental monitoring
- **Robotics** - Joint positions, IMU data, battery monitoring
- **Medical Devices** - ECG, vital signs, patient monitoring
- **Aerospace** - Flight test data, attitude indicators, engine parameters

Navigate to `/data` to connect your first data source.

## Building Custom Dashboards

Use the dashboard builder to:

1. Create a new dashboard
2. Add Plexus UI components (line charts, scatter plots, heatmaps, etc.)
3. Connect to your data sources
4. Configure real-time alerts

## Technology Stack

- **Framework**: Next.js 15 + React 19
- **Authentication**: Auth.js (NextAuth v5) — email OTP (magic-code) only
- **Database**: PostgreSQL via Drizzle ORM (node-postgres) — see "Database & migrations"
- **Object storage**: Tigris (S3-compatible) — dashboard icons + source-context files
- **Realtime**: Postgres LISTEN/NOTIFY → SSE (`/api/realtime/stream`)
- **Telemetry store**: ClickHouse (device data; the live stream comes over the gateway WebSocket)
- **Styling**: Tailwind CSS
- **Charts**: Plexus UI (WebGPU/WebGL2)
- **3D Visualization**: Three.js + React Three Fiber

> **Supabase is retired** from the runtime: the data layer is Drizzle/pg, storage
> is Tigris, and realtime is LISTEN/NOTIFY→SSE. The one-off Tigris backfill script
> is gone; `@supabase/supabase-js` remains in `package.json` as an unused
> dependency (imported nowhere) and can be dropped.

## Project Structure

```
frontend/
   app/                    # Next.js app router pages
      (product)/         # Signed-in product shell (route group)
         (internal)/    # Staff-only admin console
         dashboards/    # Dashboard views
         devices/       # Device detail & management
         data/          # Data source management
         connections/   # External database connections
         alerts/        # Alert configuration
         events/        # Event log
         terminal/      # Plexus Terminal agent
         profile/       # User profile
         settings/      # Org & account settings
      setup/             # Device onboarding script endpoint
      ...
   components/            # React components
      ui/               # shadcn/ui components
      ...
   lib/                  # Utilities and helpers
      db/               # Drizzle client, schema, migrations (drizzle/*.sql)
      realtime/         # LISTEN/NOTIFY hub + the browser EventSource hook
      storage/          # Tigris (S3) helpers
   scripts/
      db/               # local Postgres up/seed/migrate
```

## Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run linting
npm run db:up        # Start the local Postgres + migrate (see "Local database")
npm run db:seed      # Seed the local Postgres from a source url
npm run db:down      # Stop the local Postgres container
npm run db:generate  # Generate a migration from schema.ts (add --custom for raw SQL)
npm run db:migrate   # Apply pending migrations to ambient DATABASE_URL (-- --env-file=.env.local for local)
```

## Environment Variables

Required in **every** environment (dev + prod):

```bash
# Auth.js (NextAuth v5)
AUTH_SECRET=                   # signs the session cookie + hashes OTP codes
AUTH_URL=                      # e.g. https://app.plexus.company/api/authjs

# Supabase — retired: the app no longer uses it at runtime. Data is on
# Drizzle/pg (DATABASE_URL), storage is on Tigris, realtime is Postgres
# LISTEN/NOTIFY → SSE. The one-off Tigris backfill script has been removed, so
# these vars are now read by NO code and can be dropped (along with the unused
# @supabase/supabase-js dep). Listed here only because they may still linger in
# deploy config.
NEXT_PUBLIC_SUPABASE_URL=      # legacy — unused
SUPABASE_SERVICE_ROLE_KEY=     # legacy — unused

# Tigris object storage (S3-compatible; dashboard icons + source-context files)
# NOTE: the S3 endpoint (signed SDK ops) and the public-serving host are DIFFERENT
# domains. The endpoint rejects anonymous reads even on public buckets; public
# objects are served from <bucket>.t3.tigrisbucket.io.
TIGRIS_ENDPOINT=               # S3 API (signed) — optional, default https://fly.storage.tigris.dev
TIGRIS_PUBLIC_HOST=            # public serving host — optional, default t3.tigrisbucket.io
TIGRIS_ACCESS_KEY_ID=
TIGRIS_SECRET_ACCESS_KEY=
TIGRIS_BUCKET_ICONS=           # optional, default "dashboard-icons" (set the bucket PUBLIC in Tigris)
TIGRIS_BUCKET_CONTEXT=         # optional, default "source-context" (private; served via presigned GET)

# ClickHouse (telemetry store)
PLEXUS_CLICKHOUSE_URL=
PLEXUS_CLICKHOUSE_USER=
PLEXUS_CLICKHOUSE_PASSWORD=
PLEXUS_CLICKHOUSE_DATABASE=    # usually "plexus"

# Stripe metered billing (tier_1 only; tier_2 ignores these but they
# must still be present in prod since the build evaluates them lazily)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=         # signs /api/webhooks/stripe
STRIPE_PRICE_ID_METRICS=       # metered price id, meter=plexus_metrics ($0.10/M)
STRIPE_PRICE_ID_LOGS=          # metered price id, meter=plexus_logs ($0.10/M)
STRIPE_PRICE_ID_VIDEO_HOURS=   # metered price id, meter=plexus_video_hours ($0.25/hr)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Email (transactional — payment-failed, team-tier-breach, etc.)
RESEND_API_KEY=

# App URL (used in email links, CLI auth callback, OG tags)
NEXT_PUBLIC_APP_URL=https://app.plexus.company

# Cron auth (the external cron runner sends Authorization: Bearer $CRON_SECRET;
# the app deploys to Fly, not Vercel)
CRON_SECRET=
```

If any of the Stripe / Resend / ClickHouse / cron values are missing in
production, the corresponding routes fail silently or throw 500 only on
first hit. There's no boot-time check — most clients are constructed
lazily — so a missing var won't show up until a real request lands. Keep
this list aligned with `lib/stripe.ts`, `lib/integrations/email.ts`,
`lib/db/clickhouse.ts`, `app/api/cron/*`, and the two webhook handlers.

## Learn More

- **Marketing Site**: [plexus.company](https://plexus.company)
- **Documentation**: [docs.plexus.company](https://docs.plexus.company)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) before
submitting issues and pull requests.

## License

Plexus is source-available under the [Elastic License 2.0](./LICENSE) — all of
the code (free and enterprise features alike) is in the open, with enterprise
features unlocked by a license key.

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

See [../docs/licensing.md](../docs/licensing.md) for the plain-language guide to
what's free, what needs a key, and what ELv2 means for you.

---

**Questions?** Reach out to [@annschulte](https://github.com/annschulte)
