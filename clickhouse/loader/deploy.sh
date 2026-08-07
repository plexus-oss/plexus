#!/usr/bin/env bash
#
# deploy.sh — first-deploy and update script for plexus-ch-loader
# (Redis → ClickHouse batch inserter) on Fly.io.
#
# Usage:
#   ./deploy.sh init      # First-time setup: app, secrets, first deploy
#   ./deploy.sh deploy    # Build and deploy (default)
#   ./deploy.sh secrets   # Re-apply secrets from .env.deploy
#   ./deploy.sh status    # Show app status
#   ./deploy.sh logs      # Tail logs
#   ./deploy.sh health    # Curl the internal health endpoint via fly proxy
#   ./deploy.sh ssh       # SSH into the running machine
#   ./deploy.sh rollback  # List releases, prompt for rollback
#   ./deploy.sh destroy   # Destroy the app (tear-down)
#
# Requires:
#   - flyctl in PATH (`fly auth login` done)
#   - docker in PATH (local build smoke test)
#   - A .env.deploy file with REDIS_URL + CH_PASSWORD
#
# Idempotent — safe to re-run. Will skip steps already done.

set -euo pipefail

APP="plexus-ch-loader"
ORG="plexus-725"
REGION="iad"
ENV_FILE=".env.deploy"
HEALTH_PORT=8080

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

cd "$(dirname "$0")"

# -----------------------------------------------------------------------------
# Commands
# -----------------------------------------------------------------------------

cmd_build_local() {
  log "Running local Docker build smoke test"
  docker build -t plexus-ch-loader-local . >/dev/null
  local size
  size=$(docker image inspect plexus-ch-loader-local --format='{{.Size}}' | awk '{printf "%.1f MB\n", $1/1024/1024}')
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

  # ---------- Secrets ----------
  cmd_secrets

  # ---------- First deploy ----------
  cmd_deploy

  log "First-deploy complete. Next steps:"
  echo
  echo "  1. Watch logs:    ./deploy.sh logs"
  echo "  2. Check health:  ./deploy.sh health"
  echo "  3. SSH in:        ./deploy.sh ssh"
  echo
  echo "  The loader discovers telemetry.stream:* keys on gateway-redis"
  echo "  and writes to plexus.telemetry_dist on plexus-ch via 6PN. It"
  echo "  starts in pending-recovery mode (drains its PEL) and transitions"
  echo "  to live mode when drained."
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
  ok "Loader deployed"

  log "Machine state:"
  fly machine list -a "$APP" 2>&1 | tail -5
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
  require fly
  log "Starting fly proxy to $APP:$HEALTH_PORT"
  fly proxy "$HEALTH_PORT" -a "$APP" >/dev/null 2>&1 &
  local proxy_pid=$!
  trap "kill $proxy_pid 2>/dev/null || true" EXIT

  # Wait briefly for the proxy to be ready
  for i in 1 2 3 4 5 6 7 8; do
    if curl -sfm 2 "http://127.0.0.1:$HEALTH_PORT/" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  log "GET http://127.0.0.1:$HEALTH_PORT/"
  if command -v jq >/dev/null 2>&1; then
    curl -s "http://127.0.0.1:$HEALTH_PORT/" | jq .
  else
    curl -s "http://127.0.0.1:$HEALTH_PORT/"
    echo
  fi

  kill "$proxy_pid" 2>/dev/null || true
  trap - EXIT
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
  warn "This destroys $APP. Loader has no volume/state so there's nothing to lose."
  confirm "Really destroy $APP?"
  fly apps destroy "$APP" --yes
  ok "$APP destroyed"
}

cmd_help() {
  sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'
}

# -----------------------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------------------

case "${1:-deploy}" in
  init)     cmd_init ;;
  deploy)   cmd_deploy ;;
  secrets)  cmd_secrets ;;
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
