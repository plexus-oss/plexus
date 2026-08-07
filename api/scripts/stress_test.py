#!/usr/bin/env python3
"""
Plexus Data API stress test with latency profiling.

Usage:
    PLEXUS_API_KEY=plx_... python stress_test.py [options]

    --workers   N    concurrent async workers (default 10)
    --duration  N    seconds to run (default 30)
    --url       URL  base URL (default https://api.plexus.company)
    --device    ID   device ID (auto-discovered if omitted)
    --ramp      N    seconds to linearly ramp workers from 1 to --workers (default 0)
"""

import argparse
import asyncio
import os
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field

import httpx

BASE_URL = "https://api.plexus.company"


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@dataclass
class EndpointStats:
    latencies: list[float] = field(default_factory=list)
    errors: int = 0

    def record(self, latency_ms: float):
        self.latencies.append(latency_ms)

    def error(self):
        self.errors += 1

    def percentile(self, p: float) -> float:
        if not self.latencies:
            return 0.0
        sorted_l = sorted(self.latencies)
        idx = max(0, int(len(sorted_l) * p / 100) - 1)
        return sorted_l[idx]

    @property
    def total(self) -> int:
        return len(self.latencies) + self.errors

    @property
    def rps(self) -> float:
        return 0.0  # filled in at report time


# ---------------------------------------------------------------------------
# Workers
# ---------------------------------------------------------------------------

def _headers(api_key: str) -> dict:
    return {"x-api-key": api_key}


async def worker(
    worker_id: int,
    client: httpx.AsyncClient,
    api_key: str,
    device_id: str,
    endpoints: list[tuple[str, dict]],
    stats: dict[str, EndpointStats],
    stop: asyncio.Event,
    ramp_delay: float,
):
    if ramp_delay > 0:
        await asyncio.sleep(ramp_delay)

    idx = worker_id % len(endpoints)  # each worker cycles through all, staggered start
    while not stop.is_set():
        label, kwargs = endpoints[idx % len(endpoints)]
        idx += 1

        t0 = time.perf_counter()
        try:
            r = await client.request(**kwargs, headers=_headers(api_key))
            elapsed = (time.perf_counter() - t0) * 1000
            if r.status_code < 500:
                stats[label].record(elapsed)
            else:
                stats[label].error()
        except Exception:
            stats[label].error()


async def discover_device(client: httpx.AsyncClient, api_key: str, override: str | None) -> str | None:
    if override:
        return override
    r = await client.get("/v1/sources", headers=_headers(api_key))
    if r.status_code != 200:
        return None
    devices = r.json().get("devices", [])
    return devices[0]["source_id"] if devices else None


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def _bar(frac: float, width: int = 20) -> str:
    filled = int(frac * width)
    return "█" * filled + "░" * (width - filled)


def print_report(stats: dict[str, EndpointStats], elapsed: float):
    print(f"\n{'─' * 68}")
    print(f"  {'Endpoint':<38}  {'req/s':>6}  {'p50':>7}  {'p95':>7}  {'p99':>7}  {'err%':>5}")
    print(f"{'─' * 68}")

    totals_req = 0
    totals_err = 0

    for label, s in stats.items():
        rps   = s.total / elapsed
        p50   = s.percentile(50)
        p95   = s.percentile(95)
        p99   = s.percentile(99)
        err_pct = (s.errors / s.total * 100) if s.total else 0

        totals_req += s.total
        totals_err += s.errors

        err_color = "\033[31m" if err_pct > 0 else ""
        err_reset = "\033[0m" if err_pct > 0 else ""

        print(
            f"  {label:<38}  {rps:>6.1f}  {p50:>6.0f}ms  {p95:>6.0f}ms  {p99:>6.0f}ms  "
            f"{err_color}{err_pct:>4.1f}%{err_reset}"
        )

    print(f"{'─' * 68}")
    total_rps = totals_req / elapsed
    total_err_pct = (totals_err / totals_req * 100) if totals_req else 0
    print(f"  {'TOTAL':<38}  {total_rps:>6.1f}  {'':>7}  {'':>7}  {'':>7}  {total_err_pct:>4.1f}%")
    print(f"\n  Duration: {elapsed:.1f}s   Requests: {totals_req}   Errors: {totals_err}")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    parser = argparse.ArgumentParser(description="Plexus API stress test")
    parser.add_argument("--url",      default=BASE_URL, help="Base HTTP URL")
    parser.add_argument("--device",   default=None,     help="Device ID (auto-discovered if omitted)")
    parser.add_argument("--workers",  type=int, default=10, help="Concurrent workers (default 10)")
    parser.add_argument("--duration", type=int, default=30, help="Test duration in seconds (default 30)")
    parser.add_argument("--ramp",     type=int, default=0,  help="Ramp-up seconds (default 0 = instant)")
    args = parser.parse_args()

    api_key = os.environ.get("PLEXUS_API_KEY", "")
    if not api_key:
        print("Error: PLEXUS_API_KEY env var is required", file=sys.stderr)
        sys.exit(1)

    print(f"\nPlexus stress test → {args.url}")
    print(f"  workers={args.workers}  duration={args.duration}s  ramp={args.ramp}s\n")

    async with httpx.AsyncClient(base_url=args.url, timeout=15.0) as client:
        device_id = await discover_device(client, api_key, args.device)
        if device_id is None:
            print("Error: no device found — pass --device or register a device first", file=sys.stderr)
            sys.exit(1)

        print(f"  Device: {device_id}")

        now_ms = int(time.time() * 1000)
        endpoints: list[tuple[str, dict]] = [
            ("GET /health",                       {"method": "GET", "url": "/health"}),
            ("GET /v1/sources",                   {"method": "GET", "url": "/v1/sources"}),
            ("GET /v1/sources/{id}",              {"method": "GET", "url": f"/v1/sources/{device_id}"}),
            ("GET /v1/sources/{id}/metrics",      {"method": "GET", "url": f"/v1/sources/{device_id}/metrics"}),
            ("GET /v1/sources/{id}/metrics/latest", {"method": "GET", "url": f"/v1/sources/{device_id}/metrics/latest"}),
            ("GET /v1/sources/{id}/metrics/query",  {
                "method": "GET",
                "url": f"/v1/sources/{device_id}/metrics/query",
                "params": {"last": "1h"},
            }),
        ]

        stats: dict[str, EndpointStats] = {label: EndpointStats() for label, _ in endpoints}
        stop = asyncio.Event()

        ramp_step = args.ramp / args.workers if args.ramp > 0 else 0

        tasks = [
            asyncio.create_task(
                worker(i, client, api_key, device_id, endpoints, stats, stop, i * ramp_step)
            )
            for i in range(args.workers)
        ]

        print(f"  Running{'  (ramping up)' if args.ramp else ''}…\n")
        t_start = time.perf_counter()

        try:
            await asyncio.sleep(args.duration)
        except asyncio.CancelledError:
            pass
        finally:
            stop.set()
            await asyncio.gather(*tasks, return_exceptions=True)

        elapsed = time.perf_counter() - t_start

    print_report(stats, elapsed)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted.")
