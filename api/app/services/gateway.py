import json

import httpx
from redis.asyncio import Redis

from app.core.config import settings

_ONLINE_SOURCES_TTL = 60  # seconds


def _http_base_url() -> str:
    url = settings.gateway_url
    if url.startswith("wss://"):
        return "https://" + url[6:]
    if url.startswith("ws://"):
        return "http://" + url[5:]
    return url


class GatewayService:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(base_url=_http_base_url(), timeout=5.0)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def ping(self) -> None:
        resp = await self._client.get("/health")
        resp.raise_for_status()

    async def get_online_sources(self, org_id: str, redis: Redis) -> list[str]:
        cache_key = f"data_api:online_sources:{org_id}"
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(cached)

        # device_list is served only to authenticated internal callers — the
        # public /health payload omits it to avoid leaking source_id/org.
        headers = {}
        if settings.internal_secret:
            headers["x-internal-secret"] = settings.internal_secret
        resp = await self._client.get("/health", headers=headers)
        resp.raise_for_status()
        data = resp.json()
        sources = [
            d["source_id"]
            for d in data.get("device_list", [])
            if d.get("org") == org_id
        ]
        await redis.set(cache_key, json.dumps(sources), ex=_ONLINE_SOURCES_TTL)
        return sources

    async def ingest(self, api_key: str, source_id: str | None, points: list[dict]) -> dict:
        """Relay a telemetry batch to the gateway's public /ingest with the
        caller's own key — the gateway enforces the write scope (403)."""
        resp = await self._client.post(
            "/ingest",
            json={"source_id": source_id, "points": points},
            headers={"x-api-key": api_key},
        )
        if resp.status_code == 403:
            raise ValueError("API key lacks write scope — create a key with write access")
        if resp.status_code >= 400:
            raise ValueError(f"ingest failed ({resp.status_code}): {resp.text[:300]}")
        return resp.json()

    async def send_command(self, org_id: str, source_id: str, command: str, params: dict) -> bool:
        headers = {}
        if settings.internal_secret:
            headers["x-internal-secret"] = settings.internal_secret
        resp = await self._client.post(
            "/internal/command",
            json={"org_id": org_id, "source_id": source_id, "command": command, "params": params},
            headers=headers,
        )
        resp.raise_for_status()
        return resp.json().get("queued", False)


