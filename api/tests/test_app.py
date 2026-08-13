"""App construction smoke tests (no lifespan — no external services needed)."""

import httpx

from app.main import app


async def test_health():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_devices_alias_308_preserves_path_and_query():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/v1/devices/rover-1/commands?x=1")
    assert resp.status_code == 308
    assert resp.headers["location"] == "/v1/sources/rover-1/commands?x=1"


def test_v1_routes_present_in_schema():
    paths = app.openapi()["paths"]
    assert any(p.startswith("/v1/sources") for p in paths)
