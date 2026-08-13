import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from redis.asyncio import Redis
from sqlalchemy import text

from app.api.v1 import router as v1_router
from app.core.config import settings
from app.core.database import engine
from app.core.dependencies import require_internal
from app.services.clickhouse import ClickHouseService
from app.services.gateway import GatewayService


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = Redis.from_url(settings.redis_url, decode_responses=False)
    await app.state.redis.ping()

    app.state.clickhouse = ClickHouseService()
    await app.state.clickhouse.init()

    app.state.gateway = GatewayService()

    yield

    await app.state.clickhouse.aclose()
    await app.state.gateway.aclose()
    await app.state.redis.aclose()


app = FastAPI(title="Plexus Data API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router)


# Deprecated alias — excluded from the OpenAPI spec (/v1/sources/* is the contract).
@app.api_route(
    "/v1/devices/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    include_in_schema=False,
)
async def redirect_devices(path: str, request: Request):
    qs = request.url.query
    target = f"/v1/sources/{path}" + (f"?{qs}" if qs else "")
    # 308 (not 301): permanent AND method/body-preserving. A 301 makes clients
    # rewrite POST/PUT/DELETE/PATCH to GET and drop the body, silently breaking
    # writes to the deprecated /v1/devices alias.
    return RedirectResponse(url=target, status_code=308)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/system", include_in_schema=False, dependencies=[Depends(require_internal)])
async def health_system(request: Request):
    redis = request.app.state.redis
    ch = request.app.state.clickhouse
    gw = request.app.state.gateway

    async def check(coro):
        try:
            await asyncio.wait_for(coro, timeout=3.0)
            return {"status": "ok"}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    async def check_supabase():
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))

    results = await asyncio.gather(
        check(redis.ping()),
        check(ch.ping()),
        check(gw.ping()),
        check(check_supabase()),
    )

    deps = {
        "redis":      results[0],
        "clickhouse": results[1],
        "gateway":    results[2],
        "supabase":   results[3],
    }
    overall = "ok" if all(d["status"] == "ok" for d in deps.values()) else "degraded"

    return JSONResponse(
        content={"status": overall, "dependencies": deps},
        status_code=200 if overall == "ok" else 503,
    )
