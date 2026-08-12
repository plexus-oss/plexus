"""Plexus MCP server — mounted at /mcp in app/main.py.

Stateless Streamable HTTP (the Dockerfile runs 2 uvicorn workers, so no
session affinity is possible). Auth is handled by McpAuthMiddleware wrapped
around the mount; every tool is scoped to the org of the caller's plx_ key.
"""

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

mcp = FastMCP(
    "plexus",
    instructions=(
        "Plexus is a telemetry platform for hardware fleets — devices, robots, "
        "satellites, sensors, and services. These tools query telemetry, manage "
        "dashboards, and ingest data, all scoped to the org of the Plexus API "
        "key sent as 'Authorization: Bearer plx_...'. Start with list_sources "
        "to see what exists, and list_source_metrics before querying or "
        "building dashboards."
    ),
    stateless_http=True,
    json_response=True,
    # The sub-app serves at its own root; combined with the /mcp mount in
    # main.py the public endpoint is exactly /mcp.
    streamable_http_path="/",
    # Public server on multiple hostnames (api.plexus.company +
    # plexus-data-api.fly.dev) — Host pinning would break it, and every
    # request is bearer-authenticated, so DNS-rebinding protection adds
    # nothing here.
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)

# Importing the tool modules registers their @mcp.tool()s on the instance.
from app.mcp.tools import dashboards, ingest, instrumentation, telemetry  # noqa: E402,F401
