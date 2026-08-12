"""Ingestion tool — relays to the gateway's public /ingest endpoint."""

import time

from app.mcp.auth import current_auth
from app.mcp.runtime import get as services
from mcp.types import ToolAnnotations

from app.mcp.server import mcp


@mcp.tool(annotations=ToolAnnotations(title="Send telemetry", readOnlyHint=False, destructiveHint=False, idempotentHint=False))
async def send_telemetry(points: list[dict], source_id: str | None = None) -> dict:
    """Send telemetry points to Plexus.

    Each point: {metric: str, value: number (or string for events),
    class?: 'metric'|'event' (default 'metric'), timestamp?: unix ms,
    tags?: {str: str}, source_id?: str}. source_id (lowercase hyphenated slug,
    e.g. 'pump-station-2') can be set per-point or once at the top level.
    Missing timestamps are stamped with the current time. Requires an API key
    with write scope. Max 10,000 points per batch.
    """
    if not points:
        raise ValueError("points must be a non-empty list")
    now_ms = int(time.time() * 1000)
    stamped = []
    for p in points:
        if not isinstance(p, dict):
            raise ValueError("each point must be an object")
        q = dict(p)
        q.setdefault("class", "metric")
        # Unstamped points would land with a zero timestamp downstream and be
        # invisible to queries — stamp them here.
        q.setdefault("timestamp", now_ms)
        stamped.append(q)

    result = await services().gateway.ingest(current_auth.get().api_key, source_id, stamped)
    return result
