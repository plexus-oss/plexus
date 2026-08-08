import asyncio
import json
import logging
import websockets.asyncio.client
import websockets.exceptions
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

log = logging.getLogger(__name__)

from app.core.auth import verify_api_key
from app.core.config import settings

router = APIRouter(prefix="/sources/{source_id}/video", tags=["video"])

_GW_RECONNECT_DELAY = 2   # seconds between gateway reconnect attempts
_GW_MAX_RETRIES     = 5   # give up after this many consecutive failures (~10s)


@router.websocket("/stream")
async def stream_video(
    websocket: WebSocket,
    source_id: str,
    camera_id: list[str] = Query(default=["default"]),
    timeout: int = Query(default=None),
):
    await websocket.accept()

    if settings.dev_mode:
        api_key = ""
    else:
        try:
            msg = await asyncio.wait_for(websocket.receive_json(), timeout=10.0)
        except (asyncio.TimeoutError, WebSocketDisconnect):
            await websocket.close(code=4001, reason="unauthorized")
            return
        if msg.get("type") != "auth" or not msg.get("api_key"):
            await websocket.close(code=4001, reason="unauthorized")
            return
        api_key = msg["api_key"]
        result = await verify_api_key(api_key)
        if result is None:
            await websocket.close(code=4001, reason="unauthorized")
            return
        _, access_enabled = result
        if not access_enabled:
            await websocket.close(code=4002, reason="payment required")
            return

    if timeout is None:
        timeout = settings.video_stream_timeout

    gw_url = settings.gateway_url.rstrip("/") + "/ws/browser"

    try:
        await asyncio.wait_for(
            _proxy(websocket, gw_url, api_key, source_id, camera_id), timeout=timeout
        )
    except asyncio.TimeoutError:
        try:
            await websocket.close(code=4008, reason="stream timeout")
        except Exception:
            pass
    except (WebSocketDisconnect, websockets.exceptions.ConnectionClosed):
        pass
    except Exception:
        try:
            await websocket.close(code=1011, reason="gateway error")
        except Exception:
            pass


async def _proxy(
    websocket: WebSocket, gw_url: str, api_key: str, source_id: str, cameras: list[str]
):
    """
    Proxy frames from gateway to client with transparent gateway reconnection.

    Gateway errors (ConnectionClosed, OSError) trigger a retry loop — the client
    session is preserved across transient gateway restarts. Client disconnects
    (WebSocketDisconnect) propagate immediately and stop everything.
    """
    retries = 0

    while True:
        try:
            async with websockets.asyncio.client.connect(
                gw_url,
                ping_interval=20,
                ping_timeout=10,
            ) as gw_ws:
                await gw_ws.send(json.dumps({"type": "data_api_auth", "api_key": api_key}))

                init_raw = await gw_ws.recv()
                init_text = init_raw if isinstance(init_raw, str) else init_raw.decode()
                await websocket.send_text(init_text)

                # source_id scopes the stream to this device's cameras — camera
                # IDs are not unique across an org (every device has "default").
                await gw_ws.send(
                    json.dumps({"type": "subscribe", "source_id": source_id, "cameras": cameras})
                )

                retries = 0  # reset on successful connection

                # The gateway pushes org-wide frames (source_status, heartbeat,
                # event, command_result) to every browser-class connection.
                # This stream is documented as device-scoped video — forward
                # only video_frame, like metrics/logs filter to their types.
                async for msg in gw_ws:
                    text = msg if isinstance(msg, str) else msg.decode()
                    try:
                        if json.loads(text).get("type") != "video_frame":
                            continue
                    except (ValueError, AttributeError):
                        continue
                    await websocket.send_text(text)

        except (websockets.exceptions.ConnectionClosed,
                websockets.exceptions.WebSocketException,
                OSError):
            retries += 1
            if retries > _GW_MAX_RETRIES:
                # Sustained gateway failure — let stream_video close the client
                # with 1011 so the client's reconnect logic can retry cleanly.
                raise

            try:
                await websocket.send_json({
                    "type": "gateway_reconnecting",
                    "attempt": retries,
                    "max_attempts": _GW_MAX_RETRIES,
                    "delay_s": _GW_RECONNECT_DELAY,
                })
            except Exception:
                return  # client already gone, nothing to do

            await asyncio.sleep(_GW_RECONNECT_DELAY)
