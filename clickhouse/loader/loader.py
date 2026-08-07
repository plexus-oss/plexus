"""
ch-loader: Redis Stream → ClickHouse batch inserter (async).

Discovers every `telemetry.stream:*` key in Redis, joins a consumer
group on each, parses v:2 envelopes, and batch-inserts metric points
into ClickHouse's `plexus.telemetry_dist`. Points with class="event"
route to `plexus.events_dist` instead, and a separate loop drains
`video_sessions.stream` into `plexus.video_sessions_dist`. The
Distributed engine routes each row to the owning shard via
`cityHash64(org_id)`.

Recording filter: only sources with config.recording = true in Supabase
are persisted. The loader bootstraps the recording set from Next.js at
startup and receives push updates via POST /recording.

─── Async pipelining invariant ─────────────────────────────────────────
At most ONE batch is in flight (inserted but not yet ACKed) at any
moment. The next iteration's read + parse runs concurrently with the
previous iteration's ClickHouse insert, but we never dispatch a second
insert until the first is confirmed and its messages are ACKed.

Failure safety:
  - ACK only after a confirmed CH insert.
  - On insert failure, flip to pending-recovery mode. Next iteration
    re-reads the failed batch from this consumer's PEL (XREADGROUP "0").
  - CH's ReplicatedMergeTree insert deduplication (enabled by default)
    drops any duplicate blocks caused by retry — deterministic batch
    rebuild + dedup = exactly-once end-to-end despite at-least-once
    Redis semantics.

Horizontal scaling: see SCALING.md. Not enabled today.

Configure via environment variables (see .env.example).
"""

import asyncio
import hmac
import httpx
import logging
import os
import signal
import sys
import socket
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import clickhouse_connect
import orjson
import redis.asyncio as redis_async
import zstandard as zstd
from prometheus_client import (
    Counter, Gauge, Histogram,
    generate_latest, CONTENT_TYPE_LATEST, REGISTRY,
)
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import ResponseError

_zstd_dctx = zstd.ZstdDecompressor()

log = logging.getLogger("ch-loader")


# ── Prometheus metrics ───────────────────────────────────────────────────
# Default REGISTRY automatically includes ProcessCollector (process_*) and
# PlatformCollector. All metrics are exposed via GET /metrics on HEALTH_PORT.

_prom_rows_inserted = Counter(
    "plexus_loader_rows_inserted_total",
    "Rows successfully inserted into ClickHouse",
)
_prom_batch_size = Histogram(
    "plexus_loader_batch_size_rows",
    "Rows per ClickHouse insert batch",
    buckets=[10, 50, 100, 500, 1000, 2500, 5000, 10000],
)
_prom_insert_duration = Histogram(
    "plexus_loader_insert_duration_seconds",
    "ClickHouse insert latency",
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
)
_prom_errors = Counter(
    "plexus_loader_errors_total",
    "Errors by type (insert_failed, redis_lost, decode_failed)",
    ["type"],
)
_prom_dropped = Counter(
    "plexus_loader_points_dropped_total",
    "Points intentionally not persisted, by reason "
    "(recording_filtered, bad_point, unknown_class)",
    ["reason"],
)
_prom_streams_active = Gauge(
    "plexus_loader_streams_active",
    "Number of Redis streams being consumed",
)
_prom_messages_read = Counter(
    "plexus_loader_messages_read_total",
    "Total messages read from Redis streams",
)
_prom_event_rows_inserted = Counter(
    "plexus_loader_event_rows_inserted_total",
    "Event rows successfully inserted into ClickHouse",
)


# ── Config ──────────────────────────────────────────────────────────────

REDIS_URL   = os.environ.get("REDIS_URL", "redis://localhost:6379")

CH_HOST     = os.environ.get("CH_HOST", "ch-01")
CH_PORT     = int(os.environ.get("CH_PORT", "8123"))
CH_USER     = os.environ.get("CH_USER", "telemetry_writer")
CH_PASSWORD = os.environ.get("CH_PASSWORD", "")
CH_TABLE    = os.environ.get("CH_TABLE", "plexus.telemetry_dist")
EVENT_TABLE = os.environ.get("EVENT_TABLE", "plexus.events_dist")

CONSUMER_GROUP = "ch-loader"
CONSUMER_NAME  = os.environ.get("CONSUMER_NAME", "loader-0")

BATCH_SIZE         = int(os.environ.get("BATCH_SIZE", "5000"))
BATCH_INTERVAL_S   = float(os.environ.get("BATCH_INTERVAL", "2.0"))
STREAM_DISCOVERY_S = int(os.environ.get("STREAM_DISCOVERY_INTERVAL", "60"))
CONN_RECYCLE_S     = int(os.environ.get("CONN_RECYCLE_INTERVAL", "900"))
HEALTH_PORT        = int(os.environ.get("HEALTH_PORT", "8080"))

PLEXUS_API_URL        = os.environ.get("PLEXUS_API_URL", "")
PLEXUS_INTERNAL_SECRET = os.environ.get("PLEXUS_INTERNAL_SECRET", "")
# Dev-only escape hatch: skip the recording filter (persist ALL sources)
# instead of failing closed when the two vars above are missing.
RECORDING_FILTER_DISABLED = os.environ.get("RECORDING_FILTER_DISABLED") == "1"

STREAM_PREFIX = "telemetry.stream:"
VIDEO_SESSIONS_STREAM  = "video_sessions.stream"
VIDEO_SESSION_TABLE    = os.environ.get("VIDEO_SESSION_TABLE", "plexus.video_sessions_dist")
VIDEO_SESSION_COLUMNS  = ["org_id", "source_id", "camera_count", "started_at", "duration_s"]

CH_COLUMNS = [
    "org_id", "source_id", "timestamp", "metric",
    "value", "tags", "metadata", "_ingested_at",
]

EVENT_COLUMNS = [
    "org_id", "source_id", "timestamp", "name",
    "body", "tags", "_ingested_at",
]


# ── Recording filter store ──────────────────────────────────────────────

class RecordingStore:
    """Thread-safe set of (org_id, source_slug) pairs with recording enabled.

    Slug alone is not globally unique across orgs, so we key on the tuple.
    Accessed from both the asyncio event loop and the HTTP handler thread.
    """

    def __init__(self) -> None:
        self._pairs: set[tuple[str, str]] = set()
        self._lock = threading.Lock()

    def is_recording(self, org_id: str, source_id: str) -> bool:
        with self._lock:
            return (org_id, source_id) in self._pairs

    def set(self, org_id: str, source_id: str, recording: bool) -> None:
        with self._lock:
            if recording:
                self._pairs.add((org_id, source_id))
            else:
                self._pairs.discard((org_id, source_id))

    def replace_all(self, pairs: list[tuple[str, str]]) -> None:
        with self._lock:
            self._pairs = set(pairs)

    def __len__(self) -> int:
        with self._lock:
            return len(self._pairs)


_recording_store: RecordingStore | None = None

# POST /recording toggles that arrive before the store is bootstrapped.
# The frontend push is fire-and-forget, so a 503 here would silently lose
# the toggle until the next restart. Buffer instead (order-preserving) and
# replay after replace_all completes. _pending_lock also serializes the
# store handoff in main() so no toggle slips between bootstrap and replay.
_pending_toggles: list[tuple[str, str, bool]] = []
_pending_lock = threading.Lock()


# ── Stream discovery ────────────────────────────────────────────────────

async def discover_streams(r: redis_async.Redis) -> list[str]:
    """Scan Redis for all telemetry streams."""
    streams: list[str] = []
    async for key in r.scan_iter(match=f"{STREAM_PREFIX}*".encode(), count=500):
        streams.append(key.decode())
    streams.sort()
    return streams


async def ensure_consumer_groups(r: redis_async.Redis, stream_names: list[str]) -> None:
    """Create the ch-loader consumer group on each stream, ignoring BUSYGROUP."""
    for stream in stream_names:
        try:
            await r.xgroup_create(stream, CONSUMER_GROUP, id="$", mkstream=True)
            log.info(f"Created consumer group on {stream}")
        except ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise


# ── Envelope parsing + row building (pure, no I/O) ──────────────────────

def parse_envelope(raw: bytes) -> tuple[str, str, list, int] | None:
    """Parse a v:2 envelope → (org_id, source_id, points, ingested_at_ms) or None.

    `ingested_at_ms` is the envelope-level gateway receive time (ms since
    epoch). Falls back to 0 on malformed / legacy envelopes — build_row
    then uses wall-clock as a last resort so we never write 1970.

    None on: invalid JSON, heartbeats (no points array), missing org/source.
    """
    # Ceiling must clear the worst-case decompressed envelope. The gateway
    # packs up to ~1MB / 10k points per message and re-marshals to JSON, which
    # inflates past 256KB — at that old cap zstd raised, we caught it below, and
    # the batch was silently dropped after already being ACKed (unrecoverable).
    # 8MB comfortably covers a re-marshaled 1MB message; loader handles one
    # message at a time so peak memory is bounded.
    try:
        entry = orjson.loads(_zstd_dctx.decompress(raw, max_output_size=8 * 1024 * 1024))
    except (orjson.JSONDecodeError, TypeError, zstd.ZstdError) as exc:
        # A real decode failure (not a heartbeat — those decode fine but carry
        # no points). Count and log loudly so silent data loss is observable.
        _prom_errors.labels(type="decode_failed").inc()
        log.warning("parse_envelope decode failed (%d raw bytes): %s", len(raw), exc)
        return None

    points = entry.get("points")
    if not isinstance(points, list) or not points:
        return None

    org_id = entry.get("org_id") or ""
    source_id = entry.get("source_id") or ""
    if not org_id or not source_id:
        return None

    ingested_at_ms = entry.get("ingested_at") or 0

    return org_id, source_id, points, ingested_at_ms


def _point_time(pt: dict, ingested_at: datetime) -> datetime:
    """Resolve a point's event time, defaulting to ingest time when missing.

    The SDK is supposed to stamp `timestamp` (ms since epoch), but the wire
    contract makes it optional and neither the gateway nor the validator
    backstops it. An absent/zero/negative value used to become 1970-01-01,
    which is invisible to every time-ranged read and immediately TTL-delete-
    eligible. Falling back to `ingested_at` (gateway receive, or loader
    wall-clock) matches the documented "Plexus uses server receive time"
    behavior and keeps the point queryable.
    """
    ts = pt.get("timestamp")
    if isinstance(ts, (int, float)) and ts > 0:
        # Seconds-vs-milliseconds guard: a ms timestamp below 1e12 would be
        # before Sep 2001 — impossible for live telemetry — so any positive
        # value under 1e12 is a device stamping SECONDS. Without this, a
        # seconds stamp divided by 1000 lands near 1970-01-01: invisible to
        # every time-ranged read and immediately TTL-delete-eligible.
        if ts < 1e12:
            ts *= 1000
        return datetime.fromtimestamp(ts / 1000.0, tz=timezone.utc)
    return ingested_at


def build_row(org_id: str, source_id: str, pt: dict, ingested_at_ms: int) -> list:
    """Build one CH row (in CH_COLUMNS order) from a raw point dict.

    `_ingested_at` is the envelope-level gateway receive time. Fallback
    to loader wall-clock if the envelope didn't carry one (legacy shape
    or malformed) — still far better than the DEFAULT now64(3) path
    because this way we never conflate insert time with ingest time.
    """
    if ingested_at_ms > 0:
        ingested_at = datetime.fromtimestamp(ingested_at_ms / 1000.0, tz=timezone.utc)
    else:
        ingested_at = datetime.now(tz=timezone.utc)
    return [
        org_id,
        source_id,
        _point_time(pt, ingested_at),
        pt.get("metric", ""),
        float(pt.get("value", 0)),
        pt.get("tags", {}),
        orjson.dumps(pt.get("metadata", {})).decode(),
        ingested_at,
    ]


def build_event_row(org_id: str, source_id: str, pt: dict, ingested_at_ms: int) -> list:
    """Build one events row (in EVENT_COLUMNS order) from a raw point dict."""
    if ingested_at_ms > 0:
        ingested_at = datetime.fromtimestamp(ingested_at_ms / 1000.0, tz=timezone.utc)
    else:
        ingested_at = datetime.now(tz=timezone.utc)
    val = pt.get("value", "")
    body = val if isinstance(val, str) else orjson.dumps(val).decode()
    return [
        org_id,
        source_id,
        _point_time(pt, ingested_at),
        pt.get("metric", ""),
        body,
        pt.get("tags", {}),
        ingested_at,
    ]


def build_batch(
    results,
    recording_store: RecordingStore | None = None,
    filter_cache: dict[tuple, bool] | None = None,
) -> tuple[list[list], list[list], dict[str, list[str]]]:
    """Flatten xreadgroup results into (metric_rows, event_rows, ack_by_stream).

    Keeps parsing deterministic so retries produce byte-identical blocks
    for ClickHouse insert deduplication. The recording filter is the one
    mutable input, so its per-message decision is pinned in `filter_cache`
    (keyed by (stream, msg_id), pruned on ACK): a toggle landing between a
    failed insert and its PEL retry would otherwise change the rebuilt
    block and defeat block-hash dedup.
    """
    rows: list[list] = []
    event_rows: list[list] = []
    ack_by_stream: dict[str, list[str]] = {}

    for stream_name, messages in results:
        for msg_id, fields in messages:
            # Register for ACK inside the inner loop — streams with zero
            # messages must NOT show up in ack_by_stream, otherwise XACK
            # would be called with no IDs and Redis rejects it.
            ack_by_stream.setdefault(stream_name, []).append(msg_id)

            raw = fields.get(b"data")
            if not raw:
                continue
            parsed = parse_envelope(raw)
            if parsed is None:
                continue
            org_id, source_id, points, ingested_at_ms = parsed

            # Opt-in recording filter: skip sources not explicitly enabled.
            # Still ACKed above — messages are consumed, just not persisted.
            if recording_store is not None:
                cache_key = (stream_name, msg_id)
                keep = filter_cache.get(cache_key) if filter_cache is not None else None
                if keep is None:
                    keep = recording_store.is_recording(org_id, source_id)
                    if filter_cache is not None:
                        filter_cache[cache_key] = keep
                if not keep:
                    _prom_dropped.labels(reason="recording_filtered").inc(len(points))
                    continue

            for pt in points:
                if not isinstance(pt, dict):
                    _prom_dropped.labels(reason="bad_point").inc()
                    continue
                pt_class = pt.get("class", "metric")
                if pt_class == "metric":
                    rows.append(build_row(org_id, source_id, pt, ingested_at_ms))
                elif pt_class == "event":
                    event_rows.append(build_event_row(org_id, source_id, pt, ingested_at_ms))
                else:
                    _prom_dropped.labels(reason="unknown_class").inc()

    return rows, event_rows, ack_by_stream


def _prune_filter_cache(
    filter_cache: dict[tuple, bool], ack_by_stream: dict[str, list[str]]
) -> None:
    """Drop cached recording-filter decisions for messages just ACKed."""
    for stream_name, ids in ack_by_stream.items():
        for msg_id in ids:
            filter_cache.pop((stream_name, msg_id), None)


# ── Health check (threaded; shares _health dict via GIL) ────────────────

_health: dict = {
    "started":              time.time(),
    "last_redis":           0.0,
    "last_ch_insert":       0.0,
    "streams":              0,
    "total_inserted":       0,
    "total_events_inserted": 0,
}


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/metrics":
            body = generate_latest(REGISTRY)
            self.send_response(200)
            self.send_header("Content-Type", CONTENT_TYPE_LATEST)
            self.end_headers()
            self.wfile.write(body)
            return
        body = orjson.dumps(_health)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/recording":
            self.send_response(404)
            self.end_headers()
            return

        provided = self.headers.get("x-internal-secret", "")
        if PLEXUS_INTERNAL_SECRET and not hmac.compare_digest(provided, PLEXUS_INTERNAL_SECRET):
            self.send_response(401)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        if not length or length > 4096:
            self.send_response(400)
            self.end_headers()
            return

        try:
            body = orjson.loads(self.rfile.read(length))
        except Exception:
            self.send_response(400)
            self.end_headers()
            return

        org_id    = body.get("org_id", "")
        source_id = body.get("source_id", "")
        recording = body.get("recording") is True

        if not org_id or not source_id:
            self.send_response(400)
            self.end_headers()
            return

        if RECORDING_FILTER_DISABLED:
            # No store to update; acknowledge so the caller doesn't retry.
            self.send_response(204)
            self.end_headers()
            return

        with _pending_lock:
            if _recording_store is None:
                # Store not bootstrapped yet — buffer and replay later
                # (see _pending_toggles). 202: accepted, applied soon.
                _pending_toggles.append((org_id, source_id, recording))
                log.info(f"Recording toggle buffered pre-bootstrap: {org_id}:{source_id} → {recording}")
                self.send_response(202)
                self.end_headers()
                return

        _recording_store.set(org_id, source_id, recording)
        log.info(f"Recording updated: {org_id}:{source_id} → {recording}")
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass  # silence default HTTP logging


class _HTTPServerV6(HTTPServer):
    # Python's HTTPServer defaults to AF_INET (IPv4). Subclass + override
    # address_family = AF_INET6 so we can bind on "::" and accept 6PN
    # connections on Fly. On Linux, an IPv6 ANY socket with the default
    # IPV6_V6ONLY=0 also accepts incoming IPv4 connections via v4-mapped
    # addresses, so Fly's own health check (which hits localhost) keeps
    # working unchanged.
    address_family = socket.AF_INET6


def start_health_server() -> None:
    # Bind on IPv6 ANY (::) so the endpoint is reachable from other Fly
    # apps over 6PN (IPv6-only). Previously bound "0.0.0.0" which left it
    # reachable only from inside the machine.
    server = _HTTPServerV6(("::", HEALTH_PORT), HealthHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    log.info(f"Health check on :{HEALTH_PORT}")


# ── Recording store bootstrap ───────────────────────────────────────────

async def bootstrap_recording_store(store: RecordingStore) -> None:
    """Fetch all recording-enabled sources from Next.js at startup.

    Retries with backoff matching the alert-service fetchRulesWithRetry pattern.
    Exits the process on failure — never start ingesting with unknown recording state.
    """
    delays = [1, 2, 4, 8, 16]
    last_err: Exception | None = None
    async with httpx.AsyncClient() as client:
        for attempt, delay in enumerate(delays, 1):
            try:
                r = await client.get(
                    f"{PLEXUS_API_URL}/api/internal/sources/recording",
                    headers={"x-internal-secret": PLEXUS_INTERNAL_SECRET},
                    timeout=10.0,
                )
                r.raise_for_status()
                data = r.json()
                if "sources" not in data:
                    raise ValueError(f"unexpected response shape: {list(data.keys())}")
                pairs = [(s["org_id"], s["source_id"]) for s in data["sources"]]
                store.replace_all(pairs)
                log.info(f"Recording store bootstrapped: {len(store)} sources")
                return
            except Exception as e:
                last_err = e
                log.warning(f"Bootstrap attempt {attempt}/{len(delays)} failed: {e}")
                if attempt < len(delays):
                    await asyncio.sleep(delay)

    log.error(f"Recording store bootstrap failed after all retries: {last_err}")
    sys.exit(1)


# ── Timed CH insert (returns elapsed seconds) ───────────────────────────

async def _insert_timed_both(ch, rows: list, event_rows: list) -> float:
    t0 = time.monotonic()
    if rows:
        await ch.insert(CH_TABLE, rows, column_names=CH_COLUMNS, settings={"async_insert": 0})
    if event_rows:
        await ch.insert(EVENT_TABLE, event_rows, column_names=EVENT_COLUMNS, settings={"async_insert": 0})
    return time.monotonic() - t0


# ── ACK helper (pipelined) ──────────────────────────────────────────────

async def ack_all(r: redis_async.Redis, ack_by_stream: dict[str, list[str]]) -> None:
    """Pipeline XACK across every stream to save round-trips."""
    if not ack_by_stream:
        return
    async with r.pipeline(transaction=False) as pipe:
        for stream_name, ids in ack_by_stream.items():
            pipe.xack(stream_name, CONSUMER_GROUP, *ids)
        await pipe.execute()


# ── Connections with retry ──────────────────────────────────────────────

async def connect_redis() -> redis_async.Redis:
    """Retry Redis connect for up to 120s to tolerate DNS / network races."""
    deadline = time.monotonic() + 120
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            r = redis_async.from_url(REDIS_URL, decode_responses=False)
            await r.ping()
            log.info(f"Redis connected: {REDIS_URL.split('@')[-1]}")
            return r
        except Exception as e:
            last_err = e
            log.info(f"Redis not ready ({e}), retrying in 2s...")
            await asyncio.sleep(2)
    log.error(f"Redis unreachable after 120s: {last_err}")
    sys.exit(1)


async def connect_clickhouse():
    """Retry CH connect for up to 120s to tolerate cold-boot races."""
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            ch = await clickhouse_connect.get_async_client(
                host=CH_HOST, port=CH_PORT,
                username=CH_USER, password=CH_PASSWORD,
            )
            version_result = await ch.query("SELECT version()")
            version = version_result.result_rows[0][0]
            log.info(f"ClickHouse connected: {version}")
            return ch
        except Exception as e:
            log.info(f"ClickHouse not ready ({e}), retrying in 2s...")
            await asyncio.sleep(2)
    log.error("ClickHouse unreachable after 120s, exiting")
    sys.exit(1)


# ── Ingest loop (one-deep pipelined) ────────────────────────────────────

async def ingest_loop(r: redis_async.Redis, ch, shutdown: asyncio.Event, recording_store: RecordingStore | None = None) -> None:
    """Main ingest loop.

    Pipelining model: while the previous batch's CH insert is running in
    the background, this loop reads and parses the next batch. Strictly
    one insert in flight at a time — we `await` the previous insert
    before dispatching the next, which keeps the failure-recovery logic
    simple and the invariant easy to reason about.
    """
    stream_names = await discover_streams(r)
    await ensure_consumer_groups(r, stream_names)
    _health["streams"] = len(stream_names)
    _prom_streams_active.set(len(stream_names))
    streams_refreshed_at = time.monotonic()
    conn_born = time.monotonic()
    log.info(f"Streams ({len(stream_names)}): {stream_names}")
    log.info(f"Consumer: group={CONSUMER_GROUP} name={CONSUMER_NAME}  Target: {CH_TABLE}")

    # Pending-recovery on startup — drain this consumer's PEL first.
    in_pending_mode = True

    # Recording-filter decisions pinned per message until ACK, so a PEL
    # retry rebuilds a byte-identical block (see build_batch docstring).
    filter_cache: dict[tuple, bool] = {}

    # In-flight insert state. At most one non-None at a time.
    inflight: asyncio.Task | None = None
    inflight_acks: dict[str, list[str]] | None = None
    inflight_rows: int = 0
    inflight_event_rows: int = 0

    while not shutdown.is_set():
        now = time.monotonic()

        # ── Reap the previous insert (if any) before doing anything else.
        if inflight is not None:
            try:
                elapsed = await inflight
            except Exception as e:
                log.error(f"ClickHouse insert failed ({inflight_rows} rows): {e}")
                _prom_errors.labels(type="insert_failed").inc()
                # Don't ACK. Flip to pending mode so the next iteration
                # re-reads the same messages from the PEL. Deterministic
                # rebuild + CH dedup = no duplicates land even if the
                # failed insert partially reached ClickHouse.
                inflight = None
                inflight_acks = None
                inflight_rows = 0
                inflight_event_rows = 0
                in_pending_mode = True
                await asyncio.sleep(1)
                continue

            await ack_all(r, inflight_acks)
            _prune_filter_cache(filter_cache, inflight_acks)
            _health["last_ch_insert"]       = time.time()
            _health["total_inserted"]       += inflight_rows
            _health["total_events_inserted"] += inflight_event_rows
            _prom_rows_inserted.inc(inflight_rows)
            _prom_event_rows_inserted.inc(inflight_event_rows)
            _prom_batch_size.observe(inflight_rows)
            _prom_insert_duration.observe(elapsed)
            log.info(
                f"Batch confirmed: {inflight_rows} metric rows, "
                f"{inflight_event_rows} event rows, "
                f"total: {_health['total_inserted']} metrics / {_health['total_events_inserted']} events"
            )
            inflight = None
            inflight_acks = None
            inflight_rows = 0
            inflight_event_rows = 0

        # ── Periodic stream rediscovery.
        if now - streams_refreshed_at > STREAM_DISCOVERY_S:
            try:
                new_streams = await discover_streams(r)
                if new_streams != stream_names:
                    added   = set(new_streams) - set(stream_names)
                    removed = set(stream_names) - set(new_streams)
                    if added:   log.info(f"Streams added: {added}")
                    if removed: log.info(f"Streams removed: {removed}")
                    stream_names = new_streams
                    await ensure_consumer_groups(r, stream_names)
                    _health["streams"] = len(stream_names)
                    _prom_streams_active.set(len(stream_names))
                    in_pending_mode = True  # new streams may have a PEL
                streams_refreshed_at = now
            except Exception as e:
                log.warning(f"Stream discovery failed: {e}")

        if not stream_names:
            await asyncio.sleep(BATCH_INTERVAL_S)
            continue

        # ── Proactive connection recycling to avoid Fly proxy killing long-lived TCP connections.
        if not in_pending_mode and now - conn_born > CONN_RECYCLE_S:
            log.info("Recycling connections (Fly proxy keepalive)")
            try:
                await r.aclose()
                r = await connect_redis()
                await ensure_consumer_groups(r, stream_names)
            except Exception as e:
                log.warning(f"Redis recycle failed: {e}")
            try:
                await ch.close()
                ch = await connect_clickhouse()
            except Exception as e:
                log.warning(f"ClickHouse recycle failed: {e}")
            conn_born = time.monotonic()

        # ── Build stream id map for xreadgroup.
        #
        # Pending reads use "0" (this consumer's PEL) and pass block=None
        # so Redis returns immediately. `block=0` means "block forever"
        # in Redis's wire protocol — not "non-blocking" — and even though
        # the docs say BLOCK is ignored with explicit IDs, some clients
        # and proxies pass it through, so don't rely on that.
        if in_pending_mode:
            stream_ids = {name: "0" for name in stream_names}
            block_ms: int | None = None
        else:
            stream_ids = {name: ">" for name in stream_names}
            block_ms = int(BATCH_INTERVAL_S * 1000)

        per_stream_count = max(1, BATCH_SIZE // len(stream_names))

        try:
            results = await r.xreadgroup(
                CONSUMER_GROUP, CONSUMER_NAME,
                stream_ids,
                count=per_stream_count,
                block=block_ms,
            )
        except RedisConnectionError:
            log.warning("Redis connection lost, retrying in 1s...")
            _prom_errors.labels(type="redis_lost").inc()
            await asyncio.sleep(1)
            continue

        _health["last_redis"] = time.time()
        if results:
            _prom_messages_read.inc(sum(len(msgs) for _, msgs in results))

        # xreadgroup may return [[stream, []], ...] when queried with a
        # specific ID (like "0" in pending mode) and that stream has no
        # matching entries. Detect "no actual messages" by summing the
        # per-stream message lists, not by checking `not results`.
        has_messages = bool(results) and any(
            messages for _, messages in results
        )
        if not has_messages:
            if in_pending_mode:
                in_pending_mode = False
                log.info("Pending drained, entering live mode")
                continue
            # Live mode with block_ms should have already waited; if we
            # still got nothing, just loop and block again.
            continue

        # ── Parse deterministically.
        rows, event_rows, ack_by_stream = build_batch(results, recording_store, filter_cache)

        # Heartbeats and other non-data envelopes still need ACKing.
        if not rows and not event_rows:
            await ack_all(r, ack_by_stream)
            _prune_filter_cache(filter_cache, ack_by_stream)
            continue

        # ── Dispatch the insert as a background task and move on.
        #    The next iteration's read will run concurrently with this
        #    insert, reaping it at the top of that iteration.
        inflight = asyncio.create_task(
            _insert_timed_both(ch, rows, event_rows)
        )
        inflight_acks = ack_by_stream
        inflight_rows = len(rows)
        inflight_event_rows = len(event_rows)

    # ── Shutdown: reap any in-flight insert cleanly.
    if inflight is not None:
        log.info(f"Shutdown: waiting for in-flight insert ({inflight_rows} metric, {inflight_event_rows} event rows)")
        try:
            elapsed = await inflight
            await ack_all(r, inflight_acks)
            _prune_filter_cache(filter_cache, inflight_acks)
            _health["total_inserted"]        += inflight_rows
            _health["total_events_inserted"] += inflight_event_rows
            _prom_rows_inserted.inc(inflight_rows)
            _prom_event_rows_inserted.inc(inflight_event_rows)
            _prom_batch_size.observe(inflight_rows)
            _prom_insert_duration.observe(elapsed)
        except Exception as e:
            log.error(f"Final insert failed during shutdown: {e}")
            _prom_errors.labels(type="insert_failed").inc()


# ── Video sessions loop ─────────────────────────────────────────────────

async def video_sessions_loop(r: redis_async.Redis, ch, shutdown: asyncio.Event) -> None:
    """Read video_sessions.stream and batch-insert into plexus.video_sessions.

    One record per browser disconnect from the gateway. Volume is very low
    (sessions, not points), so no pipelining or batch optimization needed.
    source_id is empty string until that column is dropped.
    """
    try:
        await r.xgroup_create(VIDEO_SESSIONS_STREAM, CONSUMER_GROUP, id="$", mkstream=True)
        log.info(f"Created consumer group on {VIDEO_SESSIONS_STREAM}")
    except ResponseError as e:
        if "BUSYGROUP" not in str(e):
            raise

    log.info("Video sessions loop started")

    in_pending_mode = True  # drain PEL first on every startup
    conn_born = time.monotonic()

    while not shutdown.is_set():
        now = time.monotonic()

        # Recycle connections to avoid Fly proxy killing long-lived TCP connections.
        # No in_pending_mode guard needed — volume is low enough that a missed
        # recycle window during PEL drain is not a concern.
        if now - conn_born > CONN_RECYCLE_S:
            log.info("video_sessions_loop: recycling connections (Fly proxy keepalive)")
            try:
                await r.aclose()
                r = await connect_redis()
                await r.xgroup_create(VIDEO_SESSIONS_STREAM, CONSUMER_GROUP, id="$", mkstream=True)
            except ResponseError as e:
                if "BUSYGROUP" not in str(e):
                    log.warning(f"video_sessions_loop: Redis recycle group error: {e}")
            except Exception as e:
                log.warning(f"video_sessions_loop: Redis recycle failed: {e}")
            try:
                await ch.close()
                ch = await connect_clickhouse()
            except Exception as e:
                log.warning(f"video_sessions_loop: ClickHouse recycle failed: {e}")
            conn_born = time.monotonic()

        stream_id = "0" if in_pending_mode else ">"
        block_ms  = None if in_pending_mode else int(BATCH_INTERVAL_S * 1000)

        try:
            results = await r.xreadgroup(
                CONSUMER_GROUP, CONSUMER_NAME,
                {VIDEO_SESSIONS_STREAM: stream_id},
                count=100,
                block=block_ms,
            )
        except RedisConnectionError:
            log.warning("Redis connection lost in video_sessions_loop, retrying in 1s...")
            await asyncio.sleep(1)
            continue

        if not results or not any(msgs for _, msgs in results):
            if in_pending_mode:
                in_pending_mode = False
                log.info("Video sessions PEL drained, entering live mode")
            continue

        rows = []
        ids = []
        for _stream, messages in results:
            for msg_id, fields in messages:
                ids.append(msg_id)
                try:
                    org_id       = fields.get(b"org_id", b"").decode()
                    camera_count = int(fields.get(b"camera_count", b"0"))
                    started_at_ms = int(fields.get(b"started_at_ms", b"0"))
                    duration_s   = float(fields.get(b"duration_s", b"0"))

                    if not org_id or camera_count <= 0 or duration_s < 1.0:
                        continue

                    started_at = datetime.fromtimestamp(started_at_ms / 1000.0, tz=timezone.utc)
                    rows.append([org_id, "", camera_count, started_at, duration_s])
                except (ValueError, AttributeError) as e:
                    log.warning(f"video session parse error: {e}, msg_id={msg_id}")

        if rows:
            try:
                await ch.insert(
                    VIDEO_SESSION_TABLE,
                    rows,
                    column_names=VIDEO_SESSION_COLUMNS,
                    settings={"async_insert": 0},
                )
                log.info(f"Inserted {len(rows)} video session(s)")
            except Exception as e:
                log.error(f"Video session insert failed: {e}")
                # Don't ACK — PEL retries on next startup.
                continue

        if ids:
            await r.xack(VIDEO_SESSIONS_STREAM, CONSUMER_GROUP, *ids)


# ── Main ────────────────────────────────────────────────────────────────

async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    start_health_server()

    r         = await connect_redis()
    r_video   = await connect_redis()
    ch        = await connect_clickhouse()
    ch_video  = await connect_clickhouse()

    global _recording_store
    if RECORDING_FILTER_DISABLED:
        # Dev escape hatch only. Without the filter EVERY source is
        # persisted, and without the secret POST /recording is unauthenticated.
        log.warning(
            "RECORDING_FILTER_DISABLED=1 — recording filter OFF, persisting "
            "ALL sources; POST /recording auth may be disabled. NEVER use in prod."
        )
    elif not PLEXUS_API_URL or not PLEXUS_INTERNAL_SECRET:
        # Fail closed: silently persisting every source (filter bypass) or
        # serving POST /recording unauthenticated is worse than not booting.
        # Match bootstrap_recording_store, which already exits on failure.
        log.error(
            "PLEXUS_API_URL and PLEXUS_INTERNAL_SECRET are required — the "
            "recording filter and its push auth cannot run without them. "
            "Set both, or set RECORDING_FILTER_DISABLED=1 (dev only)."
        )
        sys.exit(1)
    else:
        store = RecordingStore()
        await bootstrap_recording_store(store)
        # Publish the store and replay toggles that arrived during
        # bootstrap, atomically w.r.t. do_POST (same lock) so ordering
        # is preserved and nothing lands between replace_all and replay.
        with _pending_lock:
            _recording_store = store
            for org_id, source_id, recording in _pending_toggles:
                store.set(org_id, source_id, recording)
                log.info(f"Replayed buffered recording toggle: {org_id}:{source_id} → {recording}")
            _pending_toggles.clear()

    shutdown = asyncio.Event()
    loop = asyncio.get_running_loop()

    def _handle_signal():
        log.info("Shutdown signal received")
        shutdown.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _handle_signal)

    try:
        await asyncio.gather(
            ingest_loop(r, ch, shutdown, _recording_store),
            video_sessions_loop(r_video, ch_video, shutdown),
        )
    finally:
        log.info(f"Shutdown complete. Total inserted: {_health['total_inserted']}")
        for conn in (ch, ch_video, r, r_video):
            try:
                await conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    asyncio.run(main())
