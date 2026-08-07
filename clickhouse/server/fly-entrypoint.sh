#!/bin/bash
set -e

# Raise the open-files limit before clickhouse-server forks.
#
# ClickHouse 26.x keeps many file descriptors open during merges
# (one per data/mark file per column per source part) and queries
# (one per column being read). Fly's default nofile soft limit is
# far too low — when it runs out mid-read, openFile() fails with
# errno 24 "too many open files" and the symptom from outside is
# silent zero-row counts + 15s timeouts on LIMIT 1 scans.
# 524,288 is ClickHouse's own recommended value.
ulimit -n 524288 || true

# Sweep any tmp_merge_* directories left behind by previously
# crashed merges. These accumulate whenever a merge aborts (e.g.
# from hitting EMFILE above) and block future merges with
# DIRECTORY_ALREADY_EXISTS. Safe to delete at boot because
# clickhouse-server has not started yet — no in-progress merge
# owns these directories.
find /var/lib/clickhouse/store -maxdepth 3 -type d -name 'tmp_merge_*' \
  -exec rm -rf {} + 2>/dev/null || true

exec /entrypoint.sh "$@"
