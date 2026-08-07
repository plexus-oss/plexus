#!/usr/bin/env python3
"""
Plexus Data API endpoint + WebSocket smoke test.

Usage:
    PLEXUS_API_KEY=plx_... python test_api.py [--url URL] [--device DEVICE_ID] [--ws-timeout 5]

If --device is omitted the first device returned by GET /v1/sources is used.
"""

import argparse
import asyncio
import json
import os
import sys
import time

import httpx
import websockets

BASE_URL = "https://api.plexus.company"
WS_BASE  = "wss://api.plexus.company"


def _headers(api_key: str) -> dict:
    return {"x-api-key": api_key}


def _ok(label: str, detail: str = ""):
    suffix = f"  {detail}" if detail else ""
    print(f"  \033[32m✓\033[0m  {label}{suffix}")


def _fail(label: str, detail: str = ""):
    suffix = f"  {detail}" if detail else ""
    print(f"  \033[31m✗\033[0m  {label}{suffix}")


def _skip(label: str, detail: str = ""):
    suffix = f"  {detail}" if detail else ""
    print(f"  \033[33m–\033[0m  {label}{suffix}")


async def check_health(client: httpx.AsyncClient) -> bool:
    r = await client.get("/health")
    ok = r.status_code == 200 and r.json().get("status") == "ok"
    if ok:
        _ok("GET /health")
    else:
        _fail("GET /health", f"status={r.status_code} body={r.text[:80]}")
    return ok


async def get_device_id(client: httpx.AsyncClient, api_key: str, override: str | None) -> str | None:
    if override:
        return override

    r = await client.get("/v1/sources", headers=_headers(api_key))
    if r.status_code != 200:
        _fail("GET /v1/sources", f"status={r.status_code}")
        return None

    devices = r.json().get("devices", [])
    if not devices:
        _skip("GET /v1/sources", "no devices registered")
        return None

    device_id = devices[0]["source_id"]
    online_count = sum(1 for d in devices if d.get("online"))
    _ok("GET /v1/sources", f"{len(devices)} device(s), {online_count} online → using '{device_id}'")
    return device_id


async def check_device(client: httpx.AsyncClient, api_key: str, device_id: str):
    r = await client.get(f"/v1/sources/{device_id}", headers=_headers(api_key))
    if r.status_code == 200:
        d = r.json()
        _ok(f"GET /v1/sources/{{id}}", f"online={d.get('online')} last_seen_ms={d.get('last_seen_ms')}")
    else:
        _fail(f"GET /v1/sources/{{id}}", f"status={r.status_code}")


async def check_metrics_list(client: httpx.AsyncClient, api_key: str, device_id: str) -> list[str]:
    r = await client.get(f"/v1/sources/{device_id}/metrics", headers=_headers(api_key))
    if r.status_code == 200:
        names = r.json()
        _ok("GET /v1/sources/{id}/metrics", f"{len(names)} metric(s): {', '.join(names[:5])}" + ("…" if len(names) > 5 else ""))
        return names
    else:
        _fail("GET /v1/sources/{id}/metrics", f"status={r.status_code}")
        return []


async def check_metrics_latest(client: httpx.AsyncClient, api_key: str, device_id: str):
    r = await client.get(f"/v1/sources/{device_id}/metrics/latest", headers=_headers(api_key))
    if r.status_code == 200:
        metrics = r.json().get("metrics", {})
        _ok("GET /v1/sources/{id}/metrics/latest", f"{len(metrics)} metric(s) with values")
    else:
        _fail("GET /v1/sources/{id}/metrics/latest", f"status={r.status_code}")


async def check_metrics_query(client: httpx.AsyncClient, api_key: str, device_id: str):
    r = await client.get(
        f"/v1/sources/{device_id}/metrics/query",
        params={"last": "1h"},
        headers=_headers(api_key),
    )
    if r.status_code == 200:
        body = r.json()
        series = body.get("series", {})
        total_pts = sum(len(v) for v in series.values())
        _ok(
            "GET /v1/sources/{id}/metrics/query",
            f"interval={body.get('interval')} auto_ds={body.get('auto_downsampled')} "
            f"{len(series)} series {total_pts} pts",
        )
    else:
        _fail("GET /v1/sources/{id}/metrics/query", f"status={r.status_code} {r.text[:80]}")


async def check_fleet_health(client: httpx.AsyncClient, api_key: str):
    r = await client.get("/v1/fleet/health", headers=_headers(api_key))
    if r.status_code == 200:
        d = r.json()
        _ok("GET /v1/fleet/health", f"total={d.get('sources_total')} online={d.get('sources_online')}")
    else:
        _fail("GET /v1/fleet/health", f"status={r.status_code} {r.text[:80]}")


async def check_fleet_metrics(client: httpx.AsyncClient, api_key: str, metric: str | None):
    if not metric:
        _skip("GET /v1/fleet/metrics", "no metrics available for device — skipped")
        return
    r = await client.get("/v1/fleet/metrics", params={"metric": metric, "last": "1h"}, headers=_headers(api_key))
    if r.status_code == 200:
        d = r.json()
        _ok("GET /v1/fleet/metrics", f"metric={d.get('metric')} interval={d.get('interval')} sources={d.get('sources_w_metric')}")
    else:
        _fail("GET /v1/fleet/metrics", f"status={r.status_code} {r.text[:80]}")


async def check_logs(client: httpx.AsyncClient, api_key: str, device_id: str):
    r = await client.get(f"/v1/sources/{device_id}/logs", params={"tail": "20"}, headers=_headers(api_key))
    if r.status_code == 200:
        events = r.json()
        _ok(f"GET /v1/sources/{{id}}/logs", f"{len(events)} event(s)")
    else:
        _fail(f"GET /v1/sources/{{id}}/logs", f"status={r.status_code} {r.text[:80]}")


async def check_video_websocket(api_key: str, device_id: str, ws_base: str, timeout: float, camera_id: str):
    uri = f"{ws_base}/v1/sources/{device_id}/video/stream?camera_id={camera_id}"
    print(f"\n  Connecting video WebSocket → {uri}")
    try:
        async with websockets.connect(uri, open_timeout=10) as ws:
            await ws.send(json.dumps({"type": "auth", "api_key": api_key}))
            print(f"       auth sent — waiting up to {timeout:.0f}s for frames…")

            deadline = time.monotonic() + timeout
            frames = 0
            got_init = False
            has_camera = False
            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=min(remaining, 1.0))
                    msg = json.loads(raw) if isinstance(raw, str) else json.loads(raw.decode())
                    msg_type = msg.get("type", "")
                    if msg_type == "init":
                        got_init = True
                        sources = msg.get("online_sources", [])
                        has_camera = any(
                            s.get("cameras") and (not s["cameras"] or camera_id in s["cameras"])
                            for s in sources
                            if s.get("source_id") == device_id
                        )
                        cam_note = f"camera '{camera_id}' registered" if has_camera else f"no camera registered on '{device_id}'"
                        _ok("WebSocket /video/stream", f"gateway connected — {cam_note}")
                        continue
                    if msg_type == "error":
                        _fail("WebSocket /video/stream", f"gateway error: {msg.get('message')}")
                        return
                    frames += 1
                    if frames == 1:
                        print(f"       first video frame: type={msg_type} keys={list(msg.keys())}")
                except asyncio.TimeoutError:
                    continue
                except Exception:
                    break  # connection dropped (1006) — expected when no camera is streaming

            if not got_init:
                _fail("WebSocket /video/stream", "no init message — gateway proxy may be broken")
            elif frames > 0:
                _ok("WebSocket /video/stream data", f"{frames} frame(s) in {timeout:.0f}s")
            elif has_camera:
                _skip("WebSocket /video/stream data", f"camera registered but no frames in {timeout:.0f}s")
            else:
                _skip("WebSocket /video/stream data", f"no camera active on '{device_id}' — start streaming first")

    except websockets.exceptions.InvalidStatus as e:
        body = e.response.body.decode(errors="replace")[:200] if e.response.body else ""
        _fail("WebSocket /video/stream", f"HTTP {e.response.status_code}{f': {body}' if body else ''}")
    except Exception as e:
        _fail("WebSocket /video/stream", str(e))


async def check_websocket(api_key: str, device_id: str, ws_base: str, timeout: float):
    uri = f"{ws_base}/v1/sources/{device_id}/metrics/stream"
    print(f"\n  Connecting WebSocket → {uri}")
    try:
        async with websockets.connect(uri, open_timeout=10) as ws:
            await ws.send(json.dumps({"type": "auth", "api_key": api_key}))
            print(f"       auth sent — waiting up to {timeout:.0f}s for frames…")

            deadline = time.monotonic() + timeout
            frames = 0
            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=min(remaining, 1.0))
                    msg = json.loads(raw)
                    if "error" in msg:
                        _fail("WebSocket /metrics/stream", f"server error: {msg['error']}")
                        return
                    frames += 1
                    pts = len(msg.get("points", []))
                    if frames == 1:
                        _ok("WebSocket /metrics/stream", "connected + auth accepted")
                    print(f"       frame {frames}: source_id={msg.get('source_id')} points={pts}")
                except asyncio.TimeoutError:
                    continue

            if frames > 0:
                _ok("WebSocket /metrics/stream data", f"{frames} frame(s) in {timeout:.0f}s")
            else:
                _skip("WebSocket /metrics/stream data", f"no frames in {timeout:.0f}s — device offline or send rate < timeout")

    except websockets.exceptions.InvalidStatus as e:
        body = e.response.body.decode(errors="replace")[:200] if e.response.body else ""
        _fail("WebSocket /metrics/stream", f"HTTP {e.response.status_code}{f': {body}' if body else ''}")
    except Exception as e:
        _fail("WebSocket /metrics/stream", str(e))


async def main():
    parser = argparse.ArgumentParser(description="Plexus API smoke test")
    parser.add_argument("--url",        default=BASE_URL,   help="Base HTTP URL")
    parser.add_argument("--device",     default=None,       help="Device ID (auto-discovered if omitted)")
    parser.add_argument("--camera",     default="default",  help="Camera ID for video stream test (default: 'default')")
    parser.add_argument("--ws-timeout", type=float, default=15.0, help="Seconds to wait for WS frames (default 15)")
    args = parser.parse_args()

    api_key = os.environ.get("PLEXUS_API_KEY", "")
    if not api_key:
        print("Error: PLEXUS_API_KEY env var is required", file=sys.stderr)
        sys.exit(1)

    ws_base = args.url.replace("https://", "wss://").replace("http://", "ws://")

    print(f"\nPlexus API smoke test → {args.url}\n")

    async with httpx.AsyncClient(base_url=args.url, timeout=15.0) as client:
        await check_health(client)

        device_id = await get_device_id(client, api_key, args.device)
        if device_id is None:
            print("\nNo device available — skipping device-scoped checks.")
            sys.exit(0)

        await check_device(client, api_key, device_id)
        metric_names = await check_metrics_list(client, api_key, device_id)
        await check_metrics_latest(client, api_key, device_id)
        await check_metrics_query(client, api_key, device_id)
        await check_logs(client, api_key, device_id)
        await check_fleet_health(client, api_key)
        await check_fleet_metrics(client, api_key, metric_names[0] if metric_names else None)

    await check_websocket(api_key, device_id, ws_base, args.ws_timeout)
    await check_video_websocket(api_key, device_id, ws_base, args.ws_timeout, args.camera)
    print()


if __name__ == "__main__":
    asyncio.run(main())
