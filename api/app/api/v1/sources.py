import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.core.dependencies import ClickHouse, GatewayClient, OrgID, RedisClient
from app.schemas.device import DeviceListResponse, DeviceResponse

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("", response_model=DeviceListResponse)
async def list_sources(
    org_id: OrgID,
    ch: ClickHouse,
    gw: GatewayClient,
    redis: RedisClient,
    status: Literal["online", "offline"] | None = Query(None),
):
    online_sources, known_sources = await asyncio.gather(
        gw.get_online_sources(org_id, redis),
        ch.list_known_sources(org_id),
    )
    online_set = set(online_sources)
    all_ids = online_set | known_sources.keys()
    devices = [
        DeviceResponse(
            source_id=sid,
            online=sid in online_set,
            last_seen_ms=known_sources.get(sid),
        )
        for sid in sorted(all_ids)
        if status is None
        or (status == "online" and sid in online_set)
        or (status == "offline" and sid not in online_set)
    ]
    return DeviceListResponse(devices=devices)


@router.get("/{source_id}", response_model=DeviceResponse)
async def get_source(source_id: str, org_id: OrgID, ch: ClickHouse, gw: GatewayClient, redis: RedisClient):
    online_sources, last_seen_ms = await asyncio.gather(
        gw.get_online_sources(org_id, redis),
        ch.get_last_seen(org_id, source_id),
    )
    online = source_id in online_sources
    if not online and last_seen_ms is None:
        raise HTTPException(status_code=404, detail="device not found")
    return DeviceResponse(source_id=source_id, online=online, last_seen_ms=last_seen_ms)
