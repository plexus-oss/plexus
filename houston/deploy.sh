#!/usr/bin/env bash
#
# deploy.sh — first-deploy and update script for plexus-alert-service on Fly.io.
#
# Usage:
#   ./deploy.sh init      # First-time setup: create app, volume, secrets, deploy
#   ./deploy.sh deploy    # Build and deploy (default)
#   ./deploy.sh secrets   # Re-apply secrets from .env.deploy
#   ./deploy.sh status    # Show app status and recent machines
#   ./deploy.sh logs      # Tail logs
#   ./deploy.sh health    # SSH into a machine and curl /readyz
#   ./deploy.sh rollback  # List releases, prompt for rollback
#   ./deploy.sh build     # Local Docker build smoke test only
#
# Requires:
#   - flyctl in PATH (`fly auth login` done)
#   - docker in PATH (for local build check)
#   - .env.deploy with production secrets (NOT .env — that's dev)
#
# Idempotent — safe to re-run. Will skip steps that are already done.
#
# This service is internal-only (no public hostname). Health checks go
# through `flyctl ssh` since /readyz isn't reachable from the outside.

set -euo pipefail

APP="plexus-alert-service"
ORG="plexus-725"
REGION="iad"
VOLUME_NAME="alert_cache"
VOLUME_SIZE_GB=1
ENV_FILE=".env.deploy"

# Colors
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
BLUE=$'\033[0;34m'
BOLD=$'\033[1m'
NC=$'\033[0m'

# ─── Helpers ─────────────────────────────────────────────────────────

log()   { printf "%s==>%s %s\n"    "$BLUE$BOLD" "$NC$BOLD" "$*$NC"; }
ok()    { printf "%s✓%s  %s\n"     "$GREEN"     "$NC"      "$*"; }
warn()  { printf "%s!%s  %s\n"     "$YELLOW"    "$NC"      "$*"; }
fail()  { printf "%s✗%s  %s\n" >&2 "$RED"       "$NC"      "$*"; exit 1; }

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

cd "$(dirname "$0")"

# ─── Commands ────────────────────────────────────────────────────────

cmd_build_local() {
  log "Running local Docker build smoke test"
  docker build -t plexus-alert-service-local . >/dev/null
  local size
  size=$(docker image inspect plexus-alert-service-local --format='{{.Size}}' | awk '{printf "%.1f MB\n", $1/1024/1024}')
  ok "Local build succeeded ($size)"
}

cmd_init() {
  require fly
  require docker

  log "Initial setup for $APP"
  cmd_build_local

  if app_exists "$APP"; then
    ok "$APP already exists"
  else
    log "Creating Fly app: $APP"
    fly launch --no-deploy --copy-config --name "$APP" --org "$ORG" --region "$REGION" --ha=false --yes
    ok "$APP created"
  fi

  if volume_exists "$APP" "$VOLUME_NAME"; then
    ok "Volume $VOLUME_NAME already exists on $APP"
  else
    log "Creating volume $VOLUME_NAME (${VOLUME_SIZE_GB} GB) on $APP"
    fly volumes create "$VOLUME_NAME" --region "$REGION" --size "$VOLUME_SIZE_GB" -a "$APP" --yes
    ok "Volume created"
  fi

  cmd_secrets
  cmd_deploy

  log "First-deploy complete. Next steps:"
  echo
  echo "  1. Verify health:  ./deploy.sh health"
  echo "  2. Watch logs:     ./deploy.sh logs"
  echo "  3. Metrics UI:     https://fly-metrics.net  (app: $APP)"
  echo "  4. Confirm Next.js can reach: http://$APP.internal:8081/livez"
  echo
}

cmd_secrets() {
  require fly
  [[ -f "$ENV_FILE" ]] || fail "$ENV_FILE not found. Create it: cp .env.deploy.example .env.deploy, then edit."

  log "Setting secrets on $APP from $ENV_FILE"

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
  ok "Deploy complete"

  log "Fetching status"
  fly status -a "$APP" || true
}

cmd_status() {
  require fly
  fly status -a "$APP"
}

cmd_logs() {
  require fly
  log "Tailing logs for $APP (Ctrl+C to stop)"
  fly logs -a "$APP"
}

cmd_health() {
  require fly
  log "Running /readyz check via flyctl ssh (service is internal-only)"
  # BusyBox wget is available in the alpine base image.
  fly ssh console -a "$APP" -C 'wget -qO- http://localhost:8081/readyz' || {
    warn "Health check failed. Try: ./deploy.sh logs"
    exit 1
  }
  echo
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

cmd_help() {
  sed -n '3,23p' "$0" | sed 's/^# \{0,1\}//'
}

# ─── Dispatch ────────────────────────────────────────────────────────

case "${1:-deploy}" in
  init)     cmd_init ;;
  deploy)   cmd_deploy ;;
  secrets)  cmd_secrets ;;
  status)   cmd_status ;;
  logs)     cmd_logs ;;
  health)   cmd_health ;;
  rollback) cmd_rollback ;;
  build)    cmd_build_local ;;
  help|-h|--help) cmd_help ;;
  *)        fail "Unknown command: $1. Try: ./deploy.sh help" ;;
esac
