import asyncio
import json
from datetime import datetime

import websockets.asyncio.client
import websockets.exceptions
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.api.v1._window import parse_window
from app.core.auth import verify_api_key
from app.core.config import settings
from app.core.dependencies import ClickHouse, OrgID
from app.schemas.logs import LogEvent

router = APIRouter(prefix="/sources/{source_id}/logs", tags=["logs"])


@router.get("", response_model=list[LogEvent])
async def get_logs(
    source_id: str,
    org_id: OrgID,
    ch: ClickHouse,
    tail: int | None = Query(None, le=10_000, description="last N events, newest-first then reversed to chronological"),
    last: str | None = Query(None, description="e.g. 1h, 30m, 7d"),
    start: datetime | None = Query(None, description="ISO 8601 start time"),
    end: datetime | None = Query(None, description="ISO 8601 end time"),
    limit: int = Query(1000, le=10_000),
    name: str | None = Query(None, description="filter by event name"),
):
    if tail is not None:
        return await ch.query_logs_tail(org_id, source_id, tail, name)
    start_ms, end_ms = parse_window(last, start, end)
    return await ch.query_logs(org_id, source_id, start_ms, end_ms, limit, name)


@router.websocket("/stream")
async def stream_logs(
    source_id: str,
    websocket: WebSocket,
):
    """Stream live log/event points for a device via the gateway subscribe protocol.

    Auth: send {"type":"auth","api_key":"..."} as the first message after connect.
    Receives all event-class points for the device in real time.
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

    gw_url = settings.gateway_url.rstrip("/") + "/ws/browser"

    try:
        await _proxy_logs(websocket, gw_url, api_key, source_id)
    except (WebSocketDisconnect, websockets.exceptions.ConnectionClosed):
        pass
    except Exception:
        try:
            await websocket.close(code=1011, reason="gateway error")
        except Exception:
            pass


_GW_RECONNECT_DELAY = 2
_GW_MAX_RETRIES     = 5


async def _proxy_logs(
    websocket: WebSocket,
    gw_url: str,
    api_key: str,
    source_id: str,
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

                await gw_ws.send(json.dumps({
                    "type": "subscribe",
                    "stream": "logs",
                    "source_id": source_id,
                }))

                retries = 0

                async for msg in gw_ws:
                    text = msg if isinstance(msg, str) else msg.decode()
                    try:
                        if json.loads(text).get("type") != "event":
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
