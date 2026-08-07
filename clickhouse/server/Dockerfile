# ⚠️ FLY-DEPLOY-ONLY image. It seds hostnames to plexus-ch.internal and locks
# the writer to Fly's 6PN network — do NOT use for self-host/compose. The
# self-host path is the stock clickhouse-server image + mounted configs
# (see docker-compose.yml here and gateway/selfhost/).
FROM clickhouse/clickhouse-server:26.3.3.20

# Drop-in ClickHouse server configs. Same files the compose stack mounts;
# baked into the image here because Fly machines don't mount host files.
COPY configs/clickhouse/config.xml /etc/clickhouse-server/config.d/config.xml
COPY configs/clickhouse/users.xml  /etc/clickhouse-server/users.d/users.xml
COPY configs/clickhouse/disks.xml  /etc/clickhouse-server/config.d/disks.xml

# Embed Keeper in this clickhouse-server process by dropping the keeper
# config into config.d. In compose the same file is mounted into a
# separate ch-keeper container; on Fly there is no second container, so
# Keeper runs in-process and binds 9181 on localhost.
#
# Transforms applied to keeper.xml for the embedded/Fly case:
#   1. Strip <listen_host> — duplicates config.xml when merged.
#   2. Rewrite Raft self-identifier ch-keeper -> localhost.
#   3. Relocate Keeper log/snapshot storage from /var/lib/clickhouse-keeper
#      (the standalone default, which is NOT under Fly's mounted volume
#      and would silently make Keeper state ephemeral) to
#      /var/lib/clickhouse/coordination so it shares the CH data volume.
COPY configs/keeper/keeper_config.xml /etc/clickhouse-server/config.d/keeper.xml
RUN sed -i '/<listen_host>/d' /etc/clickhouse-server/config.d/keeper.xml \
 && sed -i 's|<hostname>ch-keeper</hostname>|<hostname>localhost</hostname>|' /etc/clickhouse-server/config.d/keeper.xml \
 && sed -i 's|/var/lib/clickhouse-keeper/log|/var/lib/clickhouse/coordination/log|' /etc/clickhouse-server/config.d/keeper.xml \
 && sed -i 's|/var/lib/clickhouse-keeper/snapshots|/var/lib/clickhouse/coordination/snapshots|' /etc/clickhouse-server/config.d/keeper.xml

# Rewrite compose-only hostnames to Fly 6PN identities:
#   ch-keeper  ->  localhost           (Keeper is now in-process)
#   ch-01      ->  plexus-ch.internal  (6PN DNS for this app)
# Committed XML points at compose service names so `docker compose up`
# works unchanged; this is where they become Fly-internal names.
ARG CH_INTERNAL_HOST=plexus-ch.internal
RUN sed -i 's|<host>ch-keeper</host>|<host>localhost</host>|' /etc/clickhouse-server/config.d/config.xml \
 && sed -i 's|<host>ch-01</host>|<host>'"$CH_INTERNAL_HOST"'</host>|' /etc/clickhouse-server/config.d/config.xml

# Listen on IPv6 in addition to IPv4. Fly's 6PN private network is
# IPv6-only (fdaa::/16), so without this the loader cannot reach us over
# `plexus-ch.internal`. Added here rather than in the committed config
# because local Docker bridges often lack IPv6 and would log a bind
# warning on each startup.
RUN sed -i '/<listen_host>0.0.0.0<\/listen_host>/a\  <listen_host>::</listen_host>' /etc/clickhouse-server/config.d/config.xml

# Lock telemetry_writer to 6PN (fdaa::/16) so the writer user is
# unreachable from the public HTTPS exposure. The sed range limits the
# substitution to the telemetry_writer element, leaving nextjs_reader
# (which IS intentionally public) untouched.
RUN sed -i '/<telemetry_writer>/,/<\/telemetry_writer>/ s|<ip>0.0.0.0/0</ip>|<ip>fdaa::/16</ip>|' /etc/clickhouse-server/users.d/users.xml

# Fly-specific entrypoint wrapper. Raises the nofile soft limit before
# clickhouse-server forks (default Fly limit is too small for CH 26.x
# merge activity — causes silent EMFILE failures on reads) and sweeps
# any tmp_merge_* directories left by previously crashed merges.
# See fly-entrypoint.sh for details.
COPY fly-entrypoint.sh /fly-entrypoint.sh
RUN chmod +x /fly-entrypoint.sh
ENTRYPOINT ["/fly-entrypoint.sh"]

# schema.sql is deliberately NOT copied. It's reference-only. Apply
# manually post-deploy:
#   fly proxy 8123 -a plexus-ch
#   clickhouse-client --host=127.0.0.1 --user=telemetry_writer \
#       --password --multiquery < server/schema.sql

# 8123 HTTP  •  9000 native  •  9009 interserver replication  •  9181 Keeper
EXPOSE 8123 9000 9009 9181
