import pytest

from app.mcp.auth import AuthInfo, current_auth
from app.mcp.tools import dashboards as dash_tools
from app.mcp.tools import ingest as ingest_tools
from app.mcp.tools import instrumentation as instr_tools
from app.mcp.tools import telemetry as tele_tools


@pytest.fixture(autouse=True)
def auth_context():
    token = current_auth.set(AuthInfo(org_id="org_test", api_key="plx_test_key"))
    yield
    current_auth.reset(token)


async def test_list_sources(fake_services):
    result = await tele_tools.list_sources()
    ids = [s["source_id"] for s in result["sources"]]
    assert ids == ["pump-2", "rover-1"]
    online = {s["source_id"]: s["online"] for s in result["sources"]}
    assert online == {"pump-2": False, "rover-1": True}

    only_online = await tele_tools.list_sources(status="online")
    assert [s["source_id"] for s in only_online["sources"]] == ["rover-1"]


async def test_get_source_not_found(fake_services):
    with pytest.raises(ValueError, match="source not found"):
        await tele_tools.get_source("ghost")


async def test_query_metrics_window_and_interval(fake_services):
    result = await tele_tools.query_metrics("rover-1", metrics="battery_pct", last="1h")
    assert result["series"]["battery_pct"]["value"] == [90.0, 89.5, 89.0]
    assert result["truncated"] is False
    assert result["interval"] in ("raw", "1m", "10m", "1h", "1d")

    with pytest.raises(ValueError, match="interval must be one of"):
        await tele_tools.query_metrics("rover-1", interval="17s")

    with pytest.raises(ValueError, match="invalid last"):
        await tele_tools.query_metrics("rover-1", last="banana")

    with pytest.raises(ValueError, match="provided together"):
        await tele_tools.query_metrics("rover-1", start="2026-01-01T00:00:00")


async def test_fleet_tools(fake_services):
    health = await tele_tools.fleet_health()
    assert health == {"sources_total": 2, "sources_online": 1}

    fm = await tele_tools.fleet_metrics("battery_pct", last="1h")
    assert fm["sources_w_metric"] == 1
    assert fm["sources"][0]["source_id"] == "rover-1"
    assert fm["interval"] != "raw"  # raw is bumped to 1m


async def test_create_dashboard_post_then_put(fake_services, frontend_calls):
    result = await dash_tools.create_dashboard(
        "Rover overview",
        panels=[
            {"type": "stat", "title": "Battery", "metrics": ["rover-1:battery_pct"]},
            {"type": "line", "title": "Temps", "metrics": ["rover-1:motor_temp_c"]},
        ],
    )
    assert result["id"] == "new-dash"
    assert result["panel_count"] == 2
    assert result["url"].endswith("/dashboards/new-dash")

    methods = [(r.method, r.url.path) for r in frontend_calls]
    assert methods == [("POST", "/api/dashboards"), ("PUT", "/api/dashboards/new-dash")]
    # Caller's key is forwarded as x-api-key on every proxied request.
    assert all(r.headers["x-api-key"] == "plx_test_key" for r in frontend_calls)

    import json

    put_body = json.loads(frontend_calls[1].content)
    panels = put_body["config"]["panels"]
    assert put_body["config"]["timeRange"] == {"type": "relative", "value": "1h"}
    # Auto-layout: stat is 6x4 at origin, line is 12x6 next to it.
    assert panels[0]["layout"] == {"x": 0, "y": 0, "w": 6, "h": 4}
    assert panels[1]["layout"] == {"x": 6, "y": 0, "w": 12, "h": 6}
    assert all(p["id"] for p in panels)


async def test_create_dashboard_orphan_cleanup(fake_services, frontend_calls, frontend_handler, monkeypatch):
    import httpx

    def failing_put(request: httpx.Request) -> httpx.Response:
        if request.method == "PUT":
            frontend_calls.append(request)
            return httpx.Response(500, json={"error": "boom"})
        return frontend_handler(request)

    fake_services.frontend._transport = httpx.MockTransport(failing_put)

    with pytest.raises(ValueError, match="populate dashboard failed"):
        await dash_tools.create_dashboard(
            "X", panels=[{"type": "line", "title": "T", "metrics": ["a:b"]}]
        )
    methods = [(r.method, r.url.path) for r in frontend_calls]
    assert ("DELETE", "/api/dashboards/new-dash") in methods


async def test_panel_validation_rejections(fake_services):
    with pytest.raises(ValueError, match="not a known panel type"):
        await dash_tools.create_dashboard("X", panels=[{"type": "pie", "title": "T"}])

    with pytest.raises(ValueError, match="needs at least one metric"):
        await dash_tools.create_dashboard("X", panels=[{"type": "line", "title": "T"}])

    with pytest.raises(ValueError, match="must be qualified"):
        await dash_tools.create_dashboard(
            "X", panels=[{"type": "line", "title": "T", "metrics": ["unqualified"]}]
        )

    with pytest.raises(ValueError, match="24-column grid"):
        await dash_tools.create_dashboard(
            "X",
            panels=[{
                "type": "line", "title": "T", "metrics": ["a:b"],
                "layout": {"x": 20, "y": 0, "w": 12, "h": 6},
            }],
        )


async def test_update_dashboard_requires_changes(fake_services):
    with pytest.raises(ValueError, match="nothing to update"):
        await dash_tools.update_dashboard("d1")


async def test_send_telemetry_stamps_defaults(fake_services):
    result = await ingest_tools.send_telemetry(
        [{"metric": "battery_pct", "value": 88.5}], source_id="rover-1"
    )
    assert result["success"] is True
    call = fake_services.gateway.ingest_calls[0]
    assert call["api_key"] == "plx_test_key"
    point = call["points"][0]
    assert point["class"] == "metric"
    assert point["timestamp"] > 1_700_000_000_000  # stamped, not left for epoch-0

    with pytest.raises(ValueError, match="non-empty"):
        await ingest_tools.send_telemetry([])


async def test_send_telemetry_write_scope_error(fake_services):
    fake_services.gateway.ingest_status = 403
    with pytest.raises(ValueError, match="write scope"):
        await ingest_tools.send_telemetry([{"metric": "x", "value": 1}])


async def test_instrumentation_guide(fake_services):
    py = await instr_tools.get_instrumentation_guide("python")
    assert "pip install plexus-python" in py
    assert "{app_url}" not in py  # substituted
    ts = await instr_tools.get_instrumentation_guide("typescript")
    assert "npm install plexus-typescript" in ts
