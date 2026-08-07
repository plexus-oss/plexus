#!/bin/bash
# wait-for-keeper.sh — docker-entrypoint-initdb.d gate for schema.sql.
#
# Mounted (e.g. by frontend/local/docker-compose.dev.yml) as
# /docker-entrypoint-initdb.d/00-wait-for-keeper.sh so it runs BEFORE the
# schema is applied. schema.sql is all `ON CLUSTER observability_cluster`
# DDL, which goes through the Keeper-backed distributed DDL queue — if
# Keeper isn't reachable yet the first CREATE fails and the entrypoint
# aborts. So: block until ClickHouse can actually talk to Keeper.
#
# Runs inside the official clickhouse-server entrypoint, which exports
# CLICKHOUSE_USER / CLICKHOUSE_PASSWORD (the bootstrap init user) while a
# temporary server instance is up on localhost.
set -e

TIMEOUT="${KEEPER_WAIT_TIMEOUT:-120}"
echo "wait-for-keeper: waiting up to ${TIMEOUT}s for ClickHouse ↔ Keeper connectivity..."

for ((i = 0; i < TIMEOUT; i++)); do
  if clickhouse-client \
      --user "${CLICKHOUSE_USER:-default}" \
      --password "${CLICKHOUSE_PASSWORD:-}" \
      --query "SELECT count() FROM system.zookeeper WHERE path = '/'" \
      >/dev/null 2>&1; then
    echo "wait-for-keeper: Keeper is reachable (after ${i}s)."
    exit 0
  fi
  sleep 1
done

echo "wait-for-keeper: Keeper NOT reachable after ${TIMEOUT}s — aborting init." >&2
exit 1
