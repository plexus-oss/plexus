#!/usr/bin/env python3
"""Stream synthetic telemetry into the local gateway."""

import asyncio, json, time, math
import websockets

GATEWAY = "ws://localhost:8080/ws/device"
SOURCE_ID = "dev-drone-01"


async def main():
    async with websockets.connect(GATEWAY) as ws:
        await ws.send(json.dumps({
            "type": "device_auth",
            "api_key": "plx_dev",
            "source_id": SOURCE_ID,
        }))

        resp = json.loads(await ws.recv())
        if resp.get("type") == "error":
            print("auth failed:", resp)
            return
        print(f"connected as {resp.get('source_id')}, streaming...")

        i = 0
        while True:
            t = int(time.time() * 1000)
            await ws.send(json.dumps({
                "type": "telemetry",
                "points": [
                    {"class": "metric", "metric": "battery",    "value": max(0, 100 - i * 0.1),        "timestamp": t},
                    {"class": "metric", "metric": "altitude",   "value": 50 + math.sin(i * 0.1) * 10,  "timestamp": t},
                    {"class": "metric", "metric": "motor_temp", "value": 60 + math.cos(i * 0.05) * 5,  "timestamp": t},
                    {"class": "metric", "metric": "velocity",   "value": abs(math.sin(i * 0.2)) * 20,  "timestamp": t},
                ],
            }))
            i += 1
            if i % 20 == 0:
                print(f"  {i * 4} points sent")
            await asyncio.sleep(2)  # 0.5 Hz


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
