import os

# Settings() is constructed at import time and requires DATABASE_URL.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5433/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6390")

import httpx
import pytest

from app.mcp import runtime
from app.mcp.runtime import Services


class FakeClickHouse:
    """Async stand-in for ClickHouseService — only what the tools call."""

    def __init__(self):
        self.known = {"rover-1": 1_700_000_000_000, "pump-2": 1_700_000_100_000}
        self.metrics = ["battery_pct", "motor_temp_c"]
        self.series = {
            "battery_pct": {"timestamp_ms": [1, 2, 3], "value": [90.0, 89.5, 89.0]},
        }

    async def list_known_sources(self, org_id):
        return dict(self.known)

    async def get_last_seen(self, org_id, source_id):
        return self.known.get(source_id)

    async def list_metrics(self, org_id, source_id):
        return list(self.metrics)

    async def query_latest_metrics(self, org_id, source_id):
        return {"battery_pct": 89.0}

    async def query_metrics(self, org_id, source_id, metrics, start_ms, end_ms, interval, limit):
        return dict(self.series)

    async def query_logs(self, org_id, source_id, start_ms, end_ms, limit, name):
        return [{"timestamp_ms": 1, "name": "boot", "message": "ok"}][:limit]

    async def query_logs_tail(self, org_id, source_id, n, name):
        return [{"timestamp_ms": 1, "name": "boot", "message": "ok"}][:n]

    async def count_known_sources(self, org_id):
        return len(self.known)

    async def query_fleet_metrics(self, org_id, metric, start_ms, end_ms, interval, limit):
        return {
            "rover-1": {"timestamp_ms": [1], "avg": [1.0], "min": [1.0], "max": [1.0], "count": [1]}
        }


class FakeGateway:
    def __init__(self):
        self.online = ["rover-1"]
        self.ingest_calls = []
        self.ingest_status = 200

    async def get_online_sources(self, org_id, redis):
        return list(self.online)

    async def ingest(self, api_key, source_id, points):
        # Mirror GatewayService.ingest error mapping for the 403 case.
        if self.ingest_status == 403:
            raise ValueError("API key lacks write scope — create a key with write access")
        self.ingest_calls.append({"api_key": api_key, "source_id": source_id, "points": points})
        return {"success": True, "count": len(points), "source_id": source_id}


@pytest.fixture
def frontend_calls():
    return []


@pytest.fixture
def frontend_handler(frontend_calls):
    """Default happy-path fake for the frontend dashboard routes."""

    def handler(request: httpx.Request) -> httpx.Response:
        frontend_calls.append(request)
        if request.method == "GET" and request.url.path == "/api/dashboards":
            return httpx.Response(200, json={"dashboards": [{"id": "d1", "name": "Fleet"}]})
        if request.method == "POST" and request.url.path == "/api/dashboards":
            return httpx.Response(201, json={"dashboard": {"id": "new-dash", "name": "X"}})
        if request.url.path.startswith("/api/dashboards/"):
            if request.method in ("GET", "PUT"):
                return httpx.Response(200, json={"dashboard": {"id": "new-dash", "name": "X"}})
            if request.method == "DELETE":
                return httpx.Response(200, json={"success": True})
        return httpx.Response(404, json={"error": "not found"})

    return handler


@pytest.fixture
def fake_services(frontend_handler):
    svc = Services(
        redis=object(),
        clickhouse=FakeClickHouse(),
        gateway=FakeGateway(),
        frontend=httpx.AsyncClient(
            transport=httpx.MockTransport(frontend_handler), base_url="https://app.test"
        ),
    )
    runtime.services = svc
    yield svc
    runtime.services = None
