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
from app.mcp import runtime as mcp_runtime
from app.mcp.auth import McpAuthMiddleware
from app.mcp.mount import McpPathMiddleware
from app.mcp.server import mcp
from app.services.clickhouse import ClickHouseService
from app.services.gateway import GatewayService


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = Redis.from_url(settings.redis_url, decode_responses=False)
    await app.state.redis.ping()

    app.state.clickhouse = ClickHouseService()
    await app.state.clickhouse.init()

    app.state.gateway = GatewayService()

    mcp_runtime.init(app.state)
    # Starlette's Mount never runs a sub-app's lifespan, and the MCP session
    # manager may be entered exactly once per process — so it lives here.
    async with mcp.session_manager.run():
        yield

    await mcp_runtime.aclose()
    await app.state.clickhouse.aclose()
    await app.state.gateway.aclose()
    await app.state.redis.aclose()


app = FastAPI(title="Plexus Data API", version="0.1.0", lifespan=lifespan)

# MCP endpoint (Streamable HTTP, stateless), served at exactly /mcp — a plain
# Mount would 307 bare /mcp to /mcp/. Bearer plx_ auth happens in the wrapping
# middleware; neither appears in openapi.json. CORS is added after, so it
# stays outermost and still covers /mcp preflights.
app.add_middleware(McpPathMiddleware, mcp_app=McpAuthMiddleware(mcp.streamable_http_app()))

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


# OAuth 2.0 Protected Resource Metadata (RFC 9728) for the /mcp endpoint —
# MCP clients (claude.ai connectors) discover the authorization server here.
# Both probe paths are served (path-inserted and root); schema-invisible so
# openapi.json stays byte-identical.
@app.get("/.well-known/oauth-protected-resource", include_in_schema=False)
@app.get("/.well-known/oauth-protected-resource/mcp", include_in_schema=False)
async def oauth_protected_resource():
    return {
        "resource": f"{settings.public_url}/mcp",
        "authorization_servers": [settings.app_url],
        "bearer_methods_supported": ["header"],
    }


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
