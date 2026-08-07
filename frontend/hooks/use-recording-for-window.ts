import useSWR from "swr";
import { useMemo, useState } from "react";
import type { Recording } from "@/lib/db/queries/recordings";
import type { TimeRange } from "@/lib/types/dashboard";

export interface RecordingMatch {
  recording: Recording;
  /** Where to seek playback so the video lines up with the window start. */
  seekSeconds: number;
}

function parseAbsolute(timeRange: TimeRange): [number, number] | null {
  if (timeRange.type !== "absolute") return null;
  const [start, end] = timeRange.value.split("/");
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  return [s, e];
}

/**
 * When a dashboard is frozen to an absolute window, find a finished recording
 * for this camera that overlaps it. This is what lets a video panel replay the
 * recorded footage in sync with the telemetry charts. Returns null while the
 * dashboard is live (relative range) so the live-frame path is untouched.
 */
export function useRecordingForWindow(
  sourceId: string | undefined,
  cameraId: string | undefined,
  timeRange: TimeRange,
): RecordingMatch | null {
  const win = parseAbsolute(timeRange);
  const shouldFetch = !!sourceId && !!win;
  // Snapshot "now" once for the ongoing-recording fallback so the overlap math
  // stays pure across re-renders.
  const [now] = useState(() => Date.now());

  const { data } = useSWR<{ recordings: Recording[] }>(
    shouldFetch ? `/api/recordings?source_id=${encodeURIComponent(sourceId!)}` : null,
  );

  return useMemo(() => {
    if (!win || !data?.recordings) return null;
    const [winStart, winEnd] = win;

    const candidates = data.recordings.filter((r) => {
      if (r.status !== "done" || !r.playback_url || !r.started_at) return false;
      if (cameraId && cameraId !== "default" && r.camera_id !== cameraId) return false;
      const recStart = new Date(r.started_at).getTime();
      const recEnd = r.finished_at ? new Date(r.finished_at).getTime() : now;
      return recStart <= winEnd && recEnd >= winStart; // overlap
    });

    if (candidates.length === 0) return null;

    // Prefer the recording whose span best contains the window start.
    candidates.sort(
      (a, b) =>
        new Date(b.started_at!).getTime() - new Date(a.started_at!).getTime(),
    );
    const recording = candidates[0];
    const recStart = new Date(recording.started_at!).getTime();
    const seekSeconds = Math.max(0, (winStart - recStart) / 1000);
    return { recording, seekSeconds };
  }, [win, data, cameraId, now]);
}
