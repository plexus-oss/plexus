#!/usr/bin/env python3
"""Browser consuming video from Plexus gateway via WebSocket."""

import asyncio
import base64
import json
import os
import sys

import cv2
import websockets

GATEWAY_URL = os.environ.get("PLEXUS_GATEWAY", "ws://localhost:8080/browser")
SESSION_TOKEN = os.environ.get("PLEXUS_SESSION", "test-session-token")


async def consume_video():
    async with websockets.connect(GATEWAY_URL, ping_interval=None) as ws:
        # Auth
        auth_msg = {
            "type": "browser_auth",
            "token": SESSION_TOKEN,
        }
        await ws.send(json.dumps(auth_msg))
        print("Auth sent, waiting for init...")

        # Get init
        resp = await ws.recv()
        data = json.loads(resp)
        if data.get("type") == "error":
            print(f"Auth failed: {data}")
            sys.exit(1)
        
        print(f"Connected, online sources: {data.get('online_sources', [])}")

        # Subscribe to cameras
        subscribe_msg = {
            "type": "subscribe",
            "cameras": ["default"],  # only receive video from "default" camera
        }
        await ws.send(json.dumps(subscribe_msg))
        print(f"Subscribed to cameras: {subscribe_msg['cameras']}")

        # Display setup
        window_name = "Plexus Video"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

        frame_count = 0
        try:
            while True:
                msg = await ws.recv()
                data = json.loads(msg)

                if data.get("type") == "video_frame":
                    frame_count += 1
                    b64 = data.get("frame", "")
                    if b64:
                        # Decode base64 -> JPEG -> image
                        img_bytes = base64.b64decode(b64)
                        nparr = np.frombuffer(img_bytes, np.uint8)
                        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                        
                        if frame is not None:
                            cv2.imshow(window_name, frame)
                            cv2.waitKey(1)

                    if frame_count % 100 == 0:
                        print(f"Received {frame_count} frames")

                elif data.get("type") == "error":
                    print(f"Error: {data}")

        except KeyboardInterrupt:
            pass
        finally:
            cv2.destroyAllWindows()
            print(f"Total frames received: {frame_count}")


if __name__ == "__main__":
    import numpy as np
    asyncio.run(consume_video())