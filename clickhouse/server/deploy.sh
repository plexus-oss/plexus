#!/usr/bin/env bash
#
# deploy.sh — first-deploy and update script for plexus-ch (ClickHouse
# server + embedded Keeper) on Fly.io.
#
# Usage:
#   ./deploy.sh init      # First-time setup: app, Tigris bucket, volume, secrets, first deploy
#   ./deploy.sh deploy    # Build and deploy (default)
#   ./deploy.sh secrets   # Re-apply secrets from .env.deploy
#   ./deploy.sh schema    # Apply schema.sql through a fly proxy tunnel
#   ./deploy.sh status    # Show app status
#   ./deploy.sh logs      # Tail logs
#   ./deploy.sh health    # Curl the public /ping endpoint
#   ./deploy.sh ssh       # SSH into the running machine
#   ./deploy.sh rollback  # List releases, prompt for rollback
#   ./deploy.sh destroy   # Destroy the app (throwaway teardown)
#
# Requires:
#   - flyctl in PATH (`fly auth login` done)
#   - docker in PATH (local build smoke test)
#   - clickhouse-client in PATH for `schema` command
#   - A .env.deploy file with CH_PASSWORD + CH_REPLICATION_SECRET +
#     CH_WRITER/READER/ADMIN_PASSWORD_SHA256 (see .env.deploy.example;
#     NOT .env — that's for local compose dev)
#
# Idempotent — safe to re-run. Will skip steps already done.

set -euo pipefail

APP="plexus-ch"
ORG="plexus-725"
REGION="iad"
VOLUME_NAME="plexus_ch_data"
VOLUME_SIZE_GB=10
BUCKET_NAME="plexus-ch"
ENV_FILE=".env.deploy"
SCHEMA_FILE="schema.sql"
PUBLIC_URL="https://${APP}.fly.dev"

# Colors
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
BLUE=$'\033[0;34m'
BOLD=$'\033[1m'
NC=$'\033[0m'

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

log()   { printf "%s==>%s %s\n"     "$BLUE$BOLD"  "$NC$BOLD"  "$*$NC"; }
ok()    { printf "%s✓%s  %s\n"      "$GREEN"      "$NC"       "$*"; }
warn()  { printf "%s!%s  %s\n"      "$YELLOW"     "$NC"       "$*"; }
fail()  { printf "%s✗%s  %s\n" >&2  "$RED"        "$NC"       "$*"; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

confirm() {
  local prompt="${1:-Continue?}"
  read -r -p "$prompt [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { warn "Aborted."; exit 1; }
}

app_exists() {
  fly apps list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$1"
}

volume_exists() {
  fly volumes list -a "$1" 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$2"
}

# Storage is idempotent via secrets — `fly storage create` stages
# AWS_ACCESS_KEY_ID on the app, so its presence proves the bucket exists.
tigris_bucket_exists() {
  fly secrets list -a "$1" 2>/dev/null | grep -q '^AWS_ACCESS_KEY_ID'
}

cd "$(dirname "$0")"

# -----------------------------------------------------------------------------
# Commands
# -----------------------------------------------------------------------------

cmd_build_local() {
  log "Running local Docker build smoke test"
  docker build -t plexus-ch-local . >/dev/null
  local size
  size=$(docker image inspect plexus-ch-local --format='{{.Size}}' | awk '{printf "%.1f MB\n", $1/1024/1024}')
  ok "Local build succeeded ($size)"
}

cmd_init() {
  require fly
  require docker

  log "Initial setup for $APP in $ORG ($REGION)"
  cmd_build_local

  # ---------- App ----------
  if app_exists "$APP"; then
    ok "$APP already exists"
  else
    log "Creating Fly app: $APP"
    fly apps create "$APP" --org "$ORG"
    ok "$APP created"
  fi

  # ---------- Tigris bucket ----------
  if tigris_bucket_exists "$APP"; then
    ok "Tigris bucket $BUCKET_NAME already provisioned (AWS_* secrets present)"
  else
    log "Creating Tigris bucket $BUCKET_NAME"
    fly storage create -n "$BUCKET_NAME" -a "$APP" --yes
    ok "Tigris bucket created (AWS_* secrets auto-staged)"
  fi

  # ---------- Volume ----------
  if volume_exists "$APP" "$VOLUME_NAME"; then
    ok "Volume $VOLUME_NAME already exists on $APP"
  else
    log "Creating volume $VOLUME_NAME (${VOLUME_SIZE_GB} GB) in $REGION"
    fly volumes create "$VOLUME_NAME" --region "$REGION" --size "$VOLUME_SIZE_GB" -a "$APP" --yes
    ok "Volume created"
  fi

  # ---------- Secrets ----------
  cmd_secrets

  # ---------- First deploy ----------
  cmd_deploy

  log "First-deploy complete. Next steps:"
  echo
  echo "  1. Apply schema:  ./deploy.sh schema"
  echo "  2. Smoke test:    ./deploy.sh health"
  echo "  3. Watch logs:    ./deploy.sh logs"
  echo "  4. Public URL:    $PUBLIC_URL"
  echo
}

cmd_secrets() {
  require fly
  [[ -f "$ENV_FILE" ]] || fail "$ENV_FILE not found. Create it: cp .env.deploy.example .env.deploy, then edit."

  log "Setting secrets on $APP from $ENV_FILE"

  # Build K=V pairs from the env file, ignoring comments and blanks.
  local -a secrets_args=()
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    # Strip surrounding quotes if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    secrets_args+=("$key=$value")
  done < <(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$')

  [[ ${#secrets_args[@]} -eq 0 ]] && fail "$ENV_FILE has no variables to set"

  fly secrets set -a "$APP" "${secrets_args[@]}"
  ok "Secrets applied (${#secrets_args[@]} variables)"
}

cmd_deploy() {
  require fly
  require docker

  cmd_build_local
  log "Deploying $APP"
  fly deploy -a "$APP"
  ok "Server deployed"

  log "Waiting for /ping to return 200..."
  for i in {1..20}; do
    if curl -sfm 5 "$PUBLIC_URL/ping" >/dev/null 2>&1; then
      ok "Server is healthy"
      return 0
    fi
    sleep 3
  done
  warn "Health check did not return 200 within 60 seconds. Run: ./deploy.sh health"
}

cmd_schema() {
  require fly
  require clickhouse-client

  [[ -f "$SCHEMA_FILE" ]] || fail "$SCHEMA_FILE not found"
  [[ -f "$ENV_FILE" ]]   || fail "$ENV_FILE not found (need CH_PASSWORD)"

  local ch_password
  ch_password=$(awk -F= '/^CH_PASSWORD=/ {sub(/^CH_PASSWORD=/, ""); gsub(/^["'\'']|["'\'']$/, ""); print; exit}' "$ENV_FILE")
  [[ -z "$ch_password" ]] && fail "CH_PASSWORD not found in $ENV_FILE"

  log "Starting fly proxy to $APP:8123"
  fly proxy 8123 -a "$APP" >/dev/null 2>&1 &
  local proxy_pid=$!
  trap "kill $proxy_pid 2>/dev/null || true" EXIT

  # Wait for the tunnel to accept connections (telemetry_writer via 6PN)
  for i in {1..10}; do
    if curl -sfm 2 -u "telemetry_writer:$ch_password" \
         "http://127.0.0.1:8123/?query=SELECT+1" >/dev/null 2>&1; then
      ok "Proxy tunnel ready"
      break
    fi
    sleep 1
  done

  log "Applying $SCHEMA_FILE as telemetry_writer"
  clickhouse-client --host=127.0.0.1 --port=8123 \
    --user=telemetry_writer --password="$ch_password" \
    --multiquery < "$SCHEMA_FILE"
  ok "Schema applied"

  kill "$proxy_pid" 2>/dev/null || true
  trap - EXIT
}

cmd_status() {
  require fly
  log "$APP"
  fly status -a "$APP" || true
}

cmd_logs() {
  require fly
  log "Tailing logs for $APP (Ctrl+C to stop)"
  fly logs -a "$APP"
}

cmd_health() {
  local url="$PUBLIC_URL/ping"
  log "GET $url"
  local code
  code=$(curl -sfm 5 -o /dev/null -w "%{http_code}" "$url" || echo "000")
  if [[ "$code" == "200" ]]; then
    ok "$url → $code"
  else
    warn "$url → $code"
  fi
}

cmd_ssh() {
  require fly
  log "SSH into $APP"
  fly ssh console -a "$APP"
}

cmd_rollback() {
  require fly
  log "Recent releases for $APP"
  fly releases -a "$APP" | head -20
  echo
  read -r -p "Enter version to roll back to (e.g. v42): " version
  [[ -z "$version" ]] && fail "No version entered"
  confirm "Roll back $APP to $version?"
  fly releases rollback "$version" -a "$APP"
  ok "Rollback initiated"
}

cmd_destroy() {
  require fly
  warn "This destroys $APP AND its volume, Tigris bucket, and all data."
  confirm "Really destroy $APP?"
  fly apps destroy "$APP" --yes
  ok "$APP destroyed"
}

cmd_help() {
  sed -n '3,24p' "$0" | sed 's/^# \{0,1\}//'
}

# -----------------------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------------------

case "${1:-deploy}" in
  init)     cmd_init ;;
  deploy)   cmd_deploy ;;
  secrets)  cmd_secrets ;;
  schema)   cmd_schema ;;
  status)   cmd_status ;;
  logs)     cmd_logs ;;
  health)   cmd_health ;;
  ssh)      cmd_ssh ;;
  rollback) cmd_rollback ;;
  destroy)  cmd_destroy ;;
  build)    cmd_build_local ;;
  help|-h|--help) cmd_help ;;
  *)        fail "Unknown command: $1. Try: ./deploy.sh help" ;;
esac
