# Plexus — one-click local dev (lives in frontend/local/).
#
#   make dev              → core suite: Docker backend + Postgres/migrations + frontend (HMR)
#   EXTRAS=1 make dev     → also start the ancillary services (data-api + recorder)
#   make down             → stop everything (backend + Postgres), keep data
#   make clean            → stop everything + wipe all volumes (full reset)
#   make nuke             → clean + remove the built plexus-dev/* images (cold state)
#   make status           → show what's currently running
#
# Backend runs in Docker; the frontend runs on the host via `npm run dev` (HMR) —
# that's a foreground process you stop with Ctrl-C (it doesn't stop the backend).
# Requires the sibling service repos checked out at the workspace root (../../).

WS      := ../..
# Sibling checkouts the default stack builds from. The recorder is NOT here —
# it's behind the compose `recorder` profile and needs plexus-private/video-recorder
# cloned to $(WS)/video-recorder (see docker-compose.dev.yml).
REPOS   := gateway houston api clickhouse
EXTRAS  ?=
BASE    := docker compose --env-file .env -f docker-compose.dev.yml
# UP: start core only, or core+extras when EXTRAS is set.
UP      := $(BASE) $(if $(EXTRAS),--profile extras,)
# ALL: target every service (incl. profiled ones) for teardown/status/logs.
ALL     := $(BASE) --profile extras --profile recorder

.PHONY: dev backend setup db down logs clean nuke status check-repos

## Full one-click: env → backend → db+migrations → frontend (foreground)
dev: check-repos setup backend db
	@echo "▸ starting frontend (npm run dev) — Ctrl-C stops the frontend only"
	@echo "  dashboard → http://localhost:3000   (backend stays up; \`make down\` to stop it)"
	cd .. && npm run dev

## Generate local/.env + ../.env.development.local (idempotent)
setup:
	@bash dev-setup.sh

## Build + start the Dockerized backend (detached). EXTRAS=1 adds data-api + recorder.
backend: check-repos setup
	$(UP) up -d --build

## Start the frontend's Postgres and apply migrations
db:
	cd .. && npm run db:up

## Show what's running (backend + extras)
status:
	$(ALL) ps

## Tail backend logs
logs:
	$(ALL) logs -f

## Stop EVERYTHING (backend + frontend Postgres), keep data — fast restart
down:
	$(ALL) down
	-cd .. && npm run db:down

## Stop everything AND wipe all volumes (ClickHouse/Redis/MinIO/Postgres reset)
clean:
	$(ALL) down -v
	-cd .. && docker compose down -v

## Full cold state: clean + remove the built plexus-dev/* images
nuke: clean
	-docker image rm plexus-dev/gateway:local plexus-dev/ch-loader:local \
	  plexus-dev/alert-service:local plexus-dev/data-api:local plexus-dev/recorder:local

## Fail early with a clear message if a sibling repo is missing
check-repos:
	@missing=""; for r in $(REPOS); do [ -d "$(WS)/$$r" ] || missing="$$missing $$r"; done; \
	if [ -n "$$missing" ]; then \
	  echo "✗ missing at workspace root ($(WS)):$$missing"; \
	  echo "  clone them next to the frontend repo, e.g.:"; \
	  for r in $$missing; do \
	    echo "    git clone git@github.com:plexus-private/$$r.git $(WS)/$$r"; \
	  done; \
	  exit 1; \
	fi
