import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from redis.asyncio import Redis
from starlette.requests import HTTPConnection

from app.core.auth import verify_api_key
from app.core.config import settings
from app.services.clickhouse import ClickHouseService
from app.services.gateway import GatewayService


async def require_internal(x_internal_secret: str = Header(default="")) -> None:
    if not settings.internal_secret or not hmac.compare_digest(x_internal_secret, settings.internal_secret):
        raise HTTPException(status_code=403, detail="forbidden")


async def require_auth(x_api_key: str = Header(default="")) -> str:
    if settings.dev_mode:
        return settings.dev_org_id

    result = await verify_api_key(x_api_key)
    if result is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid api key")
    org_id, access_enabled = result
    if not access_enabled:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "payment_required",
                "message": f"Add a payment method at {settings.app_url}/settings?tab=billing",
            },
        )
    return org_id


def get_redis(conn: HTTPConnection) -> Redis:
    return conn.app.state.redis


def get_clickhouse(conn: HTTPConnection) -> ClickHouseService:
    return conn.app.state.clickhouse


def get_gateway(conn: HTTPConnection) -> GatewayService:
    return conn.app.state.gateway


OrgID         = Annotated[str, Depends(require_auth)]
RedisClient   = Annotated[Redis, Depends(get_redis)]
ClickHouse    = Annotated[ClickHouseService, Depends(get_clickhouse)]
GatewayClient = Annotated[GatewayService, Depends(get_gateway)]
