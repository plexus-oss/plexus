"""End-to-end JSON-RPC over the real mounted app (no FastAPI lifespan — the
MCP session manager is entered manually, services are the conftest fakes)."""

import httpx
import pytest

import app.mcp.auth as mcp_auth
from app.main import app
from app.mcp.server import mcp

EXPECTED_TOOLS = {
    "list_sources", "get_source", "list_source_metrics", "get_latest_metrics",
    "query_metrics", "get_logs", "fleet_health", "fleet_metrics",
    "list_dashboards", "get_dashboard", "create_dashboard", "update_dashboard",
    "send_telemetry", "get_instrumentation_guide",
}

HEADERS = {
    "Authorization": "Bearer plx_e2e",
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
}


def rpc(method: str, params: dict | None = None, id: int | None = 1) -> dict:
    msg = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    if id is not None:
        msg["id"] = id
    return msg


async def test_initialize_list_and_call(fake_services, monkeypatch):
    monkeypatch.setattr(mcp_auth.settings, "dev_mode", False)

    async def allow(token):
        return ("org_e2e", True) if token == "plx_e2e" else None

    monkeypatch.setattr(mcp_auth, "verify_api_key", allow)

    async with mcp.session_manager.run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            # No/invalid bearer -> 401 from the middleware, before the transport.
            resp = await client.post("/mcp", json=rpc("initialize"), headers={**HEADERS, "Authorization": ""})
            assert resp.status_code == 401

            resp = await client.post(
                "/mcp",
                json=rpc("initialize", {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "pytest", "version": "0"},
                }),
                headers=HEADERS,
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["result"]["serverInfo"]["name"] == "plexus"

            resp = await client.post("/mcp", json=rpc("tools/list", {}, id=2), headers=HEADERS)
            assert resp.status_code == 200, resp.text
            tools = {t["name"] for t in resp.json()["result"]["tools"]}
            assert tools == EXPECTED_TOOLS

            resp = await client.post(
                "/mcp",
                json=rpc("tools/call", {"name": "list_sources", "arguments": {}}, id=3),
                headers=HEADERS,
            )
            assert resp.status_code == 200, resp.text
            result = resp.json()["result"]
            assert result["isError"] is False
            assert "rover-1" in result["content"][0]["text"]
