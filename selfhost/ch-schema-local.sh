#!/bin/sh
# ch-init entrypoint: applies clickhouse/server/schema.sql, transformed for
# self-hosting. Two rewrites, in order (comments untouched):
#
# 1. Retention (always): self-hosted data is kept forever — the cloud
#    DELETE TTLs manage shared-storage cost, which doesn't apply to your
#    own disk. Every "<expr> DELETE" retention clause is dropped:
#
#      TTL <expr> TO VOLUME 'cold',   →  TTL <expr> TO VOLUME 'cold'
#          <expr> DELETE                    (move kept, delete dropped)
#      TTL <expr> DELETE;             →  ;  (whole clause dropped)
#
#    Bound disk yourself later with ALTER TABLE ... MODIFY TTL.
#
# 2. Tiering (when PLEXUS_S3_TIERING=0): the reference schema hard-codes
#    the 'tiered' storage policy and "TO VOLUME 'cold'" moves, both of
#    which require the MinIO-backed s3_cold disk:
#
#      SETTINGS storage_policy = 'tiered'   →  storage_policy = 'default'
#      TTL <expr> TO VOLUME 'cold'          →  line removed (move-only TTL)
#
# PLEXUS_S3_TIERING missing or "1" keeps tiering — .env files generated
# before this option existed never set the var and always ran MinIO.
set -eu

SCHEMA="${SCHEMA_PATH:-/schema.sql}"
APPLY=/tmp/schema.local.sql

sed \
  -e "s/^\([[:space:]]*TTL[[:space:]].*TO VOLUME 'cold'\),[[:space:]]*\$/\1/" \
  -e "/^[[:space:]]*[a-z_]* + INTERVAL[[:space:]].*DELETE[[:space:]]*\$/d" \
  -e "s/^[[:space:]]*TTL[[:space:]].*DELETE;[[:space:]]*\$/;/" \
  "$SCHEMA" > "$APPLY"

if [ "${PLEXUS_S3_TIERING:-1}" = "0" ]; then
  sed -i \
    -e "/^[[:space:]]*--/!s/storage_policy = 'tiered'/storage_policy = 'default'/g" \
    -e "/^[[:space:]]*TTL[[:space:]][^,]*TO VOLUME 'cold'[[:space:]]*\$/d" \
    "$APPLY"

  # Refuse to apply if any live (non-comment) DDL still references the cold
  # tier or the tiered policy — better a loud one-shot failure than tables
  # created against a disk that doesn't exist.
  if grep -v "^[[:space:]]*--" "$APPLY" | grep -q -e "'tiered'" -e "'cold'"; then
    echo "ch-schema-local: transform left tiered/cold references in live DDL:" >&2
    grep -n -e "'tiered'" -e "'cold'" "$APPLY" | grep -v -- "-- " >&2 || true
    exit 1
  fi
fi

# Same loud-failure guard for retention: no live DELETE TTL may survive.
if grep -v "^[[:space:]]*--" "$APPLY" | grep -q "DELETE"; then
  echo "ch-schema-local: transform left DELETE TTLs in live DDL:" >&2
  grep -n "DELETE" "$APPLY" | grep -v -- "-- " >&2 || true
  exit 1
fi

exec clickhouse-client --host ch-01 --user admin --password "$CH_ADMIN_PASSWORD" --multiquery < "$APPLY"
