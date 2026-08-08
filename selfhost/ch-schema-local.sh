#!/bin/sh
# ch-init entrypoint: applies clickhouse/server/schema.sql, transformed for
# local-disk-only storage when S3 tiering is off (PLEXUS_S3_TIERING=0).
#
# The reference schema hard-codes the 'tiered' storage policy and
# "TO VOLUME 'cold'" TTL moves, both of which require the MinIO-backed
# s3_cold disk. With tiering off we rewrite the DDL (comments untouched):
#
#   SETTINGS storage_policy = 'tiered'      →  storage_policy = 'default'
#   TTL <expr> TO VOLUME 'cold',            →  TTL          (move dropped;
#       <expr> DELETE                              the plain DELETE retention
#                                                  clause is kept verbatim)
#   TTL <expr> TO VOLUME 'cold'  (no comma) →  line removed (move-only TTL)
#
# PLEXUS_S3_TIERING missing or "1" applies the schema unchanged — .env files
# generated before this option existed never set the var and always ran MinIO.
set -eu

SCHEMA="${SCHEMA_PATH:-/schema.sql}"
APPLY="$SCHEMA"

if [ "${PLEXUS_S3_TIERING:-1}" = "0" ]; then
  APPLY=/tmp/schema.local.sql
  sed \
    -e "/^[[:space:]]*--/!s/storage_policy = 'tiered'/storage_policy = 'default'/g" \
    -e "s/^\([[:space:]]*\)TTL[[:space:]].*TO VOLUME 'cold',[[:space:]]*\$/\1TTL/" \
    -e "/^[[:space:]]*TTL[[:space:]][^,]*TO VOLUME 'cold'[[:space:]]*\$/d" \
    "$SCHEMA" > "$APPLY"

  # Refuse to apply if any live (non-comment) DDL still references the cold
  # tier or the tiered policy — better a loud one-shot failure than tables
  # created against a disk that doesn't exist.
  if grep -v "^[[:space:]]*--" "$APPLY" | grep -q -e "'tiered'" -e "'cold'"; then
    echo "ch-schema-local: transform left tiered/cold references in live DDL:" >&2
    grep -n -e "'tiered'" -e "'cold'" "$APPLY" | grep -v -- "-- " >&2 || true
    exit 1
  fi
fi

exec clickhouse-client --host ch-01 --user admin --password "$CH_ADMIN_PASSWORD" --multiquery < "$APPLY"
