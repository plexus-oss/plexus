"""RFC 9728 protected-resource metadata routes (OAuth discovery for /mcp)."""

import httpx
import pytest

from app.core.config import settings
from app.main import app


@pytest.fixture
def client():
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.parametrize(
    "path",
    ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
)
async def test_protected_resource_metadata(client, path):
    resp = await client.get(path)
    assert resp.status_code == 200
    assert resp.json() == {
        "resource": f"{settings.public_url}/mcp",
        "authorization_servers": [settings.app_url],
        "bearer_methods_supported": ["header"],
    }
