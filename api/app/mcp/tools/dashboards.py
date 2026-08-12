"""Dashboard tools — proxy the frontend's /api/dashboards routes with the
caller's plx_ key (they accept x-api-key via withDualAuth).

The frontend stores dashboard config unvalidated on PUT, so the validation
here is the only guard on panel shape.
"""

import re
import uuid
from typing import Any

import httpx

from app.core.config import settings
from app.mcp.auth import current_auth
from app.mcp.runtime import get as services
from app.mcp.server import mcp

# Source of truth: frontend/lib/panels/registry.ts PANEL_TYPES. Keep in sync.
PANEL_TYPES = {
    "line", "area", "bar", "scatter", "assoc-scatter", "heatmap", "stat",
    "datagrid", "fleet-grid", "fleet-table", "radar", "attitude", "schematic",
    "video-telemetry", "model3d", "earth", "satellite-info", "text", "image",
    "video", "map", "calendar", "list", "gantt", "alerts", "events",
    "event_log", "devices", "dashboard",
}
# Panels that plot org telemetry and therefore need qualified metric refs.
DATA_PANEL_TYPES = {
    "line", "area", "bar", "scatter", "heatmap", "stat", "datagrid",
    "radar", "fleet-grid", "fleet-table",
}
_METRIC_REF = re.compile(r"^[^:\s]+:.+$")
_GRID_COLS = 24
_DEFAULT_SIZE = {"stat": (6, 4)}  # others get the medium preset 12x6

_PANEL_GUIDE = """
Panel shape: {type, title, metrics: ["<source-slug>:<metric>"], layout?: {x,y,w,h},
config?: {...}}. The grid is 24 columns; layout is auto-placed when omitted.
Composition pattern for a good starter dashboard: a top row of 'stat' tiles
(w=6,h=4, up to 4 across) for headline values (percentages, voltages, temps,
latencies), then 'line' charts (w=12,h=6, two per row) for everything worth
trending. Always confirm metric names with list_source_metrics first — metric
refs must be qualified as 'source-slug:metric_name'.
"""


def _key() -> str:
    return current_auth.get().api_key


def _headers() -> dict[str, str]:
    return {"x-api-key": _key()}


def _url(dashboard_id: str) -> str:
    return f"{settings.app_url}/dashboards/{dashboard_id}"


def _raise_for_status(resp: httpx.Response, action: str) -> None:
    if resp.status_code >= 400:
        detail = resp.text[:300]
        raise ValueError(f"{action} failed ({resp.status_code}): {detail}")


def _validate_panels(panels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(panels, list):
        raise ValueError("panels must be a list of panel objects")
    out: list[dict[str, Any]] = []
    cursor_x, cursor_y, row_h = 0, 0, 0
    for i, panel in enumerate(panels):
        if not isinstance(panel, dict):
            raise ValueError(f"panels[{i}] must be an object")
        p = dict(panel)
        ptype = p.get("type")
        if ptype not in PANEL_TYPES:
            raise ValueError(f"panels[{i}].type {ptype!r} is not a known panel type: {sorted(PANEL_TYPES)}")
        if not p.get("title"):
            raise ValueError(f"panels[{i}].title is required")
        metrics = p.get("metrics") or []
        if ptype in DATA_PANEL_TYPES:
            if not metrics:
                raise ValueError(f"panels[{i}] ({ptype}) needs at least one metric ref 'source-slug:metric'")
            for m in metrics:
                if not isinstance(m, str) or not _METRIC_REF.match(m):
                    raise ValueError(
                        f"panels[{i}] metric {m!r} must be qualified as 'source-slug:metric_name'"
                    )
        layout = p.get("layout")
        if layout is None:
            w, h = _DEFAULT_SIZE.get(ptype, (12, 6))
            if cursor_x + w > _GRID_COLS:
                cursor_x, cursor_y = 0, cursor_y + row_h
                row_h = 0
            layout = {"x": cursor_x, "y": cursor_y, "w": w, "h": h}
            cursor_x += w
            row_h = max(row_h, h)
        else:
            if not isinstance(layout, dict) or not all(
                isinstance(layout.get(k), int) for k in ("x", "y", "w", "h")
            ):
                raise ValueError(f"panels[{i}].layout needs integer x, y, w, h")
            if layout["x"] < 0 or layout["w"] < 1 or layout["x"] + layout["w"] > _GRID_COLS:
                raise ValueError(f"panels[{i}].layout must fit the {_GRID_COLS}-column grid")
        p["layout"] = layout
        p.setdefault("id", uuid.uuid4().hex[:12])
        p.setdefault("config", {})
        out.append(p)
    return out


def _build_config(panels: list[dict], time_range: dict | None) -> dict:
    return {
        "panels": _validate_panels(panels),
        "timeRange": time_range or {"type": "relative", "value": "1h"},
    }


@mcp.tool()
async def list_dashboards() -> dict:
    """List the org's dashboards (id, name, description, panel_count)."""
    resp = await services().frontend.get("/api/dashboards", headers=_headers())
    _raise_for_status(resp, "list dashboards")
    return resp.json()


@mcp.tool()
async def get_dashboard(dashboard_id: str) -> dict:
    """Get one dashboard including its full panel config, plus its URL."""
    resp = await services().frontend.get(f"/api/dashboards/{dashboard_id}", headers=_headers())
    _raise_for_status(resp, "get dashboard")
    data = resp.json()
    data["url"] = _url(dashboard_id)
    return data


@mcp.tool(description="Create a dashboard, optionally with panels." + _PANEL_GUIDE)
async def create_dashboard(
    name: str,
    description: str | None = None,
    panels: list[dict] | None = None,
    time_range: dict | None = None,
) -> dict:
    """Create a dashboard, optionally populated with panels."""
    config = _build_config(panels, time_range) if panels else None

    frontend = services().frontend
    resp = await frontend.post(
        "/api/dashboards",
        json={"name": name, "description": description},
        headers=_headers(),
    )
    _raise_for_status(resp, "create dashboard")
    dashboard = resp.json()["dashboard"]
    dashboard_id = dashboard["id"]

    panel_count = 0
    if config is not None:
        put = await frontend.put(
            f"/api/dashboards/{dashboard_id}",
            json={"config": config},
            headers=_headers(),
        )
        if put.status_code >= 400:
            # Don't leave an empty orphan behind if populating it failed.
            await frontend.delete(f"/api/dashboards/{dashboard_id}", headers=_headers())
            _raise_for_status(put, "populate dashboard")
        panel_count = len(config["panels"])

    return {"id": dashboard_id, "name": name, "panel_count": panel_count, "url": _url(dashboard_id)}


@mcp.tool(description="Update a dashboard's name, description, or full config." + _PANEL_GUIDE)
async def update_dashboard(
    dashboard_id: str,
    name: str | None = None,
    description: str | None = None,
    panels: list[dict] | None = None,
    time_range: dict | None = None,
) -> dict:
    """Update a dashboard. panels/time_range replace the whole config."""
    body: dict[str, Any] = {}
    if name is not None:
        body["name"] = name
    if description is not None:
        body["description"] = description
    if panels is not None:
        body["config"] = _build_config(panels, time_range)
    if not body:
        raise ValueError("nothing to update — pass name, description, or panels")

    resp = await services().frontend.put(
        f"/api/dashboards/{dashboard_id}", json=body, headers=_headers()
    )
    _raise_for_status(resp, "update dashboard")
    dashboard = resp.json()["dashboard"]
    return {
        "id": dashboard_id,
        "name": dashboard.get("name", name),
        "panel_count": len(body.get("config", {}).get("panels", [])) if panels is not None else None,
        "url": _url(dashboard_id),
    }
