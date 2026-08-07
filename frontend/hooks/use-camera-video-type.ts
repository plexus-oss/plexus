"use client";

import { useGatewayConnectionOrNull } from "@/context/gateway-connection-provider";

export type VideoType = "normal" | "thermal";

/**
 * Resolve a camera's `video_type` from the live gateway source list.
 *
 * The gateway carries `video_type` on each camera in `init`/`source_status`,
 * so this is known before the first frame arrives. Returns "thermal" or
 * "normal" when the camera is known (device connected and the camera has been
 * announced/declared), or `undefined` when it can't be determined — no
 * provider mounted, device offline, or camera not yet seen. Callers that need
 * a concrete value should treat `undefined` as "normal".
 */
export function useCameraVideoType(
  sourceId: string | undefined,
  cameraId: string | undefined,
): VideoType | undefined {
  const gw = useGatewayConnectionOrNull();
  if (!gw || !sourceId || !cameraId) return undefined;
  const source = gw.sources.find((s) => s.source_id === sourceId);
  return source?.cameras?.find((c) => c.camera_id === cameraId)?.video_type;
}
