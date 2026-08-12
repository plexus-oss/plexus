"""Bearer-token auth for the /mcp mount.

Validates `Authorization: Bearer plx_...` before the MCP transport runs and
stashes (org_id, raw key) in a contextvar for tools. Mirrors require_auth in
app/core/dependencies.py: 401 invalid key, 402 access disabled, dev_mode
bypass. The raw key is kept because the dashboard and ingest tools re-present
it as x-api-key when proxying the frontend and gateway.
"""

import contextvars
from typing import NamedTuple

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.auth import verify_api_key
from app.core.config import settings


class AuthInfo(NamedTuple):
    org_id: str
    api_key: str


current_auth: contextvars.ContextVar[AuthInfo] = contextvars.ContextVar("mcp_auth")


class McpAuthMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        auth = next((v for k, v in scope["headers"] if k == b"authorization"), b"").decode()
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""

        if settings.dev_mode:
            # Same bypass as require_auth, but keep whatever token was sent so
            # the proxying tools (dashboards, ingest) still work in dev.
            info = AuthInfo(org_id=settings.dev_org_id, api_key=token)
        else:
            result = await verify_api_key(token)
            if result is None:
                resp = JSONResponse(
                    {
                        "error": "invalid_api_key",
                        "message": "Pass a Plexus API key as 'Authorization: Bearer plx_...'",
                    },
                    status_code=401,
                    headers={"WWW-Authenticate": "Bearer"},
                )
                return await resp(scope, receive, send)
            org_id, access_enabled = result
            if not access_enabled:
                resp = JSONResponse(
                    {
                        "error": "payment_required",
                        "message": f"Add a payment method at {settings.app_url}/settings?tab=billing",
                    },
                    status_code=402,
                )
                return await resp(scope, receive, send)
            info = AuthInfo(org_id=org_id, api_key=token)

        # Contextvars are inherited by the per-request task the stateless MCP
        # transport spawns, so tools can read current_auth.get().
        tok = current_auth.set(info)
        try:
            await self.app(scope, receive, send)
        finally:
            current_auth.reset(tok)
