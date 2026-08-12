"""Service handles for MCP tools.

Tools run inside the mounted MCP transport, outside FastAPI's DI, so the
lifespan hands them the shared service singletons here.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx

from app.core.config import settings

if TYPE_CHECKING:
    from redis.asyncio import Redis

    from app.services.clickhouse import ClickHouseService
    from app.services.gateway import GatewayService


@dataclass
class Services:
    redis: "Redis"
    clickhouse: "ClickHouseService"
    gateway: "GatewayService"
    frontend: httpx.AsyncClient  # base_url = settings.app_url, for /api/dashboards


services: Services | None = None


def init(state) -> None:
    global services
    services = Services(
        redis=state.redis,
        clickhouse=state.clickhouse,
        gateway=state.gateway,
        frontend=httpx.AsyncClient(base_url=settings.app_url, timeout=15.0),
    )


def get() -> Services:
    if services is None:
        raise RuntimeError("MCP runtime not initialized — lifespan did not run")
    return services


async def aclose() -> None:
    global services
    if services is not None:
        await services.frontend.aclose()
        services = None
