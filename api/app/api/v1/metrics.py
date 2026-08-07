import asyncio
import json
from datetime import datetime

import websockets.asyncio.client
import websockets.exceptions
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.api.v1._window import parse_window
from app.core.auth import verify_api_key
from app.core.config import settings
from app.core.dependencies import ClickHouse, OrgID
from app.schemas.metrics import LatestMetricsResponse, MetricsQueryResponse
from app.services.clickhouse import INTERVALS, auto_interval

router = APIRouter(prefix="/sources/{source_id}/metrics", tags=["metrics"])

_QUERY_LIMIT = 10_000  # cap on total rows returned (raw points or aggregate buckets)


@router.get("", response_model=list[str])
async def list_metrics(source_id: str, org_id: OrgID, ch: ClickHouse):
    """Return distinct metric names ever reported by a device.

    Source: ClickHouse (telemetry_dist). Latency: <5s.
    Use when: populating a metric picker or checking what a device reports.
    Not suitable for checking current values — use /latest for that.
    """
    return await ch.list_metrics(org_id, source_id)


@router.get("/latest", response_model=LatestMetricsResponse)
async def get_latest(source_id: str, org_id: OrgID, ch: ClickHouse):
    """Return the most recent value for every metric on a device.

    Source: ClickHouse (telemetry_dist). Latency: <5s.
    Use when: rendering a device status dashboard or spot-checking current
    sensor readings. Not a live feed — poll or use /stream for real-time.
    """
    metrics = await ch.query_latest_metrics(org_id, source_id)
    return LatestMetricsResponse(metrics=metrics)


@router.get("/query", response_model=MetricsQueryResponse)
async def query_metrics(
    source_id: str,
    org_id: OrgID,
    ch: ClickHouse,
    metrics: str | None = Query(None, description="comma-separated metric names; omit for all"),
    last: str | None = Query(None, description="e.g. 1h, 30m, 7d"),
    start: datetime | None = Query(None, description="ISO 8601 start time"),
    end: datetime | None = Query(None, description="ISO 8601 end time"),
    interval: str | None = Query(None, description="raw|1m|10m|1h|1d; omit for auto"),
):
    """Return historical time-series for one or more metrics with auto-downsampling.

    Source: ClickHouse — raw rows for windows <10 min, pre-aggregated 1-min or
    1-hr buckets for longer windows. Latency: <5s. Response includes interval and
    auto_downsampled so callers know the resolution chosen.
    Use when: rendering charts or running analysis over a time range.
    For live data use /stream instead.
    """
    if interval is not None and interval not in INTERVALS:
        raise HTTPException(400, f"interval must be one of {INTERVALS}")

    metric_list = [m.strip() for m in metrics.split(",")] if metrics else None
    start_ms, end_ms = parse_window(last, start, end)

    resolved = interval or auto_interval(start_ms, end_ms)
    auto_ds = interval is None and resolved != "raw"

    series = await ch.query_metrics(
        org_id, source_id, metric_list, start_ms, end_ms, resolved, _QUERY_LIMIT
    )

    total_rows = sum(len(pts["timestamp_ms"]) for pts in series.values())
    truncated = total_rows >= _QUERY_LIMIT

    return MetricsQueryResponse(
        interval=resolved,
        auto_downsampled=auto_ds,
        series=series,
        truncated=truncated,
    )


@router.websocket("/stream")
async def stream_metrics(
    source_id: str,
    websocket: WebSocket,
    metrics: str | None = Query(None, description="comma-separated metric names; omit for all"),
):
    """Stream live metric points for a device via the gateway subscribe protocol.

    Auth: send {"type":"auth","api_key":"..."} as the first message after connect.
    The gateway filters to the requested device and metric names server-side.
    Use when: driving live dashboards or alerting. For historical data use /query.
    """
    await websocket.accept()

    if settings.dev_mode:
        api_key = ""
    else:
        try:
            msg = await asyncio.wait_for(websocket.receive_json(), timeout=10.0)
        except (asyncio.TimeoutError, WebSocketDisconnect):
            await websocket.close(4401, "unauthorized")
            return
        if msg.get("type") != "auth" or not msg.get("api_key"):
            await websocket.close(4401, "unauthorized")
            return
        api_key = msg["api_key"]
        result = await verify_api_key(api_key)
        if result is None:
            await websocket.close(4401, "unauthorized")
            return
        _, access_enabled = result
        if not access_enabled:
            await websocket.close(4402, "payment required")
            return

    metric_list = [m.strip() for m in metrics.split(",")] if metrics else None
    gw_url = settings.gateway_url.rstrip("/") + "/ws/browser"

    try:
        await _proxy_metrics(websocket, gw_url, api_key, source_id, metric_list)
    except (WebSocketDisconnect, websockets.exceptions.ConnectionClosed):
        pass
    except Exception:
        try:
            await websocket.close(code=1011, reason="gateway error")
        except Exception:
            pass


_GW_RECONNECT_DELAY = 2
_GW_MAX_RETRIES     = 5


async def _proxy_metrics(
    websocket: WebSocket,
    gw_url: str,
    api_key: str,
    source_id: str,
    metric_list: list[str] | None,
):
    retries = 0
    while True:
        try:
            async with websockets.asyncio.client.connect(
                gw_url,
                ping_interval=20,
                ping_timeout=10,
            ) as gw_ws:
                await gw_ws.send(json.dumps({"type": "data_api_auth", "api_key": api_key}))
                await gw_ws.recv()  # consume init

                sub_msg: dict = {"type": "subscribe", "stream": "metrics", "source_id": source_id}
                if metric_list:
                    sub_msg["metrics"] = metric_list
                await gw_ws.send(json.dumps(sub_msg))

                retries = 0

                async for msg in gw_ws:
                    text = msg if isinstance(msg, str) else msg.decode()
                    try:
                        if json.loads(text).get("type") != "telemetry":
                            continue
                    except Exception:
                        continue
                    await websocket.send_text(text)

        except (websockets.exceptions.ConnectionClosed,
                websockets.exceptions.WebSocketException,
                OSError):
            retries += 1
            if retries > _GW_MAX_RETRIES:
                raise
            try:
                await websocket.send_json({
                    "type": "gateway_reconnecting",
                    "attempt": retries,
                    "delay_s": _GW_RECONNECT_DELAY,
                })
            except Exception:
                return
            await asyncio.sleep(_GW_RECONNECT_DELAY)
