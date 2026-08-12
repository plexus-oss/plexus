import json

import httpx
import pytest

import app.mcp.auth as mcp_auth
from app.mcp.auth import AuthInfo, McpAuthMiddleware, current_auth


async def echo_app(scope, receive, send):
    """Trivial ASGI app that reports what the middleware stashed."""
    info = current_auth.get(None)
    body = json.dumps(
        {"org_id": info.org_id if info else None, "api_key": info.api_key if info else None}
    ).encode()
    await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/json")]})
    await send({"type": "http.response.body", "body": body})


@pytest.fixture
def client():
    transport = httpx.ASGITransport(app=McpAuthMiddleware(echo_app))
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def test_missing_header_401(client, monkeypatch):
    monkeypatch.setattr(mcp_auth.settings, "dev_mode", False)
    resp = await client.post("/")
    assert resp.status_code == 401
    www = resp.headers["www-authenticate"]
    assert www.startswith("Bearer ")
    assert 'resource_metadata="' in www
    assert www.endswith('/.well-known/oauth-protected-resource/mcp"')
    assert resp.json()["error"] == "invalid_api_key"


async def test_invalid_key_401(client, monkeypatch):
    monkeypatch.setattr(mcp_auth.settings, "dev_mode", False)

    async def deny(token):
        return None

    monkeypatch.setattr(mcp_auth, "verify_api_key", deny)
    resp = await client.post("/", headers={"Authorization": "Bearer plx_bogus"})
    assert resp.status_code == 401


async def test_disabled_key_402(client, monkeypatch):
    monkeypatch.setattr(mcp_auth.settings, "dev_mode", False)

    async def disabled(token):
        return ("org_x", False)

    monkeypatch.setattr(mcp_auth, "verify_api_key", disabled)
    resp = await client.post("/", headers={"Authorization": "Bearer plx_x"})
    assert resp.status_code == 402
    assert resp.json()["error"] == "payment_required"


async def test_valid_key_sets_contextvar(client, monkeypatch):
    monkeypatch.setattr(mcp_auth.settings, "dev_mode", False)

    async def allow(token):
        assert token == "plx_good"
        return ("org_good", True)

    monkeypatch.setattr(mcp_auth, "verify_api_key", allow)
    resp = await client.post("/", headers={"Authorization": "Bearer plx_good"})
    assert resp.status_code == 200
    assert resp.json() == {"org_id": "org_good", "api_key": "plx_good"}
    # And the contextvar does not leak outside the request.
    assert current_auth.get(None) is None


async def test_dev_mode_bypasses_but_keeps_token(client, monkeypatch):
    monkeypatch.setattr(mcp_auth.settings, "dev_mode", True)
    monkeypatch.setattr(mcp_auth.settings, "dev_org_id", "dev_org")
    resp = await client.post("/", headers={"Authorization": "Bearer plx_whatever"})
    assert resp.status_code == 200
    assert resp.json() == {"org_id": "dev_org", "api_key": "plx_whatever"}


async def test_contextvar_reset_after_request(client, monkeypatch):
    monkeypatch.setattr(mcp_auth.settings, "dev_mode", True)
    token = current_auth.set(AuthInfo("outer", "outer_key"))
    try:
        resp = await client.post("/")
        assert resp.json()["org_id"] == "dev_org"
        assert current_auth.get() == AuthInfo("outer", "outer_key")
    finally:
        current_auth.reset(token)
