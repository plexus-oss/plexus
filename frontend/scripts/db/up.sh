#!/usr/bin/env bash
#
# Bring up the local dev database: start Postgres + run migrations. This gives a
# FRESH database. Seeding is separate and optional — run scripts/db/seed.sh
# (npm run db:seed -- <source-url>) when you want real data.
#
#   ./scripts/db/up.sh
#
# Target is DATABASE_URL (the local app DB, auto-loaded from .env.local).
# Needs: docker (migrations also need the toolchain once they exist).
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

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
: "${DATABASE_URL:?set DATABASE_URL (env or .env.local) — the local database}"

if command -v pnpm >/dev/null && [ -f pnpm-lock.yaml ]; then PM=pnpm; else PM=npm; fi

echo "▸ starting postgres (waiting for healthy)…"
# --renew-anon-volumes: the postgres image declares an anonymous volume for its
# data dir, which compose otherwise carries across recreates — so an image bump
# (e.g. 16→17) would drag incompatible data into the new container and fail to
# boot. Renewing on recreate keeps stop/start data but guarantees a clean dir on
# a version change. (Plain stop/start doesn't recreate, so data survives that.)
docker compose up -d --wait --renew-anon-volumes postgres

if [ -f drizzle.config.ts ]; then
  echo "▸ running migrations…"
  "$PM" run db:migrate
else
  echo "▸ no Drizzle migrations yet — database is empty"
fi

echo "✓ ready → $DATABASE_URL"
echo "  fresh db. to load data:  npm run db:seed -- <source-url>"
