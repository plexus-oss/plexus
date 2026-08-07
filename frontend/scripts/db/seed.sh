#!/usr/bin/env bash
#
# Seed the local database from a source DB.
#
#   ./scripts/db/seed.sh <source-database-url>
#
# Copies the source's `public` schema + data into DATABASE_URL (the local app
# DB, auto-loaded from .env.local). The source is whatever you pass — point it
# at prod, staging, a teammate's box. Control-plane data only (telemetry lives
# in ClickHouse, video in Tigris), so the dump is small.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Load DATABASE_URL from .env.local if not already set (plain grep, no eval).
load_env_local() {
  local key="$1" file="$ROOT/.env.local" line
  [ -n "${!key:-}" ] && return 0
  [ -f "$file" ] || return 0
  line="$(grep -E "^${key}=" "$file" | tail -n1)" || return 0
  [ -n "$line" ] || return 0
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"; line="${line%\'}"; line="${line#\'}"
  export "${key}=${line}"
}
load_env_local DATABASE_URL

SOURCE_URL="${1:-}"
[ -n "$SOURCE_URL" ] || { echo "usage: $(basename "$0") <source-database-url>   (target is DATABASE_URL)"; exit 1; }
: "${DATABASE_URL:?set DATABASE_URL (env or .env.local) — the local target}"

# Resolve the pg client. The source (Supabase) is on Postgres 17 and pg_dump
# must be >= the source major. Homebrew's postgresql@17 is keg-only, so a fresh
# install won't put pg_dump on PATH — prefer the keg, else fall back to PATH
# (pg_dump emits a clear version-mismatch error if it's too old).
pg_bin() {
  local name="$1" p
  for p in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin; do
    [ -x "$p/$name" ] && { printf '%s\n' "$p/$name"; return; }
  done
  command -v "$name" 2>/dev/null
}
PG_DUMP="$(pg_bin pg_dump)"; PSQL="$(pg_bin psql)"
[ -n "$PG_DUMP" ] && [ -n "$PSQL" ] || { echo "error: pg_dump/psql not found (brew install postgresql@17)"; exit 1; }

DUMP_FILE="$(mktemp -t plexus-seed-dump.XXXXXX)"
trap 'rm -f "$DUMP_FILE"' EXIT

echo "▸ source server version:"
"$PSQL" "$SOURCE_URL" -tAc "show server_version;" | sed 's/^/    /'

echo "▸ dumping source public schema + data → temp file"
# --no-owner/--no-privileges: source roles don't exist locally.
# --no-publications/--no-subscriptions: drop any logical-replication wiring.
"$PG_DUMP" "$SOURCE_URL" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --no-publications \
  --no-subscriptions \
  --quote-all-identifiers \
  --file "$DUMP_FILE"

echo "▸ preparing target: $DATABASE_URL"
# The dump's CREATE POLICY statements reference roles (anon, authenticated,
# service_role, plus app-specific ones like data_api_role). Pre-create every
# role the dump names — dev-only no-login placeholders — so the restore doesn't
# fail on a missing role. A later cleanup migration drops the RLS that uses them.
# Also drop public WITHOUT recreating it: the dump carries its own
# `CREATE SCHEMA public` (Supabase customizes it), which would otherwise collide.
roles="$(grep -oE 'TO "[A-Za-z_][A-Za-z0-9_]*"' "$DUMP_FILE" | sed -E 's/^TO "//; s/"$//' | sort -u)"
{
  for r in anon authenticated service_role $roles; do
    printf 'DO $$ BEGIN CREATE ROLE "%s" NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;\n' "$r"
  done
  echo 'DROP SCHEMA IF EXISTS public CASCADE;'
} | "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1

echo "▸ restoring into target"
"$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$DUMP_FILE"

echo "✓ done → $DATABASE_URL"
