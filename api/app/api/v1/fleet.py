import asyncio
from datetime import datetime

from fastapi import APIRouter, Query

from app.api.v1._window import parse_window
from app.core.dependencies import ClickHouse, GatewayClient, OrgID, RedisClient
from app.schemas.fleet import FleetHealthResponse, FleetMetricsResponse, FleetSourceSeries
from app.services.clickhouse import auto_interval

router = APIRouter(prefix="/fleet", tags=["fleet"])

_QUERY_LIMIT = 10_000  # cap on total aggregate buckets returned across sources


@router.get("/health", response_model=FleetHealthResponse)
async def fleet_health(org_id: OrgID, ch: ClickHouse, gw: GatewayClient, redis: RedisClient):
    sources_total, online_sources = await asyncio.gather(
        ch.count_known_sources(org_id),
        gw.get_online_sources(org_id, redis),
    )
    return FleetHealthResponse(sources_total=sources_total, sources_online=len(online_sources))


@router.get("/metrics", response_model=FleetMetricsResponse)
async def fleet_metrics(
    org_id: OrgID,
    ch: ClickHouse,
    gw: GatewayClient,
    redis: RedisClient,
    metric: str = Query(...),
    last: str | None = Query(None, description="e.g. 1h, 30m, 7d"),
    start: datetime | None = Query(None, description="ISO 8601 start time"),
    end: datetime | None = Query(None, description="ISO 8601 end time"),
):
    start_ms, end_ms = parse_window(last, start, end)
    interval = auto_interval(start_ms, end_ms)
    if interval == "raw":
        interval = "1m"

    series, online_sources = await asyncio.gather(
        ch.query_fleet_metrics(org_id, metric, start_ms, end_ms, interval, _QUERY_LIMIT),
        gw.get_online_sources(org_id, redis),
    )

    total_rows = sum(len(data["timestamp_ms"]) for data in series.values())

    online_set = set(online_sources)
    sources = [
        FleetSourceSeries(
            source_id=sid,
            online=sid in online_set,
            timestamp_ms=data["timestamp_ms"],
            avg=data["avg"],
            min=data["min"],
            max=data["max"],
            count=data["count"],
        )
        for sid, data in sorted(series.items())
    ]

    return FleetMetricsResponse(
        metric=metric,
        interval=interval,
        sources_online=len(online_sources),
        sources_w_metric=len(sources),
        sources=sources,
        truncated=total_rows >= _QUERY_LIMIT,
    )
