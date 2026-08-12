"""Read-only telemetry tools — mirror the /v1 handlers, calling the shared
ClickHouse/Gateway services directly instead of HTTP self-calls."""

import asyncio
from typing import Literal

from app.mcp._window import parse_window
from app.mcp.auth import current_auth
from app.mcp.runtime import get as services
from app.mcp.server import mcp
from app.services.clickhouse import INTERVALS, auto_interval

_QUERY_LIMIT = 10_000  # same cap as app/api/v1/metrics.py


def _org() -> str:
    return current_auth.get().org_id


@mcp.tool()
async def list_sources(status: Literal["online", "offline"] | None = None) -> dict:
    """List all telemetry sources (devices) in the org with online status.

    A source is anything that has ever sent data — a device, robot, service,
    or agent — identified by a lowercase hyphenated slug. Returns source_id,
    online (currently connected to the gateway), and last_seen_ms (unix ms of
    the newest stored point, null if never stored).
    """
    svc = services()
    online_sources, known_sources = await asyncio.gather(
        svc.gateway.get_online_sources(_org(), svc.redis),
        svc.clickhouse.list_known_sources(_org()),
    )
    online_set = set(online_sources)
    all_ids = online_set | known_sources.keys()
    return {
        "sources": [
            {"source_id": sid, "online": sid in online_set, "last_seen_ms": known_sources.get(sid)}
            for sid in sorted(all_ids)
            if status is None
            or (status == "online" and sid in online_set)
            or (status == "offline" and sid not in online_set)
        ]
    }


@mcp.tool()
async def get_source(source_id: str) -> dict:
    """Get one source's online status and last-seen time.

    Errors with 'source not found' if the source is offline and has never
    stored any data.
    """
    svc = services()
    online_sources, last_seen_ms = await asyncio.gather(
        svc.gateway.get_online_sources(_org(), svc.redis),
        svc.clickhouse.get_last_seen(_org(), source_id),
    )
    online = source_id in online_sources
    if not online and last_seen_ms is None:
        raise ValueError("source not found")
    return {"source_id": source_id, "online": online, "last_seen_ms": last_seen_ms}


@mcp.tool()
async def list_source_metrics(source_id: str) -> dict:
    """List every distinct metric name a source has ever reported.

    Use before query_metrics or before building dashboard panels, so metric
    references are real. Metric names are things like battery_pct,
    motor_temp_c, network_latency_ms.
    """
    metrics = await services().clickhouse.list_metrics(_org(), source_id)
    return {"metrics": metrics}


@mcp.tool()
async def get_latest_metrics(source_id: str) -> dict:
    """Get the most recent value of every metric on a source (last hour).

    Snapshot, not a live feed — call again to refresh.
    """
    metrics = await services().clickhouse.query_latest_metrics(_org(), source_id)
    return {"metrics": metrics}


@mcp.tool()
async def query_metrics(
    source_id: str,
    metrics: str | None = None,
    last: str | None = None,
    start: str | None = None,
    end: str | None = None,
    interval: str | None = None,
) -> dict:
    """Query historical time-series for a source with auto-downsampling.

    metrics: comma-separated metric names; omit for all metrics.
    Window: either last (e.g. '1h', '30m', '7d') OR both start and end as
    ISO 8601 datetimes; default is the last hour.
    interval: raw|1m|10m|1h|1d; omit to auto-pick from the window size.
    Returns {interval, auto_downsampled, truncated, series} where series maps
    metric name -> {timestamp_ms: [...], value/avg/min/max: [...]}. Capped at
    10k rows total — truncated=true means narrow the window or metrics.
    """
    if interval is not None and interval not in INTERVALS:
        raise ValueError(f"interval must be one of {INTERVALS}")
    metric_list = [m.strip() for m in metrics.split(",")] if metrics else None
    start_ms, end_ms = parse_window(last, start, end)

    resolved = interval or auto_interval(start_ms, end_ms)
    auto_ds = interval is None and resolved != "raw"

    series = await services().clickhouse.query_metrics(
        _org(), source_id, metric_list, start_ms, end_ms, resolved, _QUERY_LIMIT
    )
    total_rows = sum(len(pts["timestamp_ms"]) for pts in series.values())
    return {
        "interval": resolved,
        "auto_downsampled": auto_ds,
        "truncated": total_rows >= _QUERY_LIMIT,
        "series": series,
    }


@mcp.tool()
async def get_logs(
    source_id: str,
    tail: int | None = None,
    last: str | None = None,
    start: str | None = None,
    end: str | None = None,
    limit: int = 100,
    name: str | None = None,
) -> dict:
    """Get log/event entries for a source, chronological.

    tail: just the last N events (ignores the time window). Otherwise window
    by last ('1h', '30m', '7d') or ISO start+end; default last hour.
    name filters by event name. limit caps results (default 100, max 1000).
    """
    limit = min(max(limit, 1), 1000)
    svc = services()
    if tail is not None:
        events = await svc.clickhouse.query_logs_tail(_org(), source_id, min(tail, 1000), name)
    else:
        start_ms, end_ms = parse_window(last, start, end)
        events = await svc.clickhouse.query_logs(_org(), source_id, start_ms, end_ms, limit, name)
    return {"events": events, "truncated": len(events) >= limit}


@mcp.tool()
async def fleet_health() -> dict:
    """Get org-wide fleet health: total known sources and how many are online now."""
    svc = services()
    sources_total, online_sources = await asyncio.gather(
        svc.clickhouse.count_known_sources(_org()),
        svc.gateway.get_online_sources(_org(), svc.redis),
    )
    return {"sources_total": sources_total, "sources_online": len(online_sources)}


@mcp.tool()
async def fleet_metrics(
    metric: str,
    last: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> dict:
    """Compare one metric across every source in the fleet that reports it.

    Window: last ('1h', '30m', '7d') or ISO start+end; default last hour.
    Returns per-source aggregate series (avg/min/max/count buckets).
    """
    start_ms, end_ms = parse_window(last, start, end)
    interval = auto_interval(start_ms, end_ms)
    if interval == "raw":
        interval = "1m"

    svc = services()
    series, online_sources = await asyncio.gather(
        svc.clickhouse.query_fleet_metrics(_org(), metric, start_ms, end_ms, interval, _QUERY_LIMIT),
        svc.gateway.get_online_sources(_org(), svc.redis),
    )
    total_rows = sum(len(data["timestamp_ms"]) for data in series.values())
    online_set = set(online_sources)
    return {
        "metric": metric,
        "interval": interval,
        "sources_online": len(online_sources),
        "sources_w_metric": len(series),
        "truncated": total_rows >= _QUERY_LIMIT,
        "sources": [
            {"source_id": sid, "online": sid in online_set, **data}
            for sid, data in sorted(series.items())
        ],
    }
