#!/usr/bin/env bash
#
# deploy.sh — first-deploy and update script for the Plexus Gateway on Fly.io.
#
# Usage:
#   ./deploy.sh init      # First-time setup: create apps, volume, secrets
#   ./deploy.sh deploy    # Build and deploy gateway (default)
#   ./deploy.sh redis     # Build and deploy only the Redis sidecar
#   ./deploy.sh secrets   # Re-apply secrets from .env.deploy
#   ./deploy.sh status    # Show both apps' status
#   ./deploy.sh logs      # Tail gateway logs
#   ./deploy.sh health    # Curl the public /health endpoint
#   ./deploy.sh rollback  # List releases, prompt for rollback
#
# Requires:
#   - flyctl in PATH (`fly auth login` done)
#   - docker in PATH (for local build check)
#   - A .env.deploy file with production secrets (NOT .env — that's dev)
#
# Idempotent — safe to re-run. Will skip steps that are already done.

set -euo pipefail

GATEWAY_APP="plexus-gateway"
REDIS_APP="plexus-gateway-redis"
ORG="plexus-725"
REGION="iad"
VOLUME_NAME="redis_data"
VOLUME_SIZE_GB=3
ENV_FILE=".env.deploy"

# Colors
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
BLUE=$'\033[0;34m'
BOLD=$'\033[1m'
NC=$'\033[0m' # No Color

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

cd "$(dirname "$0")"

# -----------------------------------------------------------------------------
# Commands
# -----------------------------------------------------------------------------

cmd_build_local() {
  log "Running local Docker build smoke test"
  docker build -t plexus-gateway-local . >/dev/null
  local size
  size=$(docker image inspect plexus-gateway-local --format='{{.Size}}' | awk '{printf "%.1f MB\n", $1/1024/1024}')
  ok "Local build succeeded ($size)"
}

cmd_init() {
  require fly
  require docker

  log "Initial setup for $GATEWAY_APP and $REDIS_APP"
  cmd_build_local

  # ---------- Redis app ----------
  if app_exists "$REDIS_APP"; then
    ok "$REDIS_APP already exists"
  else
    log "Creating Fly app: $REDIS_APP"
    (cd redis && fly launch --no-deploy --copy-config --name "$REDIS_APP" --org "$ORG" --region "$REGION" --yes)
    ok "$REDIS_APP created"
  fi

  if volume_exists "$REDIS_APP" "$VOLUME_NAME"; then
    ok "Volume $VOLUME_NAME already exists on $REDIS_APP"
  else
    log "Creating volume $VOLUME_NAME (${VOLUME_SIZE_GB} GB) on $REDIS_APP"
    fly volumes create "$VOLUME_NAME" --region "$REGION" --size "$VOLUME_SIZE_GB" -a "$REDIS_APP" --yes
    ok "Volume created"
  fi

  log "Deploying Redis sidecar"
  (cd redis && fly deploy -a "$REDIS_APP")
  ok "Redis sidecar deployed"

  # ---------- Gateway app ----------
  if app_exists "$GATEWAY_APP"; then
    ok "$GATEWAY_APP already exists"
  else
    log "Creating Fly app: $GATEWAY_APP"
    fly launch --no-deploy --copy-config --name "$GATEWAY_APP" --org "$ORG" --region "$REGION" --ha=false --yes
    ok "$GATEWAY_APP created"
  fi

  cmd_secrets
  cmd_deploy

  log "First-deploy complete. Next steps:"
  echo
  echo "  1. Point DNS:   gateway.plexus.company → $GATEWAY_APP.fly.dev"
  echo "  2. Smoke test:  ./deploy.sh health"
  echo "  3. Watch logs:  ./deploy.sh logs"
  echo "  4. Metrics UI:  https://fly-metrics.net  (app: $GATEWAY_APP)"
  echo
}

cmd_secrets() {
  require fly
  [[ -f "$ENV_FILE" ]] || fail "$ENV_FILE not found. Create it: cp .env.deploy.example .env.deploy, then edit."

  log "Setting secrets on $GATEWAY_APP from $ENV_FILE"

  # Build -e flags from the env file, ignoring comments and blank lines.
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

  fly secrets set -a "$GATEWAY_APP" "${secrets_args[@]}"
  ok "Secrets applied (${#secrets_args[@]} variables)"
}

cmd_deploy() {
  require fly
  require docker

  cmd_build_local
  log "Deploying $GATEWAY_APP"
  fly deploy -a "$GATEWAY_APP"
  ok "Gateway deployed"

  log "Waiting for health check to pass..."
  for i in {1..20}; do
    if curl -sfm 5 "https://$GATEWAY_APP.fly.dev/health" >/dev/null 2>&1; then
      ok "Gateway is healthy"
      return 0
    fi
    sleep 3
  done
  warn "Health check did not return 200 within 60 seconds. Run: ./deploy.sh health"
}

cmd_redis() {
  require fly
  log "Deploying Redis sidecar ($REDIS_APP)"
  (cd redis && fly deploy -a "$REDIS_APP")
  ok "Redis sidecar deployed"
}

cmd_status() {
  require fly
  log "$GATEWAY_APP"
  fly status -a "$GATEWAY_APP" || true
  echo
  log "$REDIS_APP"
  fly status -a "$REDIS_APP" || true
}

cmd_logs() {
  require fly
  log "Tailing logs for $GATEWAY_APP (Ctrl+C to stop)"
  fly logs -a "$GATEWAY_APP"
}

cmd_health() {
  local url="https://$GATEWAY_APP.fly.dev/health"
  log "GET $url"
  if command -v jq >/dev/null 2>&1; then
    curl -s "$url" | jq .
  else
    curl -s "$url"
    echo
  fi
}

cmd_rollback() {
  require fly
  log "Recent releases for $GATEWAY_APP"
  fly releases -a "$GATEWAY_APP" | head -20
  echo
  read -r -p "Enter version to roll back to (e.g. v42): " version
  [[ -z "$version" ]] && fail "No version entered"
  confirm "Roll back $GATEWAY_APP to $version?"
  fly releases rollback "$version" -a "$GATEWAY_APP"
  ok "Rollback initiated"
}

cmd_help() {
  sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'
}

# -----------------------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------------------

case "${1:-deploy}" in
  init)     cmd_init ;;
  deploy)   cmd_deploy ;;
  redis)    cmd_redis ;;
  secrets)  cmd_secrets ;;
  status)   cmd_status ;;
  logs)     cmd_logs ;;
  health)   cmd_health ;;
  rollback) cmd_rollback ;;
  build)    cmd_build_local ;;
  help|-h|--help) cmd_help ;;
  *)        fail "Unknown command: $1. Try: ./deploy.sh help" ;;
esac
