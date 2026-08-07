#!/usr/bin/env python3
"""Device streaming video to Plexus gateway via WebSocket."""

import asyncio
import base64
import json
import os
import sys
import time

import cv2
import websockets

GATEWAY_URL = os.environ.get("PLEXUS_GATEWAY", "ws://localhost:8080/device")
API_KEY = os.environ.get("PLEXUS_KEY", "plx_dev_key_xxx")
SOURCE_ID = os.environ.get("SOURCE_ID", "mac-cam")


async def stream_video():
    async with websockets.connect(GATEWAY_URL, ping_interval=None) as ws:
        # Auth
        auth_msg = {
            "type": "device_auth",
            "api_key": API_KEY,
            "source_id": SOURCE_ID,
        }
        await ws.send(json.dumps(auth_msg))
        print(f"Auth sent, waiting for device_id...")

        # Get assigned device_id
        resp = await ws.recv()
        data = json.loads(resp)
        if data.get("type") == "error":
            print(f"Auth failed: {data}")
            sys.exit(1)
        
        device_id = data.get("device_id", "unknown")
        print(f"Connected as device_id={device_id}")

        # Open Mac camera
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("Failed to open camera")
            sys.exit(1)

        # Config: lower resolution for network, 15fps
        WIDTH, HEIGHT = 640, 480
        FPS = 15
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
        
        interval = 1.0 / FPS
        frame_count = 0

        print(f"Streaming {WIDTH}x{HEIGHT} @ {FPS}fps... Ctrl-C to stop")

        try:
            while True:
                start = time.time()

                ret, frame = cap.read()
                if not ret:
                    break

                # Encode as JPEG base64
                _, buf = cv2.imencode(".jpg", frame)
                b64 = base64.b64encode(buf.tobytes()).decode("ascii")

                video_frame = {
                    "type": "video_frame",
                    "camera_id": "default",
                    "frame": b64,
                    "width": WIDTH,
                    "height": HEIGHT,
                    "timestamp": int(time.time() * 1000),
                }
                await ws.send(json.dumps(video_frame))
                frame_count += 1

                if frame_count % 100 == 0:
                    print(f"Sent {frame_count} frames")

                # Rate limit
                elapsed = time.time() - start
                wait = interval - elapsed
                if wait > 0:
                    await asyncio.sleep(wait)

        except KeyboardInterrupt:
            pass
        finally:
            cap.release()
            print(f"Total frames sent: {frame_count}")


if __name__ == "__main__":
    asyncio.run(stream_video())