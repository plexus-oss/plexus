"""Serves the MCP app at exactly one path, with no trailing-slash redirect.

A Starlette Mount("/mcp") 307-redirects bare POST /mcp to /mcp/, and not every
MCP client follows redirects — so instead of mounting, this middleware diverts
/mcp (and /mcp/) to the MCP ASGI app and passes everything else through.
"""

from starlette.types import ASGIApp, Receive, Scope, Send


class McpPathMiddleware:
    def __init__(self, app: ASGIApp, mcp_app: ASGIApp, path: str = "/mcp") -> None:
        self.app = app
        self.mcp_app = mcp_app
        self.path = path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].rstrip("/") == self.path:
            # The MCP sub-app serves at its own root (streamable_http_path="/").
            scope = dict(scope)
            scope["path"] = "/"
            return await self.mcp_app(scope, receive, send)
        await self.app(scope, receive, send)
